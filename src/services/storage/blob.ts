/**
 * @file blob.ts
 * @description Vercel Blob 存储实现（生产驱动）。
 *
 * 通过 @vercel/blob 把文件存到 Vercel 的托管对象存储，适合 Serverless 环境。
 * - save  : put(access:'public') 返回 { url, pathname }，存入 StorageRef.meta。
 * - get   : 取 Blob 元数据（head）后用 fetch 拉取二进制，返回 Buffer。
 * - delete: del（按 url / pathname）。
 * - 安全：key 使用随机 fileId（不暴露真实文件名路径）；对象默认 public，
 *          依赖「随机 ID 难以猜中 + 生命周期清理」来保护隐私。
 * - token：必须配置 BLOB_READ_WRITE_TOKEN，缺失时给出明确错误。
 *
 * 可注入 client（默认 @vercel/blob 真实实现），便于单测用 mock 驱动。
 */
import type { StorageProvider, StorageRef } from "./types";

/** @vercel/blob 的 put 返回结构 */
interface BlobPutResult {
  url: string;
  pathname: string;
  downloadUrl?: string;
}

/** 本驱动对 @vercel/blob 的最小依赖面，便于测试注入替身 */
export interface BlobClient {
  put(
    pathname: string,
    body: Buffer,
    options?: { access?: "public" | "private"; contentType?: string; addRandomSuffix?: boolean }
  ): Promise<BlobPutResult>;
  head(url: string): Promise<{ url: string; size?: number; contentType?: string }>;
  del(url: string): Promise<void>;
}

/** 默认使用真实的 @vercel/blob */
import { put, head, del } from "@vercel/blob";

function defaultClient(): BlobClient {
  return {
    put: (p, b, o) =>
      put(p, b, (o ?? {}) as Parameters<typeof put>[2]) as Promise<BlobPutResult>,
    head: (u) => head(u),
    del: (u) => del(u),
  };
}

/** Blob 存根（未配置 token 时抛出的明确错误） */
function tokenizeError(driver: string): never {
  throw new Error(
    `未配置 BLOB_READ_WRITE_TOKEN。要将存储驱动设为 "${driver}"，请在 .env.local 或 Vercel 环境变量中设置 BLOB_READ_WRITE_TOKEN。`
  );
}

/** 允许文件扩展名：用户上传/结果均为 Excel；另允许 .json 存放生命周期清单 */
const ALLOWED_EXT = [".xlsx", ".xls", ".json"];

/**
 * Vercel Blob 存储驱动。
 * 业务代码不直接引用本类；经 storage/index.ts 工厂选择后统一使用。
 * 允许注入 fetchFn，便于单测用 mock（无需真实网络）。
 */
export class BlobStorageProvider implements StorageProvider {
  readonly name = "blob";

  private client: BlobClient;
  private fetchFn: (input: string) => Promise<Response>;

  constructor(client?: BlobClient, fetchFn?: (input: string) => Promise<Response>) {
    this.client = client ?? defaultClient();
    this.fetchFn = fetchFn ?? ((input: string) => fetch(input));
  }

  private token(): string {
    const t = process.env.BLOB_READ_WRITE_TOKEN;
    if (!t) tokenizeError(this.name);
    return t as string;
  }

  canResolve(key: string): boolean {
    return typeof key === "string" && key.length > 0;
  }

  async save(
    name: string,
    data: Buffer | Uint8Array,
    contentType?: string
  ): Promise<StorageRef> {
    this.token(); // fail-fast：未配置 token 提前报错
    const ext = name.slice(name.lastIndexOf(".")).toLowerCase();
    if (!ALLOWED_EXT.includes(ext)) {
      throw new Error("仅支持 .xlsx / .xls 格式的文件。");
    }
    // 规整为 Node Buffer 再交给 @vercel/blob，规避 Node24 的 Buffer 泛型差异
    const body = Buffer.isBuffer(data) ? data : Buffer.from(data);
    const result = await this.client.put(
      name,
      body as unknown as Buffer,
      {
        access: "public",
        contentType:
          contentType ||
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        addRandomSuffix: false, // fileId 已含随机成分，无需再加后缀
      }
    );
    return {
      key: name,
      meta: {
        url: result.url,
        pathname: result.pathname,
        downloadUrl: result.downloadUrl,
      },
    };
  }

  async get(ref: StorageRef | string): Promise<Buffer> {
    const key = typeof ref === "string" ? ref : ref.key;
    const fromMeta = typeof ref !== "string" ? (ref.meta?.url as string | undefined) : undefined;
    const metaUrl = fromMeta != null && fromMeta !== "" ? fromMeta : await this.#resolveUrl(key);
    const res = await this.fetchFn(metaUrl);
    if (!res.ok) {
      throw new Error(`Blob 读取失败(${res.status})：文件可能已过期或被清理。`);
    }
    const buf = await res.arrayBuffer();
    return Buffer.from(buf);
  }

  async delete(ref: StorageRef | string): Promise<void> {
    let url: string | null = null;
    if (typeof ref === "string") {
      url = await this.#resolveUrl(ref);
    } else {
      const metaUrl = ref.meta?.url as string | undefined;
      url = metaUrl && metaUrl !== "" ? metaUrl : await this.#resolveUrl(ref.key);
    }
    if (url == null) return;
    await this.client.del(url);
  }

  /** 由 head 根据 key 解析对象 url（key 即 pathname 或完整 url 都兼容） */
  async #resolveUrl(keyOrUrl: string): Promise<string> {
    if (keyOrUrl.startsWith("http")) return keyOrUrl;
    const key = keyOrUrl.replace(/^\//, "");
    const meta = await this.client.head(key);
    return meta.url;
  }
}
