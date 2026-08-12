/**
 * @file verifier.ts
 * @description 结果审查 Agent 的「程序」部分（V0.2）。
 *
 * 原则：模型（ai/deepseek.ts）的审查结论仅供参考，真正判定是否放行的是
 *       本文件的确定性规则。
 * 检查项（本阶段）：
 *   1. 数据完整性 —— 比较处理前后数据量
 *   2. 金额一致性 —— 比较处理前后总金额
 *   3. 表头检查   —— 原始表头是否保留
 *   4. 任务完成   —— 用户要求的字段是否执行
 */
import type { ProcessSummary, Task, VerificationSuite } from "@/types/task";

/** 分类汇总时允许行数合理减少的判定阈值（处理后 >= 原行数*0.1 视为正常） */
const SHRINK_THRESHOLD = 0.1;

/**
 * 综合「处理前摘要」与「处理后摘要」+ 用户任务，产出程序化审查报告。
 * @param preview 处理前摘要
 * @param result  处理后摘要
 * @param task    结构化任务（用于字段完成检查）
 */
export function verifyProcessResult(
  preview: ProcessSummary,
  result: ProcessSummary,
  task: Task
): VerificationSuite {
  const checks: VerificationSuite["checks"] = [];

  // 1) 数据完整性：处理前后数据量
  const expected = preview.rowCount;
  const actual = result.rowCount;
  const abnormallyShrunk = actual === 0 || actual < expected * SHRINK_THRESHOLD;
  checks.push({
    name: "数据完整性",
    result: abnormallyShrunk ? "警告" : "通过",
    detail: `处理前 ${expected} 行，处理后 ${actual} 行${abnormallyShrunk ? "，数据异常减少。" : "（分组汇总属正常减少）。"}`,
  });

  // 2) 金额一致性：仅在有金额列（totalAmount>0）时检查
  let moneyWarn = false;
  if (preview.totalAmount > 0 && result.totalAmount > 0) {
    // 分组求和不改变总额，出现偏差视为计算可能异常
    const diff = Math.abs(result.totalAmount - preview.totalAmount);
    const relative = diff / preview.totalAmount;
    moneyWarn = relative > 1e-6;
    checks.push({
      name: "金额校验",
      result: moneyWarn ? "警告" : "通过",
      detail: `处理前总金额 ${preview.totalAmount.toFixed(2)}，处理后总金额 ${result.totalAmount.toFixed(2)}${moneyWarn ? "，金额存在差异。" : "，金额一致。"}`,
    });
  } else {
    checks.push({ name: "金额校验", result: "通过", detail: "未检测到金额字段，跳过金额一致性检查。" });
  }

  // 3) 表头检查：原始表头是否保留
  const keepHeader = !!task.keepHeader;
  const headersKept =
    result.headers.length === preview.headers.length &&
    result.headers.every((h, i) => h === preview.headers[i]);
  checks.push({
    name: "表头检查",
    result: keepHeader && headersKept ? "通过" : "警告",
    detail: keepHeader
      ? (headersKept ? "原始表头已保留。" : "处理后表头与原始表头不一致。")
      : "需求未要求保留原表头。",
  });

  // 4) 任务完成检查：用户要求的字段是否在结果表头中执行
  // 用 task.groupBy + task.calculations 判断目标列是否出现在结果表头
  // V0.5-A：distinct 的"全部列"是整行去重哨兵值，非真实列名，跳过此项检查。
  if (task.operation === "distinct") {
    checks.push({
      name: "任务完成检查",
      result: "通过",
      detail:
        headersKept
          ? "已去重并保留原表头。"
          : "已按需求去重。",
    });
  } else {
    const targetCols = [...task.groupBy, ...task.calculations.map((c) => c.column)];
    const missingInResult = targetCols.filter((col) => !result.headers.includes(col));
    checks.push({
      name: "任务完成检查",
      result: missingInResult.length === 0 ? "通过" : "未完成",
      detail:
        missingInResult.length === 0
          ? `已执行字段：${targetCols.join("、")}。`
          : `结果中缺失字段：${missingInResult.join("、")}。`,
    });
  }

  // ---- V0.3 增强：汇总文案 + 更细粒度说明 ----
  const failure = checks.filter((c) => c.result !== "通过");
  const success = failure.length === 0;
  const summary = success
    ? "处理完成，各项校验均通过，结果可以放心使用。"
    : `处理完成，但有 ${failure.length} 项需要留意（${failure.map((f) => f.name).join("、")}），建议核实后再使用。`;

  const details: string[] = [];
  if (preview.sourceMetadata?.fileName) {
    details.push(`源文件：${preview.sourceMetadata.fileName}` +
      (preview.sourceMetadata.size ? `（${(preview.sourceMetadata.size / 1024).toFixed(1)} KB）` : "") +
      (preview.sourceMetadata.engine ? `，引擎：${preview.sourceMetadata.engine}` : ""));
  }
  if (success) {
    details.push("数据完整性、金额一致性、表头保留、任务字段均符合预期。");
  } else {
    for (const c of failure) {
      if (c.detail) details.push(`【${c.name}】${c.detail}`);
    }
    details.push("若确认数据无误，可忽略警告继续使用；否则请检查源表格后重试。");
  }

  return {
    success,
    checks,
    summary,
    details,
  };
}
