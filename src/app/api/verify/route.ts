/**
 * @file route.ts (/api/verify)
 * @description 结果审查 Agent 接口。
 * 分别运行：
 *   1) 程序硬性规则校验 verifyProcessResult（最终判定）
 *   2) 模型辅助审查 aiReview（可选，失败时降级）
 * 对外返回以程序校验为准的 VerificationSuite。
 */
import { aiReview } from "@/services/ai/deepseek";
import { verifyProcessResult } from "@/services/verify/verifier";
import { writeOperationLog } from "@/services/log/logger";
import { toUserError } from "@/services/storage/errors";
import type { ProcessSummary, Task, VerificationSuite } from "@/types/task";

interface VerifyRequestBody {
  requirement: string;
  preview: ProcessSummary;
  result: ProcessSummary;
  task: Task;
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as VerifyRequestBody;

    if (!body?.result?.headers || !body?.task) {
      return Response.json({ ok: false, error: "摘要数据不完整。" }, { status: 400 });
    }

    // 1) 程序硬性校验（最终依据）
    const programmatic: VerificationSuite = verifyProcessResult(
      body.preview,
      body.result,
      body.task
    );

    // 2) 模型辅助审查（仅作补充，不影响最终判定）
    let aiHint: VerificationSuite | null = null;
    try {
      aiHint = await aiReview(
        body.requirement,
        body.preview as unknown as Record<string, unknown>,
        body.result as unknown as Record<string, unknown>
      );
    } catch {
      // API key 缺失或网络失败时，仅返回程序校验结果
      aiHint = null;
    }

    // 3) 写入完整操作日志（含需求/摘要/审查报告）——不落数据库，本地 JSON
    await writeOperationLog({
      requirement: body.requirement,
      task: body.task,
      preview: body.preview,
      result: body.result,
      verification: programmatic,
      success: true,
    });

    return Response.json({ ok: true, verification: programmatic, aiHint });
  } catch (e) {
    // 不向用户暴露内部技术细节（token/环境变量/堆栈），统一友好提示
    return Response.json({ ok: false, error: toUserError(e, "审查失败，请稍后重试。") }, { status: 500 });
  }
}
