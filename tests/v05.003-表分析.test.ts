/**
 * @file v05.003-表分析.test.ts
 * @description V0.5-A 测试 3/4：确定性表类型识别与推荐。
 * 验证 tableAnalyzer 的规则层：
 *   - 采购表 / 销售表 / 库存表 关键词识别；
 *   - 不匹配时返回 null（让上层走 AI 兜底）；
 *   - 推荐操作可生成合法 Task（引用真实表头，operation 合法）。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  analyzeTableTypeByRule,
  suggestByTableType,
} from "@/services/analyzer/tableAnalyzer";

test("表分析：识别采购表", () => {
  const r = analyzeTableTypeByRule(["商品名称", "采购数量", "采购金额"]);
  assert.equal(r.tableTypeName, "采购表");
});

test("表分析：识别销售表", () => {
  const r = analyzeTableTypeByRule(["客户名称", "销售数量", "销售额"]);
  assert.equal(r.tableTypeName, "销售表");
});

test("表分析：识别库存表", () => {
  const r = analyzeTableTypeByRule(["货品", "库存数量", "单价"]);
  assert.equal(r.tableTypeName, "库存表");
});

test("表分析：无规则命中返回 null（供 AI 兜底）", () => {
  const r = analyzeTableTypeByRule(["列一", "列二", "随便什么"]);
  assert.equal(r.tableTypeName, null);
});

test("表分析：采购表推荐引用真实表头且任务合法", () => {
  const headers = ["商品名称", "采购数量", "采购金额"];
  const suggestions = suggestByTableType("采购表", headers);
  assert.ok(suggestions.length >= 3, "至少 3 条推荐");
  // 第一条推荐为分组汇总，引用真实列名
  const first = suggestions[0];
  assert.notEqual(first.task, "describe");
  assert.equal(typeof first.task, "object");
  if (typeof first.task !== "string") {
    assert.equal(first.task.operation, "group_sum");
    assert.ok(headers.includes(first.task.groupBy[0]), "分组列来自真实表头");
  }
  // 最后一条为「我来描述」
  const last = suggestions[suggestions.length - 1];
  assert.equal(last.task, "describe");
});
