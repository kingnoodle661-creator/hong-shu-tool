/**
 * @file v03.003-空数据.test.ts
 * @description V0.3 测试 3/4：空数据行处理。
 * 验证：包含空行 / 缺失单元格的表格，在执行分组求和时：
 *   - 空值按 0 处理，不会导致 NaN 或崩溃；
 *   - 空行被跳过，不影响分组统计；
 *   - 计算结果正确且可审查。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import ExcelJS from "exceljs";
import { saveUpload } from "@/services/uploads";
import { storage } from "@/services/storage";
import { excelEngine } from "@/services/excel/processor";
import type { Task } from "@/types/task";

async function readResultFile(fileId: string): Promise<Buffer> {
  return storage.get(fileId);
}

/** 构造一个含空行与空单元格的采购表，返回其 ExcelFile */
async function buildWorkbook() {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("采购表");
  ws.addRow(["商品名称", "采购数量", "采购金额"]);
  ws.addRow(["苹果", 50, "￥500"]); // 金额用货币符号字符串
  ws.addRow([]); // 全为空行
  ws.addRow(["香蕉", 30, "300 元"]); // 尾部带单位
  ws.addRow(["", 0, ""]); // 数值为空 -> 0
  ws.addRow(["苹果", 60, "1,100"]); // 千分位字符串，仍归组"苹果"
  const buf = Buffer.from(await wb.xlsx.writeBuffer());
  return saveUpload(buf, "空数据测试.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
}

const task: Task = {
  operation: "group_sum",
  groupBy: ["商品名称"],
  calculations: [
    { column: "采购数量", method: "sum" },
    { column: "采购金额", method: "sum" },
  ],
  keepHeader: true,
};

test("空数据：空行不崩溃，空值按 0，分组求和正确", async () => {
  const file = await buildWorkbook();
  const outcome = await excelEngine.executeTask({ file, task });

  // 苹果：数量 50+60=110，金额 500+1100=1600（¥500 → 500，1,100 → 1100）
  // 香蕉：数量 30，金额 300
  const rows = outcome.result.headers.findIndex((h) => h === "商品名称");
  assert.ok(rows >= 0);
  assert.equal(outcome.result.rowCount, 2, "应正确汇出 2 个分组（苹果、香蕉）");

  // 用结果表定位"苹果"行的合计值（结果表第一行为表头，数据从第 2 行起）
  const ws = new ExcelJS.Workbook();
  await ws.xlsx.load((await readResultFile(outcome.resultFileId)) as unknown as ExcelJS.Buffer);
  const sheet = ws.worksheets[0];
  const amountCol = outcome.result.headers.indexOf("采购金额") + 1;
  const qtyCol = outcome.result.headers.indexOf("采购数量") + 1;
  let appleAmount = -1;
  let appleQty = -1;
  for (let r = 2; r <= sheet.rowCount; r++) {
    if (sheet.getCell(r, 1).value === "苹果") {
      appleQty = Number(sheet.getCell(r, qtyCol).value);
      appleAmount = Number(sheet.getCell(r, amountCol).value);
    }
  }
  assert.equal(appleQty, 110);
  assert.equal(appleAmount, 1600);
});
