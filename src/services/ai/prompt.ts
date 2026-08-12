/**
 * @file prompt.ts
 * @description 面向 DeepSeek 模型的 Prompt 模板（V0.5-A 扩展）。
 * 只做纯粹的「文本 -> 结构化 JSON」转换，绝不直接操作 Excel。
 * 所有模板都引导模型输出严格、可被程序校验的 JSON（V0.2 协议）。
 * 核心原则：AI 只理解/分析/推荐，生成任务 JSON；执行仍由程序完成。
 */

import type { Operation } from "@/types/task";

/** 当前支持的可执行操作枚举，供 prompt 注入约束模型 */
const OPERATION_LIST: Operation[] = [
  "group_sum",
  "sum",
  "count",
  "distinct",
  "average",
  "max",
  "min",
];

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
    '{ "operation": "group_sum | sum | count | distinct | average | max | min", "groupBy": ["分组列名"], "calculations": [ { "column": "参与计算的列名", "method": "sum | avg | max | min | count" } ], "keepHeader": true, "sheetName": "", "options": {} }',
    "3. operation 只能是下面之一：",
    "   - group_sum：按某列/多列分组后聚合求和",
    "   - sum：简单求和",
    "   - count：计数（统计行数或按组统计数量）",
    "   - distinct：去重（删除完全重复的行，或按指定列去重）",
    "   - average：求平均值（可用 method 指定某列求平均）",
    "   - max：求最大值",
    "   - min：求最小值",
    "4. calculations 中每个要计算的列用 { column, method } 描述；method 只能是 sum / avg / max / min / count 之一。",
    "5. 涉及按某列分组（如“按商品名称汇总”）时，把该列放入 groupBy；distinct 时把去重依据列放入 groupBy（或 options.distinctBy）。",
    "6. 引用的列名必须来自下面提供的表头列表，不要臆造列名；表头为空时用自然描述并不额外创建列。",
    "7. keepHeader 一般为 true（保持原表头）。",
    "8. options 一般保持为空对象 {}；distinct 时可在 options 放 { distinctBy: \"去重依据列名\" }。",
    "",
    `表格可用表头：${headers.join(", ") || "未知（请用自然描述，不额外创建列）"}`,
    "",
    `用户需求：${userRequirement}`,
    "",
    "若用户需求无法映射到上述任一可执行操作，请输出：",
    '{ "status": "need_confirm", "questions": [ { "question": "您想如何整理这份表？", "options": [ { "label": "按某列分组汇总", "task": { "operation": "group_sum", "groupBy": [], "calculations": [], "keepHeader": true, "sheetName": "", "options": {} } } ] } ] }',
    "（需求模糊时用 need_confirm 结构，绝不硬编一个错误的任务。）",
    "",
    "请输出 JSON：",
  ].join("\n");
}

/**
 * 需求理解 Prompt 的「可直接执行」变体：
 * 当需求已经足够具体时强制模型只回 Task（ready），用于二次确认。
 */
export function buildReadyOnlyPrompt(userRequirement: string, headers: string[]): string {
  return [
    "你是一个 Excel 表格处理需求理解助手。",
    "把用户的一句话需求转换成结构化任务 JSON，只能输出合法 JSON。",
    `可用操作：${OPERATION_LIST.join(", ")}。`,
    "JSON 结构：",
    '{ "operation": "...", "groupBy": ["..."], "calculations": [ { "column": "...", "method": "sum|avg|max|min|count" } ], "keepHeader": true, "sheetName": "", "options": {} }',
    `表格可用表头：${headers.join(", ") || "未知（用自然描述，不额外创建列）"}`,
    "",
    `用户需求：${userRequirement}`,
    "",
    "请只输出一个合法的 Task JSON：",
  ].join("\n");
}

/**
 * 意图判断 Prompt：
 * 判定用户需求是否“足够具体可执行”，还是需要澄清。
 * 输出：
 *   { "judge": "ready" | "need_confirm", "hint": "..." }
 * ready=可直接执行；need_confirm=模糊需引导。
 */
export function buildIntentPrompt(userRequirement: string): string {
  return [
    "你是需求的“可执行性”判断助手。",
    "给定用户的一句话，判断它是否足以直接生成一个 Excel 处理任务。",
    "只输出一个合法 JSON：{ \"judge\": \"ready\" | \"need_confirm\", \"hint\": \"简短中文说明\" }",
    "",
    "判断规则：",
    "- 若用户明确说了要做哪个操作（如求和、汇总、计数、去重、平均、最大、最小）。",
    "  —— judge 为 ready。",
    "- 若用户只是笼统表达（如“整理一下”“处理一下这个表”“看看怎么处理”“帮我弄一下”）",
    "  —— judge 为 need_confirm。",
    "",
    `用户需求：${userRequirement}`,
    "",
    "请输出 JSON：",
  ].join("\n");
}

/**
 * 需求澄清 Prompt：
 * 当 judge=need_confirm 时，根据表格表头与需求，设计澄清问题与可选项。
 * 输出：
 *   { "questions": [ { "question": "...", "options": [ { "label": "...", "task": {...} } ] } ] }
 * task 尽量映射到支持的 operation（sum/group_sum/count/distinct/average/max/min）。
 */
export function buildClarifyPrompt(
  userRequirement: string,
  headers: string[]
): string {
  return [
    "你是 Excel 需求澄清助手。",
    "用户的需求表达较模糊，请设计 1-2 个澄清问题，并给出可点选的操作选项。",
    "",
    "只能输出合法 JSON：",
    '{ "questions": [ { "question": "问题文案", "options": [ { "label": "选项文案", "task": { "operation": "group_sum|sum|count|distinct|average|max|min", "groupBy": ["..."], "calculations": [ { "column": "...", "method": "sum|avg|max|min|count" } ], "keepHeader": true, "sheetName": "", "options": {} } } ] } ] }',
    "",
    "要求：",
    "- 每个 option 的 task 必须合法；若该选项不足以构成任务，可给空 task 占位（{}）。",
    "- 引用的列名尽量来自下列表头，不要臆造。",
    `表格可用表头：${headers.join(", ") || "未知（用自然描述）"}`,
    "",
    `用户需求：${userRequirement}`,
    "",
    "请输出 JSON：",
  ].join("\n");
}

/**
 * Excel 表类型分析兜底 Prompt（AI 兜底用）：
 * 当规则识别不出表类型时，让模型根据表头与样例推断表类型并推荐操作。
 * 只做“判断与推荐”，绝不让模型直接修改数据。
 * 输出：
 *   { "tableTypeName": "采购表|销售表|库存表|财务表|明细表|通用表", "suggestions": [ { "label": "...", "task": {...} } ] }
 */
export function buildTableAnalyzePrompt(
  headers: string[],
  sampleData: unknown[][]
): string {
  return [
    "你是一个 Excel 表结构分析助手。",
    "根据下面给出的表头与样例数据，判断这份表是什么类型的表，并推荐 2-4 个常用的处理操作。",
    "",
    "只能输出合法 JSON：",
    '{ "tableTypeName": "采购表|销售表|库存表|财务表|明细表|通用表", "suggestions": [ { "label": "操作文案", "task": { "operation": "...", "groupBy": [], "calculations": [], "keepHeader": true, "sheetName": "", "options": {} } } ] }',
    "",
    "要求：",
    "- tableTypeName 只能是枚举之一，若都不匹配选“通用表”。",
    "- 每个 suggestion 带一个合法的 task（operation ∈ group_sum/sum/count/distinct/average/max/min）。",
    "- 列名从表头中选。",
    "",
    `表头：${headers.join(", ") || "无"}`,
    `样例数据（前几行）：${JSON.stringify(sampleData.slice(0, 3))}`,
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
