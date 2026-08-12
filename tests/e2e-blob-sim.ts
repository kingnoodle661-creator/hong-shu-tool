/**
 * @file e2e-blob-sim.ts
 * @description V0.4 端到端冒烟测试（Blob 存储驱动，mock 注入，不需要真实网络/token）。
 *
 * 通过 tsx 运行（package.json 的 test:e2e 已配置），使用可注入的 mock Blob 客户端
 * 替换全局 storage 单例，在内存里跑通与真实生产一致的完整链路：
 *   上传 -> 处理(save 结果到 blob) -> 读回结果 -> 生命周期清理
 * 这样在无 BLOB_READ_WRITE_TOKEN / 无 Vercel 环境的本地，也能验证 Blob 驱动下的
 * 业务闭环，不产生真实网络请求，也不会伪报通过。
 *
 * 运行：npx tsx tests/e2e-blob-sim.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import ExcelJS from "exceljs";
import { BlobStorageProvider } from "@/services/storage/blob";
import { setStorageProviderForTest, storage } from "@/services/storage";
import { saveUpload } from "@/services/uploads";
import { excelEngine } from "@/services/excel/processor";
import { recordFile, cleanupOldFiles, listTrackedFiles } from "@/services/storage/lifecycle";
import type { Task } from "@/types/task";

/** 内存版 Blob 替身：模拟 @vercel/blob 的 put/head/del，url 可用 mockFetch 读取 */
function makeMockBlob() {
  const store = new Map<string, Buffer>();
  const client = {
    async put(name: string, body: Buffer) {
      store.set(name, Buffer.from(body));
      return { url: `https://mock.blob.invalid/${name}`, pathname: `/${name}`, downloadUrl: `https://mock.blob.invalid/${name}` };
    },
    async head(url: string) {
      const name = decodeURIComponent(url.replace("https://mock.blob.invalid/", ""));
      if (!store.has(name)) throw new Error(`blob: not found ${name}`);
      return { url, size: (store.get(name) as Buffer).length };
    },
    async del(url: string) {
      const name = decodeURIComponent(url.replace("https://mock.blob.invalid/", ""));
      store.delete(name);
    },
  };
  const mockFetch = async (input: string): Promise<Response> => {
    const name = decodeURIComponent(input.replace("https://mock.blob.invalid/", ""));
    if (!store.has(name)) return new Response("not found", { status: 404 });
    return new Response(new Uint8Array(store.get(name) as Buffer));
  };
  return { client, mockFetch, store };
}

async function buildWorkbook(): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("采购表");
  ws.addRow(["品名", "金额(元)"]);
  ws.addRow(["苹果", "￥500"]);
  ws.addRow(["香蕉", "300 元"]);
  ws.addRow(["苹果", "1,100"]);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

const task: Task = {
  operation: "group_sum",
  groupBy: ["品名"],
  calculations: [{ column: "金额(元)", method: "sum" }],
  keepHeader: true,
};

test("Blob 端到端：上传->处理->读回->生命周期清理 全链路正常（mock 无网络）", async () => {
  const { client, mockFetch } = makeMockBlob();
  process.env.BLOB_READ_WRITE_TOKEN = "mock-token";
  delete process.env.STORAGE_DRIVER;
  setStorageProviderForTest(new BlobStorageProvider(client, mockFetch));
  assert.equal((await import("@/services/storage")).storage.name, "blob", "注入后应指向 blob 驱动");

  try {
    // 1) 上传 -> blob 落库 + 记账
    const xlsx = await buildWorkbook();
    const file = await saveUpload(xlsx, "采购表.xlsx", "");
    const out = await excelEngine.executeTask({ file, task });
    assert.equal(out.result.rowCount, 2);
    assert.equal(out.result.totalAmount, 500 + 300 + 1100, "金额应为 1900");

    // 2) 下载等价：从存储层读回结果字节，确认可解析
    const buf = await storage.get(out.resultFileId);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as unknown as ExcelJS.Buffer);
    const ws = wb.worksheets[0];
    const rows: unknown[] = [];
    ws.eachRow((row, r) => { if (r > 1) rows.push(row.getCell(2).value); });
    assert.deepEqual([...rows].sort(), [1600, 300], "苹果合计1600、香蕉300");

    // 3) 生命周期：清单中应有 上传1 + 结果1
    const tracked = await listTrackedFiles();
    const ids = tracked.map((e) => e.fileId);
    assert.ok(ids.includes(file.fileId), "清单包含上传文件");
    assert.ok(ids.includes(out.resultFileId), "清单包含结果文件");

    // 4) 清理：maxAgeMs=0 => 全部视为过期，验证删除链路
    await recordFile(file.fileId, "upload");
    const { removed } = await cleanupOldFiles(0);
    assert.ok(removed >= 1, `应清理至少 1 个（当前 ${removed}）`);

    // 5) 清理后清单应被精简
    const after = await listTrackedFiles();
    assert.ok(after.length <= tracked.length, "清理后清单应被精简");
    console.log(`Blob 端到端通过 ✔ 结果行=${out.result.rowCount} 金额=${out.result.totalAmount} 清理=${removed}`);
  } finally {
    setStorageProviderForTest(); // 恢复默认驱动，避免污染同进程其它测试
    delete process.env.BLOB_READ_WRITE_TOKEN;
  }
});

test("Blob 端到端：流程同时落真实本地（对照），确保业务逻辑未退化", async () => {
  setStorageProviderForTest(); // 恢复默认 local
  const xlsx = await buildWorkbook();
  const file = await saveUpload(xlsx, "对照组.xlsx", "");
  const out = await excelEngine.executeTask({ file, task });
  assert.equal(out.result.totalAmount, 1900);
  const buf = await storage.get(out.resultFileId);
  assert.ok(buf.length > 0, "本地驱动也应能读回结果");
  console.log(`Local 对照通过 ✔ 金额=${out.result.totalAmount}`);
});
