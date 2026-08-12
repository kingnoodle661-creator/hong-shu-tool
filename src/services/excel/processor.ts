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
import type {
  ExcelFile,
  ProcessRequest,
  ProcessSummary,
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
      isAmount: /金额/.test(c.column),
    }));

    // 4) 遍历数据行：分组 + 求和（程序计算，不依赖 AI）
    //    使用 Map 记录「首次出现顺序」以保持分组稳定性；key 用组值序列
    const order: string[] = [];
    const groupMap = new Map<string, (number | string)[]>();
    const rowCount = ws.rowCount;

    // 处理前金额合计（用于金额一致性审查）：只累计"含金额"的计算列
    let previewAmount = 0;

    for (let r = 2; r <= rowCount; r++) {
      const row = ws.getRow(r);
      // 跳过空行
      const isEmpty = calcCols.every((c) => cellToNumber(row.getCell(c.index).value) === 0) &&
        groupIndexes.every((gi) => cellToHeaderText(row.getCell(gi).value) === "");
      if (isEmpty) continue;

      // 组 key：多个 groupBy 列用分隔符连接
      const key = groupIndexes
        .map((gi) => cellToHeaderText(row.getCell(gi).value))
        .join("|") || "(空)";

      if (!groupMap.has(key)) {
        groupMap.set(key, calcCols.map(() => 0));
        order.push(key);
      }
      const acc = groupMap.get(key)!;
      calcCols.forEach((c, i) => {
        acc[i] = (acc[i] as number) + cellToNumber(row.getCell(c.index).value);
        if (c.isAmount) {
          previewAmount += cellToNumber(row.getCell(c.index).value);
        }
      });
    }

    // 5) 已处理行数（不含表头）
    const dataRowCount = rowCount - 1;

    // 6) 生成结果工作簿：保留原表头
    const outWb = new ExcelJS.Workbook();
    const outWs = outWb.addWorksheet("汇总结果");

    // 结果表头：keepHeader 时沿用原表头全列，否则仅分组列 + 计算列
    const outHeaders = effTask.keepHeader
      ? headers
      : [...effTask.groupBy, ...effTask.calculations.map((c) => c.column)];
    outHeaders.forEach((h, i) => {
      outWs.getCell(1, i + 1).value = h;
    });
    // 表头加粗，便于阅读
    outWs.getRow(1).font = { bold: true };

    // 计算每个目标列在「输出表头」中的列位置（1-based），保证两种模式下都正确
    const groupOutIndex = effTask.groupBy.map((g) => outHeaders.indexOf(g) + 1);
    const calcOutIndex = calcCols.map((c) => outHeaders.indexOf(c.column) + 1);

    // 汇总数据行：groupBy 列填组值，计算列填求和值，其余列留空
    order.forEach((key, idx) => {
      const acc = groupMap.get(key)!;
      const row = outWs.getRow(idx + 2);
      // 还原多分组列
      const keyParts = key.split("|");
      groupOutIndex.forEach((oi, p) => {
        row.getCell(oi).value = keyParts[p];
      });
      // 填充计算列求和值
      calcOutIndex.forEach((oi, ci) => {
        row.getCell(oi).value = acc[ci];
      });
    });

    // 7) 写出结果文件：生成随机 fileId，交由存储层保存（local/BLOB 统一；不落本地路径）
    const resultFileId = newResultFileId();
    const outBuf = toBuffer(await outWb.xlsx.writeBuffer());
    await storage.save(resultFileId, outBuf, XLSX_MIME);
    await recordFile(resultFileId, "result").catch(() => undefined);

    // 8) 处理后金额合计（依据映射前逻辑列是否是金额）
    let resultAmount = 0;
    calcCols.forEach((c, i) => {
      if (c.isAmount) {
        for (const acc of groupMap.values()) {
          resultAmount += acc[i] as number;
        }
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

    return {
      resultFileId,
      preview,
      result,
      durationMs,
      message: `已按 ${effTask.groupBy.join("、")} 分组并汇总 ${effTask.calculations.map((c) => c.column).join("、")}，共 ${order.length} 组。`,
    };
  }
}

/** Python 微服务实现位（预留，后续通过 HTTP 桥接 pandas + openpyxl） */
class PythonProcessor implements ExcelProcessor {
  async readHeaders(_file: ExcelFile): Promise<string[]> {
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
