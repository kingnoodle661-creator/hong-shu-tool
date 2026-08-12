/**
 * @file route.ts (/api/ai)
 * @description 需求理解 Agent（AI）接口（V0.5-A 增强）。
 * 流程：接收用户自然语言需求 -> 若提供 fileId 则先读取表头约束模型 ->
 *       调用 deepseek.understandRequirement -> 返回 ClarifyResult。
 * 返回：需求足够具体 -> { ok:true, status:"ready", task }；
 *     需求模糊（如"整理一下"）-> { ok:true, status:"need_confirm", questions }，不报错。
 * 注意：本接口只做「需求理解」，不触碰 Excel 内容。
 * 网络/上游错误时返回 502，未配置 Key 时返回 503（都不泄露敏感信息）。
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

    // V0.5-A：需求理解返回 ClarifyResult。
    // 需求足够具体 -> { status:"ready", task }；需求模糊 -> { status:"need_confirm", questions }，绝不报错。
    const result = await understandRequirement(body.requirement.trim(), headers);

    return Response.json({ ok: true, ...result, headers });
  } catch (e) {
    const raw = e instanceof Error ? e.message : "";
    // 未配置 DEEPSEEK_API_KEY -> 明确提示配置缺失（503，不泄露任何密钥细节）
    if (raw.includes("DEEPSEEK_API_KEY")) {
      return Response.json(
        { ok: false, error: "AI服务未配置" },
        { status: 503 }
      );
    }
    // 网络/超时/上游错误 -> 服务暂不可用（502）
    return Response.json(
      { ok: false, error: "AI 服务暂不可用，请稍后重试。" },
      { status: 502 }
    );
  }
}
