/**
 * @file index.ts
 * @description 存储层工厂：按环境变量 STORAGE_DRIVER 选择驱动，导出统一实例。
 *
 * 驱动选择（V0.4）：
 *   - 显式 STORAGE_DRIVER=local|blob 优先；
 *   - 未显式配置时：Vercel 生产（process.env.VERCEL）默认 blob，本地默认 local。
 *
 * 当前支持：
 *   - "local"：本地磁盘（LocalStorageProvider，本地开发默认）。
 *   - "blob" ：Vercel Blob（BlobStorageProvider，生产默认，需 BLOB_READ_WRITE_TOKEN）。
 *
 * 业务代码统一从这里 import storage，不直接依赖具体驱动。
 */
import { LocalStorageProvider } from "./local";
import { BlobStorageProvider } from "./blob";
import type { StorageProvider } from "./types";

/** 记录一次 Blob 启动环境检查告警，避免多次刷新重复刷屏 */
let blobEnvWarned = false;

/**
 * 生产环境启动检查：当使用 blob 驱动但未配置 BLOB_READ_WRITE_TOKEN 时，
 * 输出明确的 [Storage Error] 日志，方便在 Vercel 日志中排查配置遗漏。
 * 仅打印日志，不抛错（避免因缺 token 导致所有路由在 import 时直接崩溃）。
 */
function checkBlobEnv(): void {
  if (blobEnvWarned) return;
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    blobEnvWarned = true;
    console.error(
      [
        `[Storage Error]`,
        `Blob模式已开启`,
        `但缺少BLOB_READ_WRITE_TOKEN`,
        `请在 Vercel 环境变量（Settings -> Environment Variables）中配置 BLOB_READ_WRITE_TOKEN，或使用 STORAGE_DRIVER=local。`,
      ].join("\n")
    );
  }
}


/** 读取当前生效的驱动名 */
function resolveDriver(driverArg?: string): string {
  const driver =
    driverArg ||
    process.env.STORAGE_DRIVER ||
    (process.env.VERCEL ? "blob" : "local");
  return driver || "local";
}

/**
 * 创建存储提供者。
 * @param driver 覆盖驱动名；缺省按 resolveDriver 推断
 * @throws 未知的 STORAGE_DRIVER 时抛错，防止静默回退到错误实现
 */
export function createStorageProvider(driverArg?: string): StorageProvider {
  const driver = resolveDriver(driverArg);
  switch (driver) {
    case "local":
      return new LocalStorageProvider();
    case "blob":
      checkBlobEnv(); // 启动环境检查：缺 token 时输出 [Storage Error] 日志
      return new BlobStorageProvider();
    default:
      throw new Error(`未知的存储驱动：${driver}。可用值：local、blob。`);
  }
}

/**
 * 全局单例，供各路由 / 服务复用。
 * 使用 let + 便于测试替换（setStorageProviderForTest）与恢复默认。
 */
export let storage: StorageProvider = createStorageProvider();

/**
 * 测试用：覆盖全局存储驱动（mock Blob 客户端等）。
 * @param provider 传实例替换；缺省/传 undefined 时恢复为按环境变量重建的默认驱动。
 */
export function setStorageProviderForTest(provider?: StorageProvider): void {
  storage = provider ?? createStorageProvider();
}

/** 便捷：从任一 StorageProvider 拿到底层驱动名 */
export type { StorageProvider, StorageRef } from "./types";
