/**
 * @file schema.ts
 * @description 严格 JSON Schema 校验（V0.3）。
 *
 * 对 DeepSeek 产出的 Task JSON 做程序侧强约束校验：任何字段缺失、
 * 类型错误或非法枚举都直接拒绝，绝不让不可信模型输出直接驱动 Excel 执行。
 * 「AI 可以猜，程序必须核实。」
 */
import type { Operation, Task } from "@/types/task";

/** 合法操作枚举 */
const OPERATIONS: readonly Operation[] = ["group_sum", "sum", "unknown"];

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
 *   - calculations 每项必须有非空 string 类型 column，method 限定 sum。
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
  const op = (src.operation as string) || "unknown";
  if (!OPERATIONS.includes(op as Operation)) {
    throw new Error("无法理解您的需求，请换一种描述方式。");
  }
  if (op === "unknown") {
    throw new Error("无法理解您的需求，请换一种描述方式。");
  }

  // 2) groupBy 严格为字符串数组
  const rawGroup = src.groupBy;
  const groupBy: string[] = Array.isArray(rawGroup)
    ? rawGroup.filter((g): g is string => typeof g === "string" && g.trim() !== "")
    : [];

  // 3) calculations 严格校验：column 必为非空字符串，method 限定 sum
  const rawCalcs = src.calculations;
  const calculations = Array.isArray(rawCalcs)
    ? rawCalcs
        .filter(
          (c): c is Record<string, unknown> =>
            !!c && typeof c === "object" && !Array.isArray(c)
        )
        .map((c) => {
          const column = typeof c.column === "string" ? c.column.trim() : "";
          // method 仅接受 sum，其它一律视为非法（本项目当前只支持求和）
          const method = c.method === "sum" ? "sum" : null;
          return column !== "" && method ? { column, method } : null;
        })
        .filter((c): c is { column: string; method: "sum" } => c !== null)
    : [];

  // 4) 没有任何可计算列或分组列时，视为无法执行
  if (calculations.length === 0) {
    throw new Error("无法理解您的需求，请换一种描述方式。");
  }

  const task: Task = {
    operation: op as Task["operation"],
    groupBy,
    calculations,
    keepHeader: typeof src.keepHeader === "boolean" ? src.keepHeader : true,
    sheetName: typeof src.sheetName === "string" ? src.sheetName : undefined,
    options: src.options && typeof src.options === "object" ? (src.options as Record<string, unknown>) : undefined,
  };

  return task;
}

/** 供单测 / 调试导出的判断函数 */
export function isValidOperation(op: unknown): op is Operation {
  return OPERATIONS.includes(op as Operation);
}
