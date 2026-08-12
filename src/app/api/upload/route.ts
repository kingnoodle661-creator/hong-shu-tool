/**
 * @file route.ts (/api/upload)
 * @description 文件上传接口。
 *  - GET:  返回服务端允许的格式与大小上限。
 *  - POST: 接收 Excel 文件，落盘到临时目录（services/uploads.ts），
 *          返回 ExcelFile（含 fileId），供后续 AI / Excel / Verify 流程使用。
 */
import { saveUpload } from "@/services/uploads";
import { toUserError, USER_STORAGE_ERROR } from "@/services/storage/errors";

/** GET：返回上传配置元信息，供前端提示 */
export function GET() {
  return Response.json({
    ok: true,
    allowedExt: [".xlsx", ".xls"],
    maxSizeBytes: parseInt(process.env.MAX_UPLOAD_SIZE_BYTES || "10485760", 10),
  });
}

/** POST：处理 multipart/form-data 中的 file 字段 */
export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const upload = formData.get("file");

    // 安全校验：必须存在文件
    if (!(upload instanceof File)) {
      return Response.json({ ok: false, error: "缺少文件字段。" }, { status: 400 });
    }

    // 服务端二次校验 MIME 类型（前端校验不可信任）
    const allowedMimes = [
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", // .xlsx
      "application/vnd.ms-excel", // .xls
    ];
    if (!allowedMimes.includes(upload.type)) {
      return Response.json(
        { ok: false, error: "仅支持 .xlsx / .xls 格式的文件。" },
        { status: 415 }
      );
    }

    // 读取字节并交给存储服务落盘
    const buffer = Buffer.from(await upload.arrayBuffer());
    const file = await saveUpload(buffer, upload.name, upload.type);

    return Response.json({ ok: true, file });
  } catch (e) {
    const message = e instanceof Error ? e.message : "";
    // 用户可自助解决的校验类错误：保留具体提示（格式/大小/缺文件）
    if (/缺少文件|格式|大小/.test(message)) {
      const status = /格式/.test(message) ? 415 : 400;
      return Response.json({ ok: false, error: message }, { status });
    }
    // 存储配置 / 内部错误：不向用户暴露 token、环境变量名或内部细节，
    // 统一返回友好提示；详细原因记录到服务端日志（Vercel 日志排查）。
    return Response.json({ ok: false, error: toUserError(e, USER_STORAGE_ERROR) }, { status: 500 });
  }
}
