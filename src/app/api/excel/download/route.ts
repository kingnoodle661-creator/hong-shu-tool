/**
 * @file route.ts (/api/excel/download)
 * @description 处理结果下载接口（V0.4：改为通过抽象存储层读取）。
 *
 * 通过 fileId 定位存储层中的结果文件（local 磁盘或 Vercel Blob），
 * 读取二进制后作为附件流式返回给客户端。业务层不再直接读取本地文件系统路径。
 */
import { storage } from "@/services/storage";
import { toUserError } from "@/services/storage/errors";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const fileId = url.searchParams.get("fileId");

  if (!fileId) {
    return Response.json({ ok: false, error: "缺少 fileId。" }, { status: 400 });
  }

  try {
    // 通过 StorageProvider 读取（对 local 与 blob 驱动统一）
    const buf = await storage.get(fileId);
    const filename = `处理结果_${fileId.replace(/\.[^.]+$/, "")}.xlsx`;

    return new Response(new Blob([new Uint8Array(buf) as unknown as BlobPart]), {
      status: 200,
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(
          filename
        )}`,
      },
    });
  } catch (e) {
    // 不向用户暴露存储层技术细节（token/环境变量/内部信息），统一友好提示
    const userError = toUserError(e, "文件不存在或已过期，请重新处理后再下载。");
    return Response.json({ ok: false, error: userError }, { status: 404 });
  }
}
