/**
 * @file processor.ts
 * @description Excel 执行 Agent 的核心：程序的「手」（V0.2 已实现真实计算）。
 *
 * 关键原则（呼应项目核心原则）：
 * - AI 只负责「理解需求并产出 Task JSON」，绝不直接修改 Excel。
 * - 真正的分组、求和全部由本文件的代码完成，计算结果不依赖 AI。
 * - 引擎：exceljs（Node 生态）；Python(pandas/openpyxl) 实现位仍保留。
 */
import ExcelJS from "exceljs";
import { storage } from "@/services/storage";
import { recordFile } from "@/services/storage/lifecycle";
import { newResultFileId } from "@/services/uploads";
import { candidatesForField } from "@/services/ai/fieldMatcher";
import {
  analyzeColumns,
  analyzeTableTypeByRule,
  suggestByTableType,
} from "@/services/analyzer/tableAnalyzer";
import { analyzeTableWithAI } from "@/services/ai/deepseek";
import type {
  CalculationMethod,
  ExcelFile,
  ProcessRequest,
  ProcessSummary,
  TableAnalysis,
  Task,
} from "@/types/task";

/** 结果 Excel 的 MIME 类型 */
const XLSX_MIME =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/** exceljs writeBuffer 返回类型可转 Buffer；转换为字节数组以兼容 storage */
function toBuffer(data: ExcelJS.Buffer): Buffer {
  return Buffer.from(data as unknown as ArrayBuffer);
}

/** 把存储层读出的 Buffer 传给 exceljs load（规避 Node24 的 Buffer 泛型差异） */
function toLoadable(buf: Buffer): ExcelJS.Buffer {
  return buf as unknown as ExcelJS.Buffer;
}

/** 引擎一次处理的完整产出：处理前摘要（供审查对比）+ 处理结果 + 处理后摘要 */
export interface GroupSumOutcome {
  resultFileId: string;
  preview: ProcessSummary;
  result: ProcessSummary;
  durationMs: number;
  message: string;
}

/** 处理器抽象：一个 Excel 引擎需要具备的能力 */
export interface ExcelProcessor {
  /** 读取第一个工作表表头（供需求理解 Agent 使用） */
  readHeaders(file: ExcelFile): Promise<string[]>;
  /** 只读分析整个文件结构/表类型/推荐操作（供 Excel 分析 Agent 使用，绝不修改） */
  analyze(file: ExcelFile): Promise<TableAnalysis>;
  /** 根据结构化任务执行 Excel 处理（返回处理前/后摘要，供结果审查） */
  execute(req: ProcessRequest): Promise<GroupSumOutcome>;
}

/** 把单元格值安全地转为用于比较的字符串（表头匹配用） */
function cellToHeaderText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "object" && "text" in (value as object)) {
    return String((value as { text: unknown }).text ?? "");
  }
  // 数字 0 不应被吞成空，直接转字符串
  return typeof value === "number" ? String(value) : String(value).trim();
}

/** 把单元格值安全地转为数字，供求和；非数字或空值返回 0（V0.3 增强金额格式解析）。
 *  支持：数字、"123"、"1,000"（千分位）、"￥1000"/"¥1000"/"$100"（货币符号）、
 *        "1000 元"（尾部单位）、全角逗号等。空值/null/undefined 一律视为 0。
 */
export function cellToNumber(value: unknown): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value === "string") {
    // 去除货币符号、千分位、全角逗号、单位、空白后解析
    const cleaned = value
      .replace(/[￥¥$€£\s]/g, "")
      .replace(/[,，]/g, "")
      .replace(/(元|圆|块|角|分)$/gi, "");
    if (cleaned === "" || cleaned === "-") return 0;
    const n = Number(cleaned);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

/** 定位列名到列索引（1-based），找不到返回 0 */
function findColumnIndex(headers: string[], name: string): number {
  return headers.findIndex((h) => h === name.trim()) + 1; // 0 表示未找到
}

/** 表类型名 -> 机器 key（供 TableAnalysis.tableType） */
function tableTypeNameToKey(name: string): string {
  const map: Record<string, string> = {
    采购表: "purchase",
    销售表: "sales",
    库存表: "inventory",
    财务表: "finance",
    明细表: "detail",
    通用表: "generic",
  };
  return map[name] || "generic";
}

/** 列数（用于读取整行） */
function colFor(headers: string[]): number {
  return Math.max(headers.length, 1);
}

/**
 * 聚合状态机：支持 sum / avg / max / min / count。
 * 每个「组 × 计算列」一个状态。AVG 额外记录个数。
 */
interface AggState {
  /** 当前聚合累积（sum 为和、max/min 为极值、count 为个数） */
  value: number;
  /** avg 需要的计数；其余忽略 */
  n: number;
}

function initAggState(method: CalculationMethod, first: number): AggState {
  if (method === "avg") return { value: first, n: 1 };
  if (method === "max") return { value: first, n: 0 };
  if (method === "min") return { value: first, n: 0 };
  if (method === "count") return { value: first !== 0 ? 1 : 0, n: 0 };
  return { value: first, n: 0 }; // sum
}

function aggregateInto(state: AggState, method: CalculationMethod, v: number): void {
  switch (method) {
    case "count":
      if (v !== 0) state.value += 1;
      break;
    case "avg":
      state.value += v;
      state.n += 1;
      break;
    case "max":
      if (v > state.value) state.value = v;
      break;
    case "min":
      if (v < state.value) state.value = v;
      break;
    default: // sum
      state.value += v;
  }
}

function finalizeAgg(state: AggState, method: CalculationMethod): number {
  if (method === "avg" && state.n > 0) return state.value / state.n;
  return state.value;
}


/**
 * 校验任务引用的字段是否都存在于表头中（考虑 fieldMap 映射后的真实列）。
 * V0.3：缺失字段时给出「最可能的候选列」，帮助用户定位/手动确认。
 * @param headers 真实表头
 * @param task 任务
 * @param fieldMap 可选：逻辑列名 -> 真实列名
 * @throws 缺失任何字段时抛错，文案提示用户检查或提供候选
 */
function assertFieldsExist(
  headers: string[],
  task: Task,
  fieldMap?: Record<string, string>
): void {
  const missing: string[] = [];
  // 先按 fieldMap 替换，再校验；若已映射则理论上不会再缺失
  const resolve = (col: string) => (fieldMap && fieldMap[col] ? fieldMap[col] : col);

  for (const g of task.groupBy) {
    // "全部列" 是 distinct 的整行去重哨兵值，不是真实列名，跳过校验
    if (g === "全部列") continue;
    if (findColumnIndex(headers, g) === 0 && !findColumnIndex(headers, resolve(g))) {
      missing.push(g);
    }
  }
  for (const c of task.calculations) {
    if (
      findColumnIndex(headers, c.column) === 0 &&
      !findColumnIndex(headers, resolve(c.column))
    ) {
      missing.push(c.column);
    }
  }

  if (missing.length > 0) {
    const uniq = [...new Set(missing)];
    // 对每个缺失字段，从真实表头中找最相似的候选，作为改进后的错误提示
    const hints = uniq
      .map((col) => {
        const cands = candidatesForField(col, headers)
          .slice(0, 2)
          .map((c) => `“${c.header}”`);
        return cands.length > 0 ? `${col}（可尝试：${cands.join("、")}）` : col;
      })
      .join("、");
    throw new Error(
      `未找到需要处理的字段：${hints}。` +
        (fieldMap && fieldMap[uniq[0]]
          ? "请检查字段映射后重试。"
          : "请检查表格格式，或使用下方“字段确认”重新指定。")
    );
  }
}

/** Node 生态：基于 exceljs 的真实实现 */
class NodeProcessor implements ExcelProcessor {
  /** 读取源文件（通过 fileId -> 存储层字节） */
  private async loadWorkbook(file: ExcelFile): Promise<ExcelJS.Workbook> {
    const wb = new ExcelJS.Workbook();
    // 从存储层读字节（local 磁盘或 Blob 统一），避免直接依赖本地文件系统路径
    const buf = await storage.get(file.fileId);
    await wb.xlsx.load(toLoadable(buf));
    return wb;
  }

  private getWorksheet(wb: ExcelJS.Workbook, sheetName?: string) {
    const ws = sheetName ? wb.getWorksheet(sheetName) : wb.worksheets[0];
    if (!ws) throw new Error("未找到有效的工作表。");
    return ws;
  }

  async readHeaders(file: ExcelFile): Promise<string[]> {
    const wb = await this.loadWorkbook(file);
    const ws = this.getWorksheet(wb);
    const headers: string[] = [];
    // 取第一行作为表头；对缺少表头的单元格用空串占位
    const cols = ws.columnCount || 1;
    for (let c = 1; c <= cols; c++) {
      headers.push(cellToHeaderText(ws.getCell(1, c).value));
    }
    return headers.filter((h) => h !== "");
  }

  /**
   * 只读分析整个文件结构（V0.5-A 的 Excel 分析 Agent）：
   * 枚举「第一个有效 Sheet」的表头 / 数据行数 / 样例数据，用确定性规则识别表类型并推荐操作；
   * 规则无法确定时再调 DeepSeek 兜底；兜底再次失败则降级为「通用表」。
   * 绝不修改任何单元格内容。
   */
  async analyze(file: ExcelFile): Promise<TableAnalysis> {
    const wb = await this.loadWorkbook(file);
    const ws = this.getWorksheet(wb, undefined);

    // 表头
    const colCount = ws.columnCount || 1;
    const headers: string[] = [];
    for (let c = 1; c <= colCount; c++) {
      headers.push(cellToHeaderText(ws.getCell(1, c).value));
    }
    const realHeaders = headers.filter((h) => h !== "");
    const rowCount = Math.max(0, ws.rowCount - 1); // 去掉表头行

    // 样例数据：取前 5 行
    const sampleRows = Math.min(5, Math.max(0, ws.rowCount - 1));
    const sampleData: unknown[][] = [];
    for (let r = 2; r <= 2 + sampleRows; r++) {
      const row: unknown[] = [];
      for (let c = 1; c <= colCount; c++) {
        row.push(ws.getCell(r, c).value);
      }
      sampleData.push(row);
    }

    // 列分析
    const columns = analyzeColumns(realHeaders, sampleData);

    // 规则识别表类型
    const rule = analyzeTableTypeByRule(realHeaders);
    let tableTypeName = rule.tableTypeName;
    let suggestions: { label: string; task: Task | "describe" }[] = suggestByTableType(
      tableTypeName,
      realHeaders
    );
    let matchedBy: "rule" | "ai" = "rule";

    // 规则未确定 -> AI 兜底
    if (!tableTypeName) {
      try {
        const aiResult = await analyzeTableWithAI(realHeaders, sampleData);
        tableTypeName = aiResult.tableTypeName;
        suggestions = aiResult.suggestions.map((s) => ({
          label: s.label,
          task: s.task,
        }));
        matchedBy = "ai";
      } catch {
        // AI 兜底失败：静默降级为通用表推荐，绝不阻塞主流程
        tableTypeName = "通用表";
        suggestions = suggestByTableType("通用表", realHeaders);
        matchedBy = "rule";
      }
    }

    return {
      tableType: tableTypeNameToKey(tableTypeName),
      tableTypeName,
      columns,
      rowCount,
      sheetName: ws.name,
      sampleData,
      suggestions,
      matchedBy,
    };
  }

  async execute(req: ProcessRequest): Promise<GroupSumOutcome> {
    const t0 = Date.now();
    const { file, task } = req;
    const fieldMap = req.fieldMap;

    // 1) 读取源工作簿
    const wb = await this.loadWorkbook(file);
    const ws = this.getWorksheet(wb, task.sheetName);

    // 2) 解析表头
    const colCount = ws.columnCount || 1;
    const headers: string[] = [];
    for (let c = 1; c <= colCount; c++) {
      headers.push(cellToHeaderText(ws.getCell(1, c).value));
    }

    // 2.5) 应用字段映射：把逻辑列名替换为真实列名后再执行
    //      映射来自 fieldMatcher + 前端确认（/api/excel/match 产出的 mapping）
    const mapCol = (col: string) => (fieldMap && fieldMap[col] ? fieldMap[col] : col);
    const effTask: Task = {
      ...task,
      groupBy: task.groupBy.map(mapCol),
      calculations: task.calculations.map((c) => ({
        ...c,
        column: mapCol(c.column),
      })),
    };

    // 3) 校验任务字段是否存在（使用映射后字段，缺失时给出候选提示）
    assertFieldsExist(headers, effTask, fieldMap);
    const groupIndexes = effTask.groupBy.map((g) => findColumnIndex(headers, g));
    // 计算列：index 用映射后真实列；isAmount 依据「映射前的原始逻辑列名」
    // 是否含"金额"判断，避免映射成"合计"等名字后丢失金额身份（V0.3 修复）
    const calcCols = task.calculations.map((c, i) => ({
      column: effTask.calculations[i].column,
      index: findColumnIndex(headers, effTask.calculations[i].column),
      method: effTask.calculations[i].method,
      isAmount: /金额/.test(c.column),
    }));

    const rowCount = ws.rowCount;

    // 4) 按操作类型分派处理（程序计算，不依赖 AI）
    const op = effTask.operation;

    if (op === "distinct") {
      return this.#executeDistinct({ t0, file, headers, effTask, groupIndexes, ws, rowCount });
    }
    // count 无计算列 -> 统计分组内行数；有计算列则按 method=count 计非空值
    if (op === "count" && effTask.calculations.length === 0) {
      return this.#executeCountRows({ t0, file, headers, effTask, groupIndexes, ws, rowCount });
    }

    // 分组聚合（group_sum / sum / average / max / min 及带计算列的 count）共用同一框架
    return this.#executeAggregate({ t0, file, headers, effTask, calcCols, groupIndexes, ws, rowCount });
  }

  /**
   * 去重：按固定列（groupBy[0]，或 options.distinctBy）去重，保留首次出现的完整行。
   * 保留全部列；重复的数据行只留下一行。
   */
  async #executeDistinct(params: {
    t0: number;
    file: ExcelFile;
    headers: string[];
    effTask: Task;
    groupIndexes: number[];
    ws: ExcelJS.Worksheet;
    rowCount: number;
  }): Promise<GroupSumOutcome> {
    const { t0, file, headers, effTask, ws, rowCount } = params;

    // 去重依据列：优先 options.distinctBy，否则 groupBy[0]；"全部列"表示整行比对
    const distinctByOpt = effTask.options?.distinctBy as string | undefined;
    const distinctBy = distinctByOpt || effTask.groupBy[0];
    const byAllColumns = distinctBy === "全部列" || effTask.groupBy.includes("全部列");
    const distinctIndex = byAllColumns ? -1 : findColumnIndex(headers, distinctBy);

    if (!byAllColumns && distinctIndex === 0) {
      throw new Error(`未找到去重依据列“${distinctBy}”。`);
    }

    // 遍历数据行，按去重 key 去重，保留首次出现的完整行
    const outRows: unknown[][] = [];
    const seen = new Set<string>();
    for (let r = 2; r <= rowCount; r++) {
      const row = ws.getRow(r);
      const values: unknown[] = [];
      for (let c = 1; c <= colFor(headers); c++) {
        values.push(row.getCell(c).value);
      }
      // 整行空跳过
      if (values.every((v) => v === null || v === undefined || String(v).trim() === "")) continue;

      let key: string;
      if (byAllColumns) {
        key = values.map(cellToHeaderText).join("|");
      } else {
        key = cellToHeaderText(row.getCell(distinctIndex).value);
        if (key === "") continue; // 去重依据列为空的行忽略
      }
      if (!seen.has(key)) {
        seen.add(key);
        outRows.push(values);
      }
    }

    const outHeaders = effTask.keepHeader ? headers : headers;
    const outWb = new ExcelJS.Workbook();
    const outWs = outWb.addWorksheet("去重结果");
    outHeaders.forEach((h, i) => {
      outWs.getCell(1, i + 1).value = h;
    });
    outWs.getRow(1).font = { bold: true };
    outRows.forEach((vals, idx) => {
      const row = outWs.getRow(idx + 2);
      vals.forEach((v, ci) => {
        row.getCell(ci + 1).value = v as unknown as ExcelJS.CellValue;
      });
    });

    const resultFileId = newResultFileId();
    const outBuf = toBuffer(await outWb.xlsx.writeBuffer());
    await storage.save(resultFileId, outBuf, XLSX_MIME);
    await recordFile(resultFileId, "result").catch(() => undefined);

    const durationMs = Date.now() - t0;
    const preview: ProcessSummary = {
      headers,
      rowCount: Math.max(0, rowCount - 1),
      totalAmount: 0,
      sourceMetadata: {
        fileName: file.fileName,
        size: file.size,
        mimeType: file.mimeType,
        engine: "node/exceljs",
      },
    };
    const result: ProcessSummary = {
      headers: outHeaders,
      rowCount: outRows.length,
      totalAmount: 0,
    };

    return {
      resultFileId,
      preview,
      result,
      durationMs,
      message: byAllColumns
        ? `已删除完全重复的行，剩余 ${outRows.length} 行。`
        : `已按“${distinctBy}”去重，共 ${outRows.length} 行。`,
    };
  }

  /** count 无计算列：统计分组内行数 */
  async #executeCountRows(params: {
    t0: number;
    file: ExcelFile;
    headers: string[];
    effTask: Task;
    groupIndexes: number[];
    ws: ExcelJS.Worksheet;
    rowCount: number;
  }): Promise<GroupSumOutcome> {
    const { t0, file, headers, effTask, groupIndexes, ws, rowCount } = params;

    const counts = new Map<string, number>();
    const order: string[] = [];
    for (let r = 2; r <= rowCount; r++) {
      const row = ws.getRow(r);
      const keys = groupIndexes.map((gi) => cellToHeaderText(row.getCell(gi).value));
      if (keys.every((k) => k === "")) continue; // 空行跳过
      const key = keys.join("|") || "(空)";
      counts.set(key, (counts.get(key) || 0) + 1);
      if (!order.includes(key)) order.push(key);
    }

    const outWb = new ExcelJS.Workbook();
    const outWs = outWb.addWorksheet("计数结果");
    // 输出：分组列 + 计数列
    const outHeaders = effTask.keepHeader
      ? [...headers, "计数"]
      : [...effTask.groupBy, "计数"];
    outHeaders.forEach((h, i) => outWs.getCell(1, i + 1).value = h);
    outWs.getRow(1).font = { bold: true };

    const groupOutIndex = effTask.groupBy.map((g) => outHeaders.indexOf(g) + 1);
    const countOutIndex = outHeaders.indexOf("计数") + 1;
    order.forEach((key, idx) => {
      const row = outWs.getRow(idx + 2);
      const keyParts = key.split("|");
      groupOutIndex.forEach((oi, p) => (row.getCell(oi).value = keyParts[p]));
      row.getCell(countOutIndex).value = counts.get(key);
    });

    const resultFileId = newResultFileId();
    const outBuf = toBuffer(await outWb.xlsx.writeBuffer());
    await storage.save(resultFileId, outBuf, XLSX_MIME);
    await recordFile(resultFileId, "result").catch(() => undefined);

    const durationMs = Date.now() - t0;
    const preview: ProcessSummary = {
      headers,
      rowCount: Math.max(0, rowCount - 1),
      totalAmount: 0,
      sourceMetadata: {
        fileName: file.fileName,
        size: file.size,
        mimeType: file.mimeType,
        engine: "node/exceljs",
      },
    };
    const result: ProcessSummary = {
      headers: outHeaders,
      rowCount: order.length,
      totalAmount: 0,
    };
    return {
      resultFileId,
      preview,
      result,
      durationMs,
      message: effTask.groupBy.length
        ? `已按 ${effTask.groupBy.join("、")} 统计数量，共 ${order.length} 组。`
        : `共统计出 ${order.length} 行有效数据。`,
    };
  }

  /**
   * 分组聚合执行（sum / avg / max / min / count 与分组/简单两种形态共用）。
   * 程序根据每个计算列的 method 选择聚合函数，绝不依赖 AI 得出的数值。
   */
  async #executeAggregate(params: {
    t0: number;
    file: ExcelFile;
    headers: string[];
    effTask: Task;
    calcCols: { column: string; index: number; method: CalculationMethod; isAmount: boolean }[];
    groupIndexes: number[];
    ws: ExcelJS.Worksheet;
    rowCount: number;
  }): Promise<GroupSumOutcome> {
    const { t0, file, headers, effTask, calcCols, groupIndexes, ws, rowCount } = params;

    // groupMap 存每组每个计算列的聚合状态
    const order: string[] = [];
    const groupMap = new Map<string, AggState[]>();
    let previewAmount = 0;

    for (let r = 2; r <= rowCount; r++) {
      const row = ws.getRow(r);
      const values = calcCols.map((c) => cellToNumber(row.getCell(c.index).value));
      const groupTexts = groupIndexes.map((gi) => cellToHeaderText(row.getCell(gi).value));
      const isEmpty = values.every((v) => v === 0) && groupTexts.every((t) => t === "");
      if (isEmpty) continue;

      const key = groupTexts.join("|") || "(空)";

      let states = groupMap.get(key);
      if (!states) {
        states = calcCols.map((c) => initAggState(c.method, values[calcCols.indexOf(c)]));
        groupMap.set(key, states);
        order.push(key);
      } else {
        const existing = states;
        calcCols.forEach((c, i) => {
          aggregateInto(existing[i], c.method, values[i]);
        });
      }

      // 处理前金额合计（供审查）
      calcCols.forEach((c, i) => {
        if (c.isAmount && (c.method === "sum" || c.method === "count")) {
          previewAmount += values[i];
        }
      });
    }

    const dataRowCount = Math.max(0, rowCount - 1);

    // 结果工作簿
    const outWb = new ExcelJS.Workbook();
    const outWs = outWb.addWorksheet("汇总结果");
    const outHeaders = effTask.keepHeader
      ? headers
      : [...effTask.groupBy, ...calcCols.map((c) => c.column)];
    outHeaders.forEach((h, i) => (outWs.getCell(1, i + 1).value = h));
    outWs.getRow(1).font = { bold: true };

    const groupOutIndex = effTask.groupBy.map((g) => outHeaders.indexOf(g) + 1);
    const calcOutIndex = calcCols.map((c) => outHeaders.indexOf(c.column) + 1);

    order.forEach((key, idx) => {
      const states = groupMap.get(key)!;
      const row = outWs.getRow(idx + 2);
      const keyParts = key.split("|");
      groupOutIndex.forEach((oi, p) => (row.getCell(oi).value = keyParts[p]));
      calcOutIndex.forEach((oi, ci) => {
        row.getCell(oi).value = finalizeAgg(states[ci], calcCols[ci].method);
      });
    });

    const resultFileId = newResultFileId();
    const outBuf = toBuffer(await outWb.xlsx.writeBuffer());
    await storage.save(resultFileId, outBuf, XLSX_MIME);
    await recordFile(resultFileId, "result").catch(() => undefined);

    // 处理后金额合计（仅真的可加总的方法）
    let resultAmount = 0;
    calcCols.forEach((c, i) => {
      if (c.isAmount && c.method === "sum") {
        for (const st of groupMap.values()) resultAmount += finalizeAgg(st[i], c.method) as number;
      }
    });

    const durationMs = Date.now() - t0;
    const preview: ProcessSummary = {
      headers,
      rowCount: dataRowCount,
      totalAmount: previewAmount,
      sourceMetadata: {
        fileName: file.fileName,
        size: file.size,
        mimeType: file.mimeType,
        engine: "node/exceljs",
      },
    };
    const result: ProcessSummary = {
      headers: outHeaders,
      rowCount: order.length,
      totalAmount: resultAmount,
    };
    const methodLabel: Record<CalculationMethod, string> = { sum: "求和", avg: "求平均", max: "最大值", min: "最小值", count: "计数" };
    const calcDesc = calcCols
      .map((c) => `${c.column}(${methodLabel[c.method]})`)
      .join("、");
    return {
      resultFileId,
      preview,
      result,
      durationMs,
      message: effTask.groupBy.length
        ? `已按 ${effTask.groupBy.join("、")} 分组并${calcDesc}，共 ${order.length} 组。`
        : `已${calcDesc}。`,
    };
  }
}

/** Python 微服务实现位（预留，后续通过 HTTP 桥接 pandas + openpyxl） */
class PythonProcessor implements ExcelProcessor {
  async readHeaders(_file: ExcelFile): Promise<string[]> {
    throw new Error("Python 生态处理器尚未接入（当前使用 Node/exceljs 引擎）。");
  }

  async analyze(_file: ExcelFile): Promise<TableAnalysis> {
    throw new Error("Python 生态处理器尚未接入（当前使用 Node/exceljs 引擎）。");
  }

  async execute(_req: ProcessRequest): Promise<GroupSumOutcome> {
    throw new Error("Python 生态处理器尚未接入（当前使用 Node/exceljs 引擎）。");
  }
}

/**
 * Excel 执行 Agent 的「编排器」：
 * 只做「拿到 Task -> 交给程序引擎 -> 返回结果」的调度，不掺入 AI 生成逻辑。
 * 通过环境变量 EXCEL_ENGINE 选择实现（node | python），默认 node。
 */
export class ExcelEngine {
  private processor: ExcelProcessor;

  constructor() {
    const engine = process.env.EXCEL_ENGINE || "node";
    this.processor = engine === "python" ? new PythonProcessor() : new NodeProcessor();
  }

  /** 读取表头（供需求理解 Agent 使用） */
  readHeaders(file: ExcelFile): Promise<string[]> {
    return this.processor.readHeaders(file);
  }

  /** 只读分析表结构/类型/推荐（供 Excel 分析 Agent 使用） */
  analyze(file: ExcelFile): Promise<TableAnalysis> {
    return this.processor.analyze(file);
  }

  /** 执行处理（供 Excel 执行 Agent 使用） */
  executeTask(req: ProcessRequest): Promise<GroupSumOutcome> {
    return this.processor.execute(req);
  }
}

/** 默认单例，供各 API 路由复用 */
export const excelEngine = new ExcelEngine();

/** 根据场景创建独立实例 */
export function createExcelEngine(): ExcelEngine {
  return new ExcelEngine();
}
