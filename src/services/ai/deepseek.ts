/**
 * @file deepseek.ts
 * @description DeepSeek API 调用封装（V0.2）。
 * - API Key 只从环境变量 DEEPSEEK_API_KEY 读取，绝不写在代码里。
 * - 提供「需求理解」与「结果审查」两个语义化方法，内部复用通用调用。
 * - 返回统一结构；解析失败时抛错，由上层 Agent 路由转换为用户友好提示。
 */
import type { Task, VerificationSuite } from "@/types/task";
import {
  buildTaskParsePrompt,
  buildVerificationPrompt,
} from "./prompt";
import { parseAndValidateTask } from "./schema";

/** DeepSeek 基础配置，均可通过环境变量覆盖 */
const CONFIG = {
  baseUrl: process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com",
  model: process.env.DEEPSEEK_MODEL || "deepseek-chat",
  apiKey: process.env.DEEPSEEK_API_KEY || "",
};

/**
 * 底层调用 DeepSeek（Chat Completions）。
 * @param messages 发送给模型的对话
 */
async function callDeepSeek(
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
function parseJson<T>(raw: string): T {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  const target = fenced ? fenced[1] : raw;
  return JSON.parse(target) as T;
}

/**
 * 需求理解 Agent 的核心调用：自然语言 -> 结构化 Task（V0.2 协议）。
 * @param requirement 用户一句话需求
 * @param headers 第一个工作表的表头（约束模型引用真实列名）
 * @returns 结构化的 Task
 * @throws 解析失败或产出的 operation 无法识别时抛错
 */
export async function understandRequirement(
  requirement: string,
  headers: string[]
): Promise<Task> {
  const raw = await callDeepSeek([
    { role: "system", content: "你只输出合法 JSON。" },
    { role: "user", content: buildTaskParsePrompt(requirement, headers) },
  ]);

  const parsed = parseJson<unknown>(raw);

  // 程序侧严格校验：任何字段缺失/类型错/非法枚举都会被拒绝，不信任模型原始输出
  const task = parseAndValidateTask(parsed);

  return task;
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
