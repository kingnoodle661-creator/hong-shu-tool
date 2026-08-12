/**
 * @file v03.002-金额格式.test.ts
 * @description V0.3 测试 2/4：金额格式解析与空值=0。
 * 验证 processor.cellToNumber 能解析：货币符号、千分位、尾部单位、全/半角，
 * 且空值/非数字一律视为 0（不污染求和）。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { cellToNumber } from "@/services/excel/processor";

test("金额格式：货币符号 ￥/¥/$", () => {
  assert.equal(cellToNumber("￥1000"), 1000);
  assert.equal(cellToNumber("¥1000.5"), 1000.5);
  assert.equal(cellToNumber("$120"), 120);
});

test("金额格式：千分位 + 全/半角逗号", () => {
  assert.equal(cellToNumber("1,000"), 1000);
  assert.equal(cellToNumber("12,345.67"), 12345.67);
  assert.equal(cellToNumber("9，999"), 9999);
});

test("金额格式：尾部单位『元』与空白", () => {
  assert.equal(cellToNumber("1000 元"), 1000);
  assert.equal(cellToNumber("  12.5  "), 12.5);
});

test("金额格式：空值/非数字一律视为 0（符合空值=0 规则）", () => {
  assert.equal(cellToNumber(undefined), 0);
  assert.equal(cellToNumber(null as unknown as number), 0);
  assert.equal(cellToNumber(""), 0);
  assert.equal(cellToNumber("-"), 0);
  assert.equal(cellToNumber("abc"), 0);
  assert.equal(cellToNumber(""), 0);
});

test("金额格式：数字直接通过", () => {
  assert.equal(cellToNumber(0), 0);
  assert.equal(cellToNumber(42.5), 42.5);
  assert.equal(cellToNumber(Number.POSITIVE_INFINITY), 0);
});
