/**
 * @file errors.ts
 * @description 存储层错误定义与「用户安全」的错误转译（V0.4-A 生产稳定性）。
 *
 * 目标：
 * - 普通用户只会看到友好的提示，绝不暴露环境变量名、token、内部错误细节。
 * - 详细的内部原因用于服务端日志（Vercel 日志排查），不返回给客户端。
 */

/** 用户可见的通用文件存储错误提示（不含任何技术信息） */
export const USER_STORAGE_ERROR =
  "文件存储服务暂时不可用，请稍后重试。";

/**
 * 存储配置类错误（例如：Blob 模式已开启但缺少 BLOB_READ_WRITE_TOKEN）。
 * 内部 message 仅用于日志；userMessage 才是可安全返回给用户的内容。
 */
export class StorageConfigError extends Error {
  /** 可安全展示给用户的提示 */
  readonly userMessage: string;

  constructor(userMessage: string, detail: string) {
    super(detail);
    this.name = "StorageConfigError";
    this.userMessage = userMessage;
  }
}

/**
 * 把任意异常安全地转成可直接返回给用户的字符串。
 * - StorageConfigError -> 使用其 userMessage（友好、不含内部信息）。
 * - 其它内部异常       -> 返回通用兜底文案，内部细节仅打印到日志。
 *
 * @param e 捕获到的异常
 * @param fallback 非存储配置类错误时的兜底提示
 */
export function toUserError(e: unknown, fallback = "服务器内部错误，请稍后重试。"): string {
  if (e instanceof StorageConfigError) {
    // 记录内部细节到日志，便于排查；对用户仅展示友好文案
    console.error("[StorageError] 存储配置异常（内部详情，仅日志）:", e.message);
    return e.userMessage;
  }
  if (e instanceof Error) {
    // 非配置类内部错误：记录详情，不暴露给用户
    console.error("[InternalError] 需要排查的内部错误（仅日志）:", e.message);
  }
  return fallback;
}
