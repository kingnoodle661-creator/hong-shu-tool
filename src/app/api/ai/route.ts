/**
 * @file route.ts (/api/ai)
 * @description 需求理解 Agent（AI）接口。
 * 流程：接收用户自然语言需求 -> 若提供 fileId 则先读取表头约束模型 ->
 *       调用 deepseek.understandRequirement -> 返回结构化 Task。
 * 注意：本接口只做「需求理解」，不触碰 Excel 内容。
 * AI 解析失败时返回用户友好的"无法理解您的需求"提示，而不是原始报错。
 */
import { understandRequirement } from "@/services/ai/deepseek";
import { excelEngine } from "@/services/excel/processor";
import type { ExcelFile } from "@/types/task";

interface AiRequestBody {
  /** 用户的一句话需求 */
  requirement: string;
  /** 可选：已上传文件的 fileId，用于读取真实表头约束模型 */
  fileId?: string | null;
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as AiRequestBody;

    if (!body?.requirement || !body.requirement.trim()) {
      return Response.json({ ok: false, error: "需求不能为空。" }, { status: 400 });
    }

    // 尝试读取表头以约束模型引用真实列名；失败时不阻断（降级为空表头）
    let headers: string[] = [];
    if (body.fileId) {
      try {
        // readHeaders 内部仅使用 fileId 定位文件，其余字段不影响读取
        headers = await excelEngine.readHeaders({
          fileId: body.fileId,
        } as ExcelFile);
      } catch {
        headers = [];
      }
    }

    const task = await understandRequirement(body.requirement.trim(), headers);

    return Response.json({ ok: true, task, headers });
  } catch (e) {
    const raw = e instanceof Error ? e.message : "";
    // 无法理解的用户需求 -> 友好提示（400）
    if (raw.includes("无法理解")) {
      return Response.json(
        { ok: false, error: "无法理解您的需求，请换一种描述方式。" },
        { status: 400 }
      );
    }
    // 未配置 DEEPSEEK_API_KEY -> 明确提示配置缺失（503，不泄露任何密钥细节）
    if (raw.includes("DEEPSEEK_API_KEY")) {
      return Response.json(
        { ok: false, error: "AI服务未配置" },
        { status: 503 }
      );
    }
    // 其他调用失败（网络/超时/上游错误）-> 服务暂不可用（502）
    return Response.json(
      { ok: false, error: "AI 服务暂不可用，请稍后重试。" },
      { status: 502 }
    );
  }
}
