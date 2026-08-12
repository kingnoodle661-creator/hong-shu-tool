/**
 * @file tableAnalyzer.ts
 * @description Excel 表类型识别的「确定性规则层」（V0.5-A）。
 *
 * 职责：根据表头关键词，快速判断这份表是什么类型的表（采购/销售/库存/财务/明细/通用），
 *       并给出常用处理操作的推荐。
 * 纯规则、可复现、可测试；规则无法确定时返回 null，由调用方走 AI 兜底。
 * 只读分析，绝不修改 Excel 内容。
 */
import type {
  CalculationMethod,
  TableColumnInfo,
  TableTypeName,
  Task,
} from "@/types/task";

/** 归一化表头文本：去空白、统一全半角、小写 */
function norm(s: string): string {
  return s
    .replace(/[\s　·．・，,]/g, "")
    .replace(/[（(]/g, "(")
    .replace(/[）)]/g, ")")
    .toLowerCase();
}

/** 表头命中某组关键词，返回命中的关键词列表 */
function hits(header: string, keywords: string[]): string[] {
  const n = norm(header);
  return keywords.filter((k) => n.includes(norm(k)));
}

/** 表类型识别结果 */
export interface RuleAnalysis {
  /** 识别的表类型（null 表示规则无法确定，需 AI 兜底） */
  tableTypeName: TableTypeName | null;
  /** 置信度得分（用于与 AI 结果择优，非必需） */
  score: number;
}

/**
 * 表头特征 -> 表类型 的规则映射（顺序即优先级）。
 * 每条规则：当表头命中足够多的关键词时，判定为该表类型。
 */
const TYPE_RULES: {
  type: TableTypeName;
  score: number;
  must?: string[];
  any?: string[];
  minHits?: number;
}[] = [
  {
    type: "采购表",
    score: 9,
    must: ["采购"],
    any: ["商品", "产品", "物品", "货物", "数量", "金额", "单价", "供应商", "供货商"],
  },
  {
    type: "销售表",
    score: 9,
    must: ["销售"],
    any: ["客户", "订单", "商品", "数量", "金额", "单价", "营收", "销售额"],
  },
  {
    type: "库存表",
    score: 9,
    must: ["库存"],
    any: ["数量", "单价", "金额", "仓库", "货品", "商品", "结存", "出库", "入库"],
  },
  {
    type: "财务表",
    score: 8,
    any: ["金额", "费用", "收入", "支出", "利润", "科目", "账"],
  },
  {
    type: "明细表",
    score: 7,
    any: ["明细", "流水", "记录"],
  },
];

/**
 * 用确定性规则识别表类型。
 * @param headers 表头列表
 * @returns 命中规则的识别结果；全部不命中返回 { tableTypeName: null, score: 0 }
 */
export function analyzeTableTypeByRule(headers: string[]): RuleAnalysis {
  let best: RuleAnalysis = { tableTypeName: null, score: 0 };

  for (const rule of TYPE_RULES) {
    // 若规定了 must 关键词，必须全部命中才行
    if (rule.must && !rule.must.every((k) => headers.some((h) => hits(h, [k]).length > 0))) {
      continue;
    }
    if (rule.any) {
      const hitCount = rule.any.reduce((acc, k) => acc + (headers.some((h) => hits(h, [k]).length > 0) ? 1 : 0), 0);
      if (hitCount === 0) continue;
      // 需至少命中（默认一半或显式 minHits）才算该规则成立
      const need = rule.minHits ?? Math.max(1, Math.ceil((rule.any?.length ?? 0) / 3));
      if (hitCount < need) continue;
    }
    if (rule.score > best.score) {
      best = { tableTypeName: rule.type, score: rule.score };
    }
  }

  return best;
}

/** 推断单列类型 */
function inferColumnType(header: string, sampleValues: unknown[]): TableColumnInfo["type"] {
  const h = norm(header);
  if (/金额|价格|单价|费用|成本|利润|款|合计|总额|小计|收入|支出/.test(h)) return "amount";
  if (/日期|时间|年月|date/i.test(h)) return "date";
  // 用样例判断数值列
  if (sampleValues.length > 0) {
    const parsed = sampleValues.map((v) => Number(String(v ?? "").replace(/[,，￥¥\s元]/g, "")));
    if (parsed.some((n) => Number.isFinite(n) && n !== 0)) return "number";
  }
  return "text";
}

/** 分析表头列信息 */
export function analyzeColumns(
  headers: string[],
  sampleData: unknown[][]
): TableColumnInfo[] {
  return headers.map((header, i) => {
    const sampleValues = sampleData.map((row) => row[i]);
    return {
      header,
      type: inferColumnType(header, sampleValues),
      hint: hintForHeader(header),
    };
  });
}

/** 基于表头给出字段含义提示 */
function hintForHeader(header: string): string | undefined {
  const find = (ks: string[]): boolean => ks.some((k) => norm(header).includes(norm(k)));
  if (find(["商品", "品名", "产品", "货物", "物品"])) return "可能是商品/物品名称";
  if (find(["金额", "款", "合计", "总额", "小计"])) return "可能是金额";
  if (find(["数量", "个数", "件数"])) return "可能是数量";
  if (find(["单价", "价格", "售价"])) return "可能是单价";
  if (find(["日期", "时间"])) return "可能是日期";
  if (find(["供应商", "供货商", "客户"])) return "可能是往来单位";
  if (find(["备注", "说明"])) return "可能是备注";
  return undefined;
}

/** 选定一个推荐用「分组列」与「数值/金额列」 */
function pickColumns(headers: string[]): { group: string; value: string } {
  const group =
    headers.find((h) => hitWith(h, ["商品", "品名", "产品", "货物", "客户", "供应商", "名称", "类别", "类型"])) ||
    headers[0] ||
    "第一列";
  const value =
    headers.find((h) => hitWith(h, ["金额", "合计", "总额", "款"])) ||
    headers.find((h) => hitWith(h, ["数量", "个数"])) ||
    headers[1] ||
    headers[0] ||
    "第二列";
  return { group, value };
}

function hitWith(header: string, ks: string[]): boolean {
  return ks.some((k) => norm(header).includes(norm(k)));
}

function mkTask(
  operation: Task["operation"],
  groupBy: string[],
  calc?: { column: string; method: CalculationMethod }
): Task {
  return {
    operation,
    groupBy,
    calculations: calc ? [calc] : [],
    keepHeader: true,
    sheetName: "",
    options: {},
  };
}

/**
 * 根据表类型生成推荐操作（纯规则，确定性）。
 * @param tableTypeName 已识别的表类型
 * @param headers 表头
 */
export function suggestByTableType(
  tableTypeName: TableTypeName | null,
  headers: string[]
): { label: string; task: Task | "describe" }[] {
  const { group, value } = pickColumns(headers);
  const value2 =
    headers.find((h) => hitWith(h, ["数量", "个数"])) ||
    headers.find((h) => hitWith(h, ["金额", "合计", "款"])) ||
    headers[1] ||
    "第二列";
  const group2 =
    headers.find((h) => hitWith(h, ["客户", "供应商", "商品", "品名"])) ||
    group;

  const common: { label: string; task: Task | "describe" }[] = [
    { label: `按“${group}”分组汇总`, task: mkTask("group_sum", [group], { column: value, method: "sum" }) },
    { label: "删除完全重复的行", task: mkTask("distinct", ["全部列"]) },
    { label: `统计“${group2}”的种类`, task: mkTask("count", [group2]) },
    descriptionTask(),
  ];

  switch (tableTypeName) {
    case "采购表":
      return [
        { label: `按“${group}”汇总采购数量与金额`, task: mkTask("group_sum", [group], { column: value, method: "sum" }) },
        { label: `统计采购${group2}数`, task: mkTask("count", [group2]) },
        { label: "删除重复的采购记录", task: mkTask("distinct", ["全部列"]) },
        descriptionTask(),
      ];
    case "销售表":
      return [
        { label: `按${group2}汇总销售额`, task: mkTask("group_sum", [group2], { column: value, method: "sum" }) },
        { label: `统计客户${group2}` , task: mkTask("count", [group2]) },
        { label: `对“${value}”求平均`, task: mkTask("average", [], { column: value, method: "avg" }) },
        descriptionTask(),
      ];
    case "库存表":
      return [
        { label: `按${group}统计出入库`, task: mkTask("count", [group]) },
        { label: `统计${value2}合计`, task: mkTask("sum", [], { column: value2, method: "sum" }) },
        { label: "删除重复的库存行", task: mkTask("distinct", ["全部列"]) },
        descriptionTask(),
      ];
    case "财务表":
      return [
        { label: `按“${group}”汇总`, task: mkTask("group_sum", [group], { column: value, method: "sum" }) },
        { label: `对“${value}”求和`, task: mkTask("sum", [], { column: value, method: "sum" }) },
        { label: `对“${value}”求平均`, task: mkTask("average", [], { column: value, method: "avg" }) },
        descriptionTask(),
      ];
    case "明细表":
    case "通用表":
    default:
      return common;
  }
}

function descriptionTask(): { label: string; task: "describe" } {
  return { label: "我来描述想要的处理…", task: "describe" };
}
