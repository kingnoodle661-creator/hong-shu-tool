/**
 * @file route.ts (/api/cleanup)
 * @description 文件生命周期清理接口（V0.4）。
 *
 * 触发 cleanupOldFiles()：删除超过 24 小时的文件并回写清单。
 * 适合作为手动触发，或配合 Vercel Cron（在 README 文档中说明）。
 * 无数据库，清理基于存储层内的清单。
 */
import { cleanupOldFiles } from "@/services/storage/lifecycle";
import { toUserError, USER_STORAGE_ERROR } from "@/services/storage/errors";

export const runtime = "nodejs";

export async function GET() {
  try {
    const result = await cleanupOldFiles();
    return Response.json({
      ok: true,
      ...result,
      message: `本次清理删除 ${result.removed} 个过期文件，清单剩余 ${result.manifestSize} 项。`,
    });
  } catch (e) {
    // 不向用户暴露 token / 环境变量名 / 内部错误细节，统一友好提示
    return Response.json({ ok: false, error: toUserError(e, USER_STORAGE_ERROR) }, { status: 500 });
  }
}
