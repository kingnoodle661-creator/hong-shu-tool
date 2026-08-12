/**
 * @file types.ts
 * @description 抽象文件存储层 —— 接口定义（V0.3）。
 *
 * 目的：将「上传文件 / 结果文件」的落盘逻辑抽象为可替换的存储驱动，
 *       业务代码只依赖本接口，不关心底层实现（本地磁盘 / Vercel Blob / OSS / COS）。
 * 替换存储驱动时只需新增一个实现并修改 index.ts 工厂，业务模块零改动。
 */

/** 一个已存储文件的引用，供读写与下载定位 */
export interface StorageRef {
  /** 存储驱动内的唯一键（如文件名 / Object Key / pathname） */
  key: string;
  /**
   * 各驱动可选的额外元信息：
   *   - local ：通常为空。
   *   - blob  ：url（公网地址）、pathname、downloadUrl。
   */
  meta?: Record<string, unknown>;
}

/**
 * 可替换的存储提供者。
 * 所有方法均需做路径穿越 / 非法键防护，只接受本服务生成的 key。
 */
export interface StorageProvider {
  readonly name: string;

  /** 写入 / 覆盖一个文件，返回可定位该文件的 StorageRef */
  save(name: string, data: Buffer | Uint8Array, contentType?: string): Promise<StorageRef>;

  /** 按 ref 读取文件二进制；不存在时抛错 */
  get(ref: StorageRef | string): Promise<Buffer>;

  /** 按 ref 删除文件；不存在时静默成功 */
  delete(ref: StorageRef | string): Promise<void>;

  /** 判断给定 ref 是否能被本驱动解析（用于合法性检查） */
  canResolve(key: string): boolean;
}

/** 创建非法的 StorageRef，抛出统一错误 */
export function invalidRef(): never {
  throw new Error("非法的文件标识。");
}
