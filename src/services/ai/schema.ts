/**
 * @file schema.ts
 * @description 严格 JSON Schema 校验（V0.3 基础 + V0.5-A 扩展）。
 *
 * 对 DeepSeek 产出的 Task JSON 做程序侧强约束校验：任何字段缺失、
 * 类型错误或非法枚举都直接拒绝，绝不让不可信模型输出直接驱动 Excel 执行。
 * 「AI 可以猜，程序必须核实。」
 * V0.5-A：operation/method 白名单扩展；新增意图(澄清)结果的解析与容错。
 */
import type {
  CalculationMethod,
  ClarifyResult,
  Operation,
  Task,
} from "@/types/task";

/**
 * 合法操作枚举（V0.5-A 扩展为全套办公操作）。
 * 注意：不再包含 "unknown"——需求无法映射时应走「澄清」而非硬编非法任务。
 */
const OPERATIONS: readonly Operation[] = [
  "group_sum",
  "sum",
  "count",
  "distinct",
  "average",
  "max",
  "min",
];

/** 合法计算方法枚举 */
const METHODS: readonly string[] = ["sum", "avg", "max", "min", "count"];

/** 校验结果 */
export interface SchemaResult {
  ok: boolean;
  task: Task;
  /** 首条错误信息（ok=false 时可用） */
  error?: string;
}

/**
 * 把模型产出的任意对象规范为合法的 Task，并整体校验。
 * 采用「白名单 + 必须字段」策略：
 *   - operation 必须是枚举之一。
 *   - groupBy 必须是字符串数组（非字符串项剔除；全部剔除视为非法）。
 *   - calculations 每项必须有非空 string 类型 column，method 限定在 METHODS 内。
 *   - keepHeader 缺省为 true。
 *   - sheetName / options 缺省。
 * @throws 任何校验失败抛错（上层转成用户友好提示）
 */
export function parseAndValidateTask(raw: unknown): Task {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("AI 返回结构非法。");
  }
  const src = raw as Record<string, unknown>;

  // 1) operation 枚举校验
  const op = (src.operation as string) || "";
  if (!OPERATIONS.includes(op as Operation)) {
    throw new Error("无法理解您的需求，请换一种描述方式。");
  }

  // 2) groupBy 严格为字符串数组
  const rawGroup = src.groupBy;
  const groupBy: string[] = Array.isArray(rawGroup)
    ? rawGroup.filter((g): g is string => typeof g === "string" && g.trim() !== "")
    : [];

  // 3) calculations 严格校验：column 必为非空字符串，method 限定 METHODS 内
  const rawCalcs = src.calculations;
  const calculations = Array.isArray(rawCalcs)
    ? rawCalcs
        .filter(
          (c): c is Record<string, unknown> =>
            !!c && typeof c === "object" && !Array.isArray(c)
        )
        .map((c) => {
          const column = typeof c.column === "string" ? c.column.trim() : "";
          const method =
            typeof c.method === "string" && METHODS.includes(c.method)
              ? (c.method as CalculationMethod)
              : null;
          return column !== "" && method ? { column, method } : null;
        })
        .filter((c): c is { column: string; method: CalculationMethod } => c !== null)
    : [];

  // 4) 没有任何可计算列或分组列时，视为无法执行
  if (op === "distinct") {
    // distinct 允许仅有去重依据列而无 calculations
    if (groupBy.length === 0) {
      throw new Error("无法理解您的需求，请换一种描述方式。");
    }
  } else if (calculations.length === 0 && op !== "count") {
    // count 无计算列时表示“数行数”，合法；其它操作必须至少一个计算列
    throw new Error("无法理解您的需求，请换一种描述方式。");
  }

  const task: Task = {
    operation: op as Task["operation"],
    groupBy,
    calculations,
    keepHeader: typeof src.keepHeader === "boolean" ? src.keepHeader : true,
    sheetName: typeof src.sheetName === "string" ? src.sheetName : undefined,
    options:
      src.options && typeof src.options === "object" && !Array.isArray(src.options)
        ? (src.options as Record<string, unknown>)
        : undefined,
  };

  return task;
}

/** 供单测 / 调试导出的判断函数 */
export function isValidOperation(op: unknown): op is Operation {
  return OPERATIONS.includes(op as Operation);
}

/* ------------------------------------------------------------------ */
/* V0.5-A：意图(澄清)结果的解析与容错                                   */
/* ------------------------------------------------------------------ */

/**
 * 解析「意图判断」结果。judge ∈ ready | need_confirm。
 * 解析失败/非法时返回 null（由调用方安全降级）。
 */
export function parseIntentJudge(raw: unknown): "ready" | "need_confirm" | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const judge = (raw as Record<string, unknown>).judge;
  if (judge === "ready" || judge === "need_confirm") return judge;
  return null;
}

/**
 * 把模型产出的「澄清结果」转成 ClarifyResult。
 * 容错策略：任何解析失败都安全地退化为 need_confirm（给一个通用澄清问题），
 * 绝不抛出「无法理解」——这是 V0.5-A「模糊需求不报错」的核心。
 * @param raw 模型输出的澄清 JSON
 * @param headers 表头（用于生成兜底 question 的参考）
 */
export function parseAndNormalizeClarify(raw: unknown, headers: string[]): ClarifyResult {
  const fallback: ClarifyResult = {
    status: "need_confirm",
    questions: [
      {
        question: "您想如何整理这份表？",
        options: buildDefaultClarifyOptions(headers),
      },
    ],
  };

  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return fallback;
  const src = raw as Record<string, unknown>;

  const questionsRaw = src.questions;
  if (!Array.isArray(questionsRaw) || questionsRaw.length === 0) return fallback;

  const questions = questionsRaw
    .map((q) => {
      if (!q || typeof q !== "object" || Array.isArray(q)) return null;
      const qq = q as Record<string, unknown>;
      const question =
        typeof qq.question === "string" && qq.question.trim() !== ""
          ? qq.question.trim()
          : "您想如何整理这份表？";
      const optsRaw = Array.isArray(qq.options) ? qq.options : [];
      const options = optsRaw
        .map((o) => {
          if (!o || typeof o !== "object" || Array.isArray(o)) return null;
          const oo = o as Record<string, unknown>;
          const label =
            typeof oo.label === "string" && oo.label.trim() !== ""
              ? oo.label.trim()
              : null;
          if (!label) return null;
          let task: Task | undefined;
          try {
            const t = oo.task as unknown;
            if (t && typeof t === "object" && !Array.isArray(t)) {
              task = parseAndValidateTask(t);
            }
          } catch {
            task = undefined; // task 非法则该选项仅作描述提示
          }
          return task ? { label, task } : { label };
        })
        .filter((o): o is NonNullable<typeof o> => o !== null);
      return { question, options };
    })
    .filter((q): q is NonNullable<typeof q> => q !== null);

  if (questions.length === 0) return fallback;

  return { status: "need_confirm", questions };
}

/**
 * 生成默认澄清选项（兜底 / 表分析推荐也复用）。
 * 基于表头给出常用可执行操作。
 */
export function buildDefaultClarifyOptions(headers: string[]): {
  label: string;
  task: Task;
}[] {
  // 找到第一个“看起来是文本分组列”与第一个“数值/金额列”，供默认任务引用
  const groupCandidate = headers.find((h) => !/^(数量|金额|价格|单价|数量|合计|小计)$/i.test(h)) || headers[0] || "第一列";
  const amountCandidate =
    headers.find((h) => /金额|价格|单价|费用/.test(h)) ||
    headers.find((h) => /数量/.test(h)) ||
    headers[1] ||
    headers[0] ||
    "第二列";

  const mk = (label: string, task: Task) => ({ label, task });

  return [
    mk(`按“${groupCandidate}”分组汇总`, {
      operation: "group_sum",
      groupBy: [groupCandidate],
      calculations: [{ column: amountCandidate, method: "sum" }],
      keepHeader: true,
      sheetName: "",
      options: {},
    }),
    mk(`统计“${groupCandidate}”的种类`, {
      operation: "count",
      groupBy: [groupCandidate],
      calculations: [],
      keepHeader: true,
      sheetName: "",
      options: {},
    }),
    mk("删除完全重复的行", {
      operation: "distinct",
      groupBy: ["全部列"],
      calculations: [],
      keepHeader: true,
      sheetName: "",
      options: {},
    }),
    mk(`对“${amountCandidate}”求和`, {
      operation: "sum",
      groupBy: [],
      calculations: [{ column: amountCandidate, method: "sum" }],
      keepHeader: true,
      sheetName: "",
      options: {},
    }),
  ];
}
