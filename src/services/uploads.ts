/**
 * @file uploads.ts
 * @description 上传文件的存储服务门面（V0.4：全面基于抽象存储层 storage）。
 *
 * 本文件面向业务层，隐藏底层驱动（local 磁盘 / Vercel Blob）。
 * 关键点：
 *   - 所有文件操作只经过 StorageProvider（save/get/delete），业务层禁止直接碰本地文件系统。
 *   - saveUpload / saveResultBuffer 保存后登记到生命周期清单（recordFile），供自动清理。
 *   - fileId 携带扩展名，与存储层 key 一一对应，也让 Blob pathname 具备随机性。
 */
import { randomUUID } from "crypto";
import { storage } from "@/services/storage";
import { recordFile } from "@/services/storage/lifecycle";
import type { ExcelFile } from "@/types/task";

/** 文件大小上限：默认 10MB，可通过环境变量覆盖 */
const MAX_SIZE = parseInt(process.env.MAX_UPLOAD_SIZE_BYTES || "10485760", 10);

/** 允许的扩展名（白名单，防止上传非 Excel 文件） */
const ALLOWED_EXT = [".xlsx", ".xls"];

/** Excel MIME（.xlsx） */
const XLSX_MIME =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
/** .xls MIME */
const XLS_MIME = "application/vnd.ms-excel";

/** 安全地获得一个随机文件标识（fileId），携带扩展名以一一对应存储 key */
function newFileId(ext = ".xlsx"): string {
  return `${randomUUID()}${ext}`;
}

/** 生成结果文件 id（.xlsx） */
export function newResultFileId(): string {
  return newFileId(".xlsx");
}

/**
 * 保存上传的文件到存储层，返回描述该文件的 ExcelFile。
 * @param buffer 文件二进制内容
 * @param originalName 原始文件名（仅用于展示，不参与存储路径）
 * @param mimeType MIME 类型
 */
export async function saveUpload(
  buffer: Buffer,
  originalName: string,
  mimeType: string
): Promise<ExcelFile> {
  const ext = originalName
    ? (originalName.slice(originalName.lastIndexOf(".")).toLowerCase() || ".xlsx")
    : ".xlsx";
  if (!ALLOWED_EXT.includes(ext)) {
    throw new Error("仅支持 .xlsx / .xls 格式的文件。");
  }
  if (buffer.length > MAX_SIZE) {
    throw new Error(`文件超过大小限制（${Math.round(MAX_SIZE / 1024 / 1024)}MB）。`);
  }

  const fileId = newFileId(ext);
  await storage.save(fileId, buffer, mimeType || (ext === ".xls" ? XLS_MIME : XLSX_MIME));
  // 登记到生命周期清单，供自动清理
  await recordFile(fileId, "upload").catch(() => undefined);

  return {
    fileId,
    fileName: originalName,
    size: buffer.length,
    mimeType: mimeType || XLSX_MIME,
  };
}

/**
 * 保存 Excel 引擎生成的处理结果文件，返回其 fileId。
 * 与 saveUpload 使用同一存储层与命名规则，便于统一按 fileId 下载。
 * @param buffer 结果文件二进制
 * @returns 结果文件的 fileId（含随机 uuid + .xlsx 扩展名）
 */
export async function saveResultBuffer(buffer: Buffer | Uint8Array): Promise<string> {
  const fileId = newResultFileId();
  await storage.save(fileId, buffer, XLSX_MIME);
  await recordFile(fileId, "result").catch(() => undefined);
  return fileId;
}
