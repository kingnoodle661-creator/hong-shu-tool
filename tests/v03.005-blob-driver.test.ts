/**
 * @file v03.005-blob-driver.test.ts
 * @description V0.4 测试：Vercel Blob 存储驱动（测试2，mock 双轨 + 真实可选）。
 *
 * 用可注入的 mock client / mock fetch 验证 BlobStorageProvider：
 *   save → 返回 {url,pathname}；get → 读回原始字节；delete → 移除；canResolve。
 * 并跑通「上传→处理→读回」全流程（使用 setStorageProviderForTest 注入 blob 驱动）。
 * 若环境变量 BLOB_READ_WRITE_TOKEN 存在，则另行打真实 Vercel Blob 验证；缺失则明确跳过。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import ExcelJS from "exceljs";
import { BlobStorageProvider, type BlobClient } from "@/services/storage/blob";
import { setStorageProviderForTest, storage } from "@/services/storage";
import { saveUpload, newResultFileId } from "@/services/uploads";
import { excelEngine } from "@/services/excel/processor";
import type { Task } from "@/types/task";

/** 内存版 Blob 替身：模拟 @vercel/blob 的 put/head/del + url 可 fetch */
function makeMockBlob() {
  const store = new Map<string, Buffer>();
  const client: BlobClient = {
    async put(name, body, _opts) {
      store.set(name, Buffer.from(body));
      const url = `https://mock.blob.invalid/${name}`;
      return { url, pathname: `/${name}`, downloadUrl: url };
    },
    async head(url) {
      const name = decodeURIComponent(url.replace("https://mock.blob.invalid/", ""));
      if (!store.has(name)) throw new Error("mock not found");
      return { url, size: store.get(name)!.length };
    },
    async del(url) {
      const name = decodeURIComponent(url.replace("https://mock.blob.invalid/", ""));
      store.delete(name);
    },
  };
  const mockFetch = async (input: string): Promise<Response> => {
    const name = decodeURIComponent(input.replace("https://mock.blob.invalid/", ""));
    if (!store.has(name)) return new Response("not found", { status: 404 });
    return new Response(new Uint8Array(store.get(name)!));
  };
  return { client, mockFetch, store };
}

async function buildWorkbook() {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("S");
  ws.addRow(["品名", "金额"]);
  ws.addRow(["苹果", 100]);
  ws.addRow(["梨", 50]);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

const task: Task = {
  operation: "group_sum",
  groupBy: ["品名"],
  calculations: [{ column: "金额", method: "sum" }],
  keepHeader: true,
};

test("Blob: save 返回 url/pathname，get 读回原始字节，delete 移除", async () => {
  const { client, mockFetch } = makeMockBlob();
  process.env.BLOB_READ_WRITE_TOKEN = "mock-token";
  const p = new BlobStorageProvider(client, mockFetch);
  const data = Buffer.from("hello-excel");
  const ref = await p.save("a.xlsx", data, "application/xlsx");
  assert.ok(ref.meta?.url);
  assert.ok(ref.meta?.pathname);
  const body = await p.get(ref);
  assert.equal(body.toString(), "hello-excel");
  assert.equal(p.canResolve("x.xlsx"), true);
  await p.delete(ref.key);
  // 删除后读取应失败
  await assert.rejects(() => p.get(ref.key));
});

test("Blob: 未配置 token 时给出明确错误", async () => {
  const { client, mockFetch } = makeMockBlob();
  const prev = process.env.BLOB_READ_WRITE_TOKEN;
  delete process.env.BLOB_READ_WRITE_TOKEN;
  try {
    const p = new BlobStorageProvider(client, mockFetch);
    await assert.rejects(() => p.save("a.xlsx", Buffer.from("x")), /BLOB_READ_WRITE_TOKEN/);
  } finally {
    if (prev) process.env.BLOB_READ_WRITE_TOKEN = prev;
    else delete process.env.BLOB_READ_WRITE_TOKEN;
  }
});

test("Blob 全流程：注入 blob 驱动后 上传→处理→读回 正常", async () => {
  const { client, mockFetch } = makeMockBlob();
  process.env.BLOB_READ_WRITE_TOKEN = "mock-token";
  setStorageProviderForTest(new BlobStorageProvider(client, mockFetch));
  delete process.env.STORAGE_DRIVER; // 用注入驱动的单例

  const xlsx = await buildWorkbook();
  const file = await saveUpload(xlsx, "测试.xlsx", "");
  assert.ok(file.fileId.endsWith(".xlsx"));
  const outcome = await excelEngine.executeTask({ file, task });
  assert.equal(outcome.result.rowCount, 2);
  assert.equal(outcome.result.totalAmount, 150);

  // 读回结果文件，确认真实可解析
  const wb = new ExcelJS.Workbook();
  const buf = await storage.get(outcome.resultFileId);
  await wb.xlsx.load(buf as unknown as ExcelJS.Buffer);
  const ws = wb.worksheets[0];
  assert.ok(["苹果", "梨"].includes(String(ws.getCell(2, 1).value)));

  // 恢复默认驱动，避免污染同文件其它测试
  setStorageProviderForTest();
});

// ---- 真实 Vercel Blob（可选）：缺失 token 则跳过 ----
test("Blob 真实驱动（需 BLOB_READ_WRITE_TOKEN，缺失则跳过）", async () => {
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token || token === "mock-token") {
    console.log("SKIP: 未设置真实 BLOB_READ_WRITE_TOKEN，跳过真实 Vercel Blob 验证。需在 Vercel 上验证。");
    return;
  }
  const BlobBlob = await import("@vercel/blob");
  const { put, head, del } = BlobBlob;
  const p = new BlobStorageProvider({ put, head: head as never, del } as never);
  const ref = await p.save(newResultFileId(), Buffer.from("pipeline-check"), "text/plain");
  const body = await p.get(ref);
  assert.equal(body.toString(), "pipeline-check");
  await p.delete(ref);
  console.log("真实 Vercel Blob 读写通过 ✔");
});
