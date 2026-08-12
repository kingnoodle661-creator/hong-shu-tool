/**
 * @file v05.002-去重.test.ts
 * @description V0.5-A 测试 2/4：去重（distinct）正确性。
 * 验证「把一样的合起来 / 删除重复行」：
 *   - 按“全部列”删除完全重复的行，保留首次出现；
 *   - 按指定列去重，重复值只保留首次出现的完整行；
 *   - 结果表保留全部表头。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import ExcelJS from "exceljs";
import { saveUpload } from "@/services/uploads";
import { storage } from "@/services/storage";
import { excelEngine } from "@/services/excel/processor";
import { verifyProcessResult } from "@/services/verify/verifier";
import type { Task } from "@/types/task";

async function buildDup() {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("清单");
  ws.addRow(["商品", "数量"]);
  ws.addRow(["苹果", 5]);
  ws.addRow(["苹果", 5]); // 与上一行完全重复
  ws.addRow(["香蕉", 3]);
  ws.addRow(["苹果", 8]); // 同一商品但数量不同
  const buf = Buffer.from(await wb.xlsx.writeBuffer());
  return saveUpload(buf, "重复清单.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
}

async function runRows(task: Task) {
  const file = await buildDup();
  const outcome = await excelEngine.executeTask({ file, task });
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load((await storage.get(outcome.resultFileId)) as unknown as ExcelJS.Buffer);
  const sheet = wb.worksheets[0];
  const rows: string[][] = [];
  for (let r = 2; r <= sheet.rowCount; r++) {
    rows.push([
      String(sheet.getCell(r, 1).value),
      String(sheet.getCell(r, 2).value),
    ]);
  }
  return { outcome, rows };
}

test("去重：按「全部列」删除完全重复行", async () => {
  const { outcome, rows } = await runRows({
    operation: "distinct",
    groupBy: ["全部列"],
    calculations: [],
    keepHeader: true,
    sheetName: "",
    options: {},
  });
  // 删掉完全重复的第二行“苹果 5”，保留 3 行：苹果5 / 香蕉3 / 苹果8
  assert.equal(rows.length, 3, "完全重复行应被合并");
  assert.equal(outcome.result.headers.length, 2, "保留全部表头");
});

test("去重：按指定列去重（保留首次出现）", async () => {
  const { rows } = await runRows({
    operation: "distinct",
    groupBy: ["商品"],
    calculations: [],
    keepHeader: true,
    sheetName: "",
    options: { distinctBy: "商品" },
  });
  // 按“商品”去重：苹果(5) / 香蕉(3)，苹果(8)因商品重复被删除
  assert.equal(rows.length, 2, "按商品列去重应剩 2 行");
  // 首次出现的“苹果 5”保留
  assert.deepEqual(rows.find((r) => r[0] === "苹果"), ["苹果", "5"]);
});

test("去重：结果审查对 distinct 不误报「任务未完成」", async () => {
  const task: Task = {
    operation: "distinct",
    groupBy: ["全部列"],
    calculations: [],
    keepHeader: true,
    sheetName: "",
    options: {},
  };
  const { outcome } = await runRows(task);
  const suite = verifyProcessResult(outcome.preview, outcome.result, task);
  const taskCheck = suite.checks.find((c) => c.name === "任务完成检查");
  assert.ok(taskCheck, "应存在任务完成检查项");
  assert.equal(taskCheck!.result, "通过", "distinct 不应因「全部列」哨兵误报未完成");
  const money = suite.checks.find((c) => c.name === "金额校验");
  assert.equal(money!.result, "通过", "distinct 应跳过金额校验并视为通过");
});
