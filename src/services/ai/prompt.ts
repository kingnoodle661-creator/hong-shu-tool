/**
 * @file prompt.ts
 * @description 面向 DeepSeek 模型的 Prompt 模板。
 * 只做纯粹的「文本 -> 结构化 JSON」转换，绝不直接操作 Excel。
 * 所有模板都引导模型输出严格、可被程序校验的 JSON（V0.2 协议）。
 */

/**
 * 需求理解 Prompt：
 * 将用户自然语言需求转换为结构化 Task JSON。
 * 通过示例注入 + JSON Schema 约束，降低 AI 幻觉（输出多余字段或非法结构）的风险。
 */
export function buildTaskParsePrompt(userRequirement: string, headers: string[]): string {
  return [
    "你是一个 Excel 表格处理需求理解助手。",
    "根据用户的一句话需求，把它转换成结构化任务 JSON。",
    "",
    "约束：",
    "1. 只能输出一个合法 JSON，不要输出其它解释文字。",
    "2. JSON 结构如下：",
    '{ "operation": "group_sum | sum | unknown", "groupBy": ["分组列名"], "calculations": [ { "column": "参与计算的列名", "method": "sum" } ], "keepHeader": true, "sheetName": "" }',
    "3. operation 只能是 group_sum（分组汇总）、sum（求和）或 unknown（无法判断）。",
    "4. 涉及按某列分组（如“按商品名称汇总”）时，把该列放入 groupBy。",
    "5. 涉及计算数量的列（如“采购数量”“采购金额”）放入 calculations，method 用 sum。",
    "6. 引用的列名必须来自下面提供的表头列表，不要臆造列名；表头为空时用自然描述并不额外创建列。",
    "7. keepHeader 一般为 true（保持原表头）。",
    "",
    `表格可用表头：${headers.join(", ") || "未知（请用自然描述，不额外创建列）"}`,
    "",
    `用户需求：${userRequirement}`,
    "",
    "请输出 JSON：",
  ].join("\n");
}

/**
 * 结果审查辅助 Prompt：
 * 让模型基于处理前后的摘要给出参考意见。
 * 注意：模型只能输出参考结论，最终判定由程序（verify/verifier.ts）完成。
 */
export function buildVerificationPrompt(
  userRequirement: string,
  originalSummary: Record<string, unknown>,
  resultSummary: Record<string, unknown>
): string {
  return [
    "你是一个 Excel 处理结果审查助手。",
    "对比处理前后的摘要，判断结果是否可疑、是否符合用户需求。",
    "",
    "只能输出合法 JSON，不要附加解释：",
    '{ "checks": [ { "name": "检查项名称", "result": "通过|警告|未完成", "detail": "说明" } ] }',
    "",
    `用户需求：${userRequirement}`,
    `处理前摘要：${JSON.stringify(originalSummary)}`,
    `处理后摘要：${JSON.stringify(resultSummary)}`,
    "",
    "请输出 JSON：",
  ].join("\n");
}
