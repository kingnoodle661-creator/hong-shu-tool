/**
 * @file v03.004-错误需求.test.ts
 * @description V0.3 测试 4/4：错误 / 无法理解的需求兜底。
 * 验证程序侧 schema 校验能拒绝不可信模型输出：
 *   - operation 非法或 unknown -> 拒绝；
 *   - 缺失计算列 / 结构非法 -> 拒绝；
 *   - 字段类型错乱 -> 规范化或拒绝；
 *   - 合法输入 -> 通过并规范化。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseAndValidateTask } from "@/services/ai/schema";

test("错误需求：operation 未知 -> 拒绝", () => {
  assert.throws(
    () => parseAndValidateTask({ operation: "delete_all", groupBy: [], calculations: [{ column: "x", method: "sum" }] }),
    /无法理解/
  );
  assert.throws(
    () => parseAndValidateTask({ operation: "unknown", groupBy: [], calculations: [{ column: "x", method: "sum" }] }),
    /无法理解/
  );
});

test("错误需求：没有任何计算列 -> 拒绝", () => {
  assert.throws(() => parseAndValidateTask({ operation: "group_sum", groupBy: [], calculations: [] }), /无法理解/);
  assert.throws(
    () => parseAndValidateTask({ operation: "group_sum", groupBy: ["商品"], calculations: [{ column: "", method: "sum" }] }),
    /无法理解/
  );
});

test("错误需求：结构非法（非对象 / 非法 method）-> 拒绝或规范化", () => {
  // 非对象
  assert.throws(() => parseAndValidateTask(null));
  assert.throws(() => parseAndValidateTask("not json"));
  // method 非法（不属于 sum/avg/max/min/count）-> 该项被剔除，最终因无有效计算列被拒绝
  assert.throws(
    () => parseAndValidateTask({ operation: "sum", groupBy: [], calculations: [{ column: "金额", method: "divide" }] }),
    /无法理解/
  );
});

test("合法需求（V0.5-A）：avg/max/min/count 为合法 method", () => {
  const t = parseAndValidateTask({
    operation: "average",
    groupBy: [],
    calculations: [{ column: "金额", method: "avg" }],
  });
  assert.equal(t.operation, "average");
  assert.equal(t.calculations[0].method, "avg");

  const m = parseAndValidateTask({
    operation: "max",
    groupBy: [],
    calculations: [{ column: "金额", method: "max" }],
  });
  assert.equal(m.calculations[0].method, "max");
});

test("合法需求：规范化并保留字段", () => {
  const t = parseAndValidateTask({
    operation: "group_sum",
    groupBy: ["商品名称"],
    calculations: [{ column: "采购金额", method: "sum" }],
    keepHeader: false,
  });
  assert.equal(t.operation, "group_sum");
  assert.deepEqual(t.groupBy, ["商品名称"]);
  assert.equal(t.calculations[0].column, "采购金额");
  assert.equal(t.keepHeader, false);
});

test("合法需求：groupBy 含非法项被剔除，keepHeader 缺省为 true", () => {
  const t = parseAndValidateTask({
    operation: "sum",
    groupBy: ["a", "", 123 as unknown as string],
    calculations: [{ column: "采购数量", method: "sum" }],
  });
  assert.deepEqual(t.groupBy, ["a"]);
  assert.equal(t.keepHeader, true);
});
