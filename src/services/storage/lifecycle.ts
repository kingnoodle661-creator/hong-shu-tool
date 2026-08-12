/**
 * @file lifecycle.ts
 * @description 文件生命周期管理（V0.4）。
 *
 * 办公文件涉及隐私，需要自动清理。本模块提供一个「不依赖数据库」的清单方案：
 *   - 用一个 Manifest 文件（存储在存储层内，key 固定为 __manifest.json）记录
 *     每个文件的 { fileId, kind, createdAt }。
 *   - 上传 / 生成结果文件时调用 recordFile 记账。
 *   - cleanupOldFiles 清理超过 maxAge 的文件并回写清单。
 *
 * Manifest 存于存储层（local 磁盘或 Blob），因此对两种驱动统一可用。
 */
import { storage } from "./index";

/** 清单文件名（存于存储层根键） */
const MANIFEST_KEY = "__manifest.json";

/** 记录的文件类型 */
export type FileKind = "upload" | "result";

/** 清单中的单条记录 */
export interface ManifestEntry {
  /** 存储层键（fileId） */
  fileId: string;
  /** 类型：上传文件 / 处理结果 */
  kind: FileKind;
  /** 创建时间（ISO） */
  createdAt: string;
}

/** 读清单；无清单返回空数组；读取失败容错返回空并标记 */
async function readManifest(): Promise<ManifestEntry[]> {
  try {
    const buf = await storage.get(MANIFEST_KEY);
    const raw = JSON.parse(buf.toString("utf8"));
    return Array.isArray(raw) ? (raw as ManifestEntry[]) : [];
  } catch {
    return [];
  }
}

async function writeManifest(entries: ManifestEntry[]): Promise<void> {
  await storage.save(MANIFEST_KEY, Buffer.from(JSON.stringify(entries), "utf8"), "application/json");
}

/**
 * 记录一个文件已创建（写入清单）。
 * @param fileId 存储层键（不含扩展名的纯 id 或全键均可，建议传全键）
 * @param kind   类型
 */
export async function recordFile(fileId: string, kind: FileKind): Promise<void> {
  const entries = await readManifest();
  // 若已存在同键，则更新时间
  const idx = entries.findIndex((e) => e.fileId === fileId);
  const entry: ManifestEntry = { fileId, kind, createdAt: new Date().toISOString() };
  if (idx >= 0) entries[idx] = entry;
  else entries.push(entry);
  await writeManifest(entries);
}

/**
 * 清理超过 maxAge 的文件：删除存储对象并从清单移除。
 * @param maxAgeMs 超期时长（默认 24 小时）
 * @returns { removed, manifestSize } 删除数量与剩余清单规模
 */
export async function cleanupOldFiles(maxAgeMs = 24 * 60 * 60 * 1000): Promise<{
  removed: number;
  manifestSize: number;
}> {
  const entries = await readManifest();
  const cutoff = Date.now() - maxAgeMs;
  const expired = entries.filter((e) => new Date(e.createdAt).getTime() < cutoff);
  const kept = entries.filter((e) => new Date(e.createdAt).getTime() >= cutoff);

  for (const e of expired) {
    try {
      await storage.delete(e.fileId);
    } catch {
      // 单个删除失败不阻断整体清理
    }
  }

  // 防止清单无限膨胀：即便无超期项也回写（去重）
  await writeManifest(kept);
  return { removed: expired.length, manifestSize: kept.length };
}

/** 获取当前清单快照（供审计 / 展示） */
export async function listTrackedFiles(): Promise<ManifestEntry[]> {
  return readManifest();
}

/** 导出 MANIFEST_KEY 供需要时引用 */
export { MANIFEST_KEY };
