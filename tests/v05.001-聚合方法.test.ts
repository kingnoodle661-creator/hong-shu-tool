/**
 * @file v05.001-聚合方法.test.ts
 * @description V0.5-A 测试 1/4：扩展的聚合方法（avg/max/min/count）正确性。
 * 验证 NodeProcessor 的 execute 对多种 method 的聚合分发：
 *   - sum：累加；
 *   - avg：平均值；
 *   - max / min：极值；
 *   - count：统计有效个数。
 * 数据列不含“金额”身份，验证金额一致性校验自动跳过、不影响通过。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import ExcelJS from "exceljs";
import { saveUpload } from "@/services/uploads";
import { storage } from "@/services/storage";
import { excelEngine } from "@/services/excel/processor";
import type { Task } from "@/types/task";

async function buildScores() {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("成绩表");
  ws.addRow(["姓名", "分数"]);
  ws.addRow(["张三", 80]);
  ws.addRow(["李四", 90]);
  ws.addRow(["王五", 70]);
  ws.addRow(["张三", 100]);
  const buf = Buffer.from(await wb.xlsx.writeBuffer());
  return saveUpload(buf, "成绩表.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
}

async function run(task: Task) {
  const file = await buildScores();
  return excelEngine.executeTask({ file, task });
}

async function readCell(fileId: string, name: string): Promise<number> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load((await storage.get(fileId)) as unknown as ExcelJS.Buffer);
  const sheet = wb.worksheets[0];
  const row = sheet.getRow(1).values as (string | number | undefined)[];
  const col = row.indexOf("分数");
  for (let r = 2; r <= sheet.rowCount; r++) {
    if (sheet.getCell(r, 1).value === name) {
      return Number(sheet.getCell(r, col).value);
    }
  }
  return -1;
}

test("聚合：avg 求平均（张三 80+100 -> 90）", async () => {
  const outcome = await run({
    operation: "average",
    groupBy: ["姓名"],
    calculations: [{ column: "分数", method: "avg" }],
    keepHeader: true,
    sheetName: "",
    options: {},
  });
  assert.equal(outcome.result.rowCount, 3, "张三/李四/王五 三个分组");
  assert.equal(await readCell(outcome.resultFileId, "张三"), 90);
});

test("聚合：max/min 求极值", async () => {
  const maxRes = await run({
    operation: "max",
    groupBy: ["姓名"],
    calculations: [{ column: "分数", method: "max" }],
    keepHeader: true,
    sheetName: "",
    options: {},
  });
  assert.equal(await readCell(maxRes.resultFileId, "张三"), 100, "张三最大分 100");

  const minRes = await run({
    operation: "min",
    groupBy: ["姓名"],
    calculations: [{ column: "分数", method: "min" }],
    keepHeader: true,
    sheetName: "",
    options: {},
  });
  assert.equal(await readCell(minRes.resultFileId, "张三"), 80, "张三最小分 80");
});

test("聚合：count 统计有效记录数（带计算列）", async () => {
  const outcome = await run({
    operation: "count",
    groupBy: ["姓名"],
    calculations: [{ column: "分数", method: "count" }],
    keepHeader: true,
    sheetName: "",
    options: {},
  });
  assert.equal(outcome.result.rowCount, 3); // 三个姓名
  assert.equal(await readCell(outcome.resultFileId, "张三"), 2, "张三有 2 条记录");
});
