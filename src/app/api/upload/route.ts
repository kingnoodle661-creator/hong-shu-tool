/**
 * @file route.ts (/api/upload)
 * @description 文件上传接口。
 *  - GET:  返回服务端允许的格式与大小上限。
 *  - POST: 接收 Excel 文件，落盘到临时目录（services/uploads.ts），
 *          返回 ExcelFile（含 fileId），供后续 AI / Excel / Verify 流程使用。
 */
import { saveUpload } from "@/services/uploads";

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
    const message = e instanceof Error ? e.message : "上传失败。";
    // 校验类错误给 4xx，其余给 500
    const status = message.includes("格式") || message.includes("大小") ? 400 : 500;
    return Response.json({ ok: false, error: message }, { status });
  }
}
