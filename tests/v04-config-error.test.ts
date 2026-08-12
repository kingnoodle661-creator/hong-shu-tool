/**
 * @file v04-config-error.test.ts
 * @description V0.4-A 生产配置修复测试：
 *  - 用户端不暴露 token / 环境变量名 / 内部错误；
 *  - blink 缺 token 时，用户收到友好提示，内部详情进日志（可在 message 中定位）。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  StorageConfigError,
  toUserError,
  USER_STORAGE_ERROR,
} from "@/services/storage/errors";
import { BlobStorageProvider, type BlobClient } from "@/services/storage/blob";

test("错误转译：StorageConfigError 返回友好提示，不含 token/环境变量名", () => {
  const err = new StorageConfigError(
    USER_STORAGE_ERROR,
    "Blob 驱动（blob）已启用，但缺少 BLOB_READ_WRITE_TOKEN。"
  );
  const userMsg = toUserError(err);
  assert.equal(userMsg, USER_STORAGE_ERROR);
  // 友好提示绝不应包含环境变量名 / token / 内部细节
  assert.ok(!userMsg.includes("BLOB_READ_WRITE_TOKEN"));
  assert.ok(!userMsg.includes("token"));
  assert.ok(!userMsg.includes("blob"), "不应向用户暴露驱动名");
  // 内部详情保留在 message 中，供日志排查
  assert.ok(err.message.includes("BLOB_READ_WRITE_TOKEN"));
});

test("错误转译：普通内部错误只返回通用兜底，不暴露内部信息", () => {
  const userMsg = toUserError(new Error("Internal: secret detail 12345"));
  assert.equal(userMsg, "服务器内部错误，请稍后重试。");
  assert.ok(!userMsg.includes("secret"));
});

test("缺少 token：用户友好提示可用，内部 message 保留原因（可写日志）", async () => {
  const client: BlobClient = {
    put: async () => ({ url: "u", pathname: "p" }),
    head: async () => ({ url: "u" }),
    del: async () => {},
  };
  delete process.env.BLOB_READ_WRITE_TOKEN;
  const p = new BlobStorageProvider(client);
  try {
    const err = await p.save("a.xlsx", Buffer.from("x")).then(
      () => null,
      (e) => e
    );
    assert.ok(err instanceof StorageConfigError, "应为 StorageConfigError");
    assert.equal((err as StorageConfigError).userMessage, USER_STORAGE_ERROR);
    assert.ok((err as StorageConfigError).message.includes("BLOB_READ_WRITE_TOKEN"));
    // 用户可见内容 == userMessage（友好），不含内部细节
    assert.ok(!(err as StorageConfigError).userMessage.includes("BLOB_READ_WRITE_TOKEN"));
  } finally {
    // 本文件不依赖真实 token，勿在环境中留下干扰
  }
});
