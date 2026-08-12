/**
 * @file deepseek.ts
 * @description DeepSeek API 调用封装（V0.2 + V0.5-A）。
 * - API Key 只从环境变量 DEEPSEEK_API_KEY 读取，绝不写在代码里。
 * - 提供「需求理解 / 意图判断 / 需求澄清 / 表分析兜底 / 结果审查」语义化方法。
 * - 返回统一结构；解析失败时抛错，由上层 Agent 路由转换为用户友好提示。
 * 核心原则：AI 只理解/分析/推荐、产出任务与澄清选项；执行仍由程序完成。
 */
import type {
  ClarifyResult,
  TableTypeName,
  Task,
  VerificationSuite,
} from "@/types/task";
import {
  buildClarifyPrompt,
  buildIntentPrompt,
  buildTableAnalyzePrompt,
  buildTaskParsePrompt,
  buildVerificationPrompt,
} from "./prompt";
import {
  parseAndNormalizeClarify,
  parseAndValidateTask,
  parseIntentJudge,
} from "./schema";

/** DeepSeek 基础配置，均可通过环境变量覆盖 */
const CONFIG = {
  baseUrl: process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com",
  model: process.env.DEEPSEEK_MODEL || "deepseek-chat",
  apiKey: process.env.DEEPSEEK_API_KEY || "",
};

/**
 * 底层调用 DeepSeek（Chat Completions）。
 * @param messages 发送给模型的对话
 * @returns 模型返回的纯文本
 */
export async function callDeepSeek(
  messages: { role: "system" | "user"; content: string }[]
): Promise<string> {
  // 安全校验：未配置 key 时提前抛出明确错误
  if (!CONFIG.apiKey) {
    throw new Error("未配置 DEEPSEEK_API_KEY，请在 .env.local 中设置。");
  }

  const res = await fetch(`${CONFIG.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${CONFIG.apiKey}`,
    },
    body: JSON.stringify({
      model: CONFIG.model,
      messages,
      temperature: 0, // 结构化任务，温度 0 降低随机性
      response_format: { type: "json_object" },
    }),
    // 明确超时，避免无服务器函数挂起
    signal: AbortSignal.timeout(60_000),
  });

  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`DeepSeek 请求失败(${res.status}): ${detail}`);
  }

  const body = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  const content = body.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error("DeepSeek 返回内容为空。");
  }
  return content;
}

/** 从模型文本中稳健提取 JSON；剥离可能的 markdown 代码块。 */
export function parseJson<T>(raw: string): T {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  const target = fenced ? fenced[1] : raw;
  return JSON.parse(target) as T;
}

/**
 * 需求理解 Agent 的核心调用（V0.5-A）：自然语言 -> 结构化 Task 或 澄清问题。
 *
 * 流程：
 *  1. 先用「意图判断」判定需求是否足够具体可执行。
 *  2. 可直接执行 -> 生成 Task 并返回 { status:"ready", task }。
 *  3. 需求模糊 -> 走「澄清 prompt」生成问题与选项，
 *     返回 { status:"need_confirm", questions:[...] }，不报错。
 *
 * 无论需求多模糊，都不会抛「无法理解」——这是 V0.5-A「易用性」的核心增强。
 * @param requirement 用户一句话需求
 * @param headers 第一个工作表的表头（约束模型引用真实列名）
 * @returns ClarifyResult
 * @throws 仅当网络/上游错误或未配置 key 时抛错（由路由转为 502/503）。
 */
export async function understandRequirement(
  requirement: string,
  headers: string[]
): Promise<ClarifyResult> {
  // 步骤一：意图判断（模糊 vs 具体）
  const intentRaw = await callDeepSeek([
    { role: "system", content: "你只输出合法 JSON。" },
    { role: "user", content: buildIntentPrompt(requirement) },
  ]);
  const judge = parseIntentJudge(parseJson<unknown>(intentRaw));

  // 需求足够具体 -> 直接生成可执行任务
  if (judge === "ready") {
    const raw = await callDeepSeek([
      { role: "system", content: "你只输出合法 JSON。" },
      { role: "user", content: buildTaskParsePrompt(requirement, headers) },
    ]);
    const parsed = parseJson<unknown>(raw);
    // 优先尝试解析为 Task；若模型给了 need_confirm 结构或校验失败，
    // 程序侧容错地转成澄清而非报错。
    try {
      const task = parseAndValidateTask(parsed);
      return { status: "ready", task };
    } catch {
      return parseAndNormalizeClarify(parsed, headers);
    }
  }

  // 需求模糊 -> 澄清（不报错）
  const clarifyRaw = await callDeepSeek([
    { role: "system", content: "你只输出合法 JSON。" },
    { role: "user", content: buildClarifyPrompt(requirement, headers) },
  ]);
  return parseAndNormalizeClarify(parseJson<unknown>(clarifyRaw), headers);
}

/**
 * 需求理解的可直接执行变体（供澄清选项确认后复用，可选）。
 * 强制模型返回可执行的 Task。
 */
export async function understandRequirementStrict(
  requirement: string,
  headers: string[]
): Promise<Task> {
  const raw = await callDeepSeek([
    { role: "system", content: "你只输出合法 JSON。" },
    { role: "user", content: buildTaskParsePrompt(requirement, headers) },
  ]);
  return parseAndValidateTask(parseJson<unknown>(raw));
}

/**
 * Excel 表类型分析（AI 兜底）。
 * 当规则无法识别表类型时调用；只做判断与推荐，绝不修改数据。
 * @throws 网络/上游/未配置 key 时抛错，由调用方降级为通用表。
 */
export async function analyzeTableWithAI(
  headers: string[],
  sampleData: unknown[][]
): Promise<{
  tableTypeName: TableTypeName;
  suggestions: { label: string; task: Task }[];
}> {
  const raw = await callDeepSeek([
    { role: "system", content: "你只输出合法 JSON。" },
    { role: "user", content: buildTableAnalyzePrompt(headers, sampleData) },
  ]);
  const parsed = parseJson<Record<string, unknown>>(raw);

  const typeName = (
    ["采购表", "销售表", "库存表", "财务表", "明细表", "通用表"] as const
  ).find((t) => parsed.tableTypeName === t) as TableTypeName | undefined;

  const suggestionsRaw = Array.isArray(parsed.suggestions) ? parsed.suggestions : [];
  const suggestions: { label: string; task: Task }[] = [];
  for (const s of suggestionsRaw) {
    if (!s || typeof s !== "object" || Array.isArray(s)) continue;
    const ss = s as Record<string, unknown>;
    const label = typeof ss.label === "string" ? ss.label.trim() : "";
    if (!label) continue;
    try {
      const task = parseAndValidateTask(ss.task as unknown);
      suggestions.push({ label, task });
    } catch {
      // 单个推荐解析失败则跳过，不影响其它
    }
  }

  return {
    tableTypeName: typeName ?? "通用表",
    suggestions:
      suggestions.length > 0
        ? suggestions
        : defaultSuggestionsForAnything(headers),
  };
}

/** 通用兜底推荐（AI 失败或未给出有效推荐时用） */
function defaultSuggestionsForAnything(headers: string[]): {
  label: string;
  task: Task;
}[] {
  const groupCandidate = headers[0] || "第一列";
  const valueCandidate =
    headers.find((h) => /数量|金额|价格|单价|合计/.test(h)) ||
    headers[1] ||
    headers[0] ||
    "第二列";
  return [
    {
      label: `按“${groupCandidate}”分组汇总`,
      task: {
        operation: "group_sum",
        groupBy: [groupCandidate],
        calculations: [{ column: valueCandidate, method: "sum" }],
        keepHeader: true,
        sheetName: "",
        options: {},
      },
    },
    {
      label: "删除完全重复的行",
      task: {
        operation: "distinct",
        groupBy: ["全部列"],
        calculations: [],
        keepHeader: true,
        sheetName: "",
        options: {},
      },
    },
    {
      label: `对“${valueCandidate}”求和`,
      task: {
        operation: "sum",
        groupBy: [],
        calculations: [{ column: valueCandidate, method: "sum" }],
        keepHeader: true,
        sheetName: "",
        options: {},
      },
    },
  ];
}

/**
 * 结果审查 Agent 的辅助调用：让模型产出参考 checks。
 * 注意：此结果仅作参考，最终判定由 verifier.ts 程序规则完成。
 * 当模型失败/未配置 key 时抛出异常，由调用方降级为纯程序审查。
 */
export async function aiReview(
  requirement: string,
  originalSummary: Record<string, unknown>,
  resultSummary: Record<string, unknown>
): Promise<VerificationSuite> {
  const raw = await callDeepSeek([
    { role: "system", content: "你只输出合法 JSON。" },
    { role: "user", content: buildVerificationPrompt(requirement, originalSummary, resultSummary) },
  ]);

  const suite = parseJson<Partial<VerificationSuite>>(raw);
  return {
    success: !!suite.success,
    checks: Array.isArray(suite.checks) ? suite.checks : [],
  };
}
