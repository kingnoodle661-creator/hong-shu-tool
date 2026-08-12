/**
 * @file local.ts
 * @description 本地磁盘存储实现（默认驱动）。
 *
 * - 存储目录：默认工作区 .uploads，可用环境变量 UPLOAD_DIR 覆盖。
 * - 安全：只接受白名单扩展名；解析绝对路径后校验位于根目录内，防目录穿越。
 * - fileId（key）携带扩展名，保证与磁盘文件名一一对应。
 */
import { mkdir, readFile, unlink, writeFile } from "fs/promises";
import path from "path";
import { invalidRef, type StorageRef, type StorageProvider } from "./types";

/** 允许的文件扩展名：用户上传/结果均为 Excel；另允许 .json 存放生命周期清单 */
const ALLOWED_EXT = [".xlsx", ".xls", ".json"];

/** 存储根目录 */
function rootDir(): string {
  return process.env.UPLOAD_DIR || path.join(process.cwd(), ".uploads");
}

/**
 * 本地磁盘存储驱动。
 * 供 index.ts 工厂实例化；业务代码不直接引用本类。
 */
export class LocalStorageProvider implements StorageProvider {
  readonly name = "local";

  private async ensureRoot(): Promise<void> {
    await mkdir(rootDir(), { recursive: true });
  }

  canResolve(key: string): boolean {
    const ext = path.extname(key).toLowerCase();
    return ALLOWED_EXT.includes(ext) && !path.isAbsolute(key);
  }

  async save(
    name: string,
    data: Buffer | Uint8Array,
    _contentType?: string
  ): Promise<StorageRef> {
    await this.ensureRoot();
    const ext = path.extname(name);
    if (!ALLOWED_EXT.includes(ext.toLowerCase())) invalidRef();
    const key = path.basename(name); // 只取文件名，剥离任何路径成分
    await writeFile(this.#resolve(key), data);
    return { key };
  }

  async get(ref: StorageRef | string): Promise<Buffer> {
    const key = typeof ref === "string" ? ref : ref.key;
    return readFile(this.#resolve(key));
  }

  async delete(ref: StorageRef | string): Promise<void> {
    const key = typeof ref === "string" ? ref : ref.key;
    if (!this.canResolve(key)) invalidRef();
    // 文件不存在时静默成功
    await unlink(this.#resolve(key)).catch(() => undefined);
  }

  /** 解析 key -> 绝对路径，并校验位于根目录内 */
  #resolve(key: string): string {
    if (!this.canResolve(key)) invalidRef();
    const target = path.join(rootDir(), key);
    if (!target.startsWith(rootDir())) invalidRef();
    return target;
  }

  /**
   * 返回 key 对应的本地绝对路径（仅 local 驱动提供）。
   * 供 Node 处理器按路径读写；其它驱动（对象存储）场景下业务层不应使用路径。
   */
  localPath(key: string): string {
    return this.#resolve(key);
  }

  /** 本地磁盘根目录（供文件分层 / 清理使用） */
  get root(): string {
    return rootDir();
  }
}
