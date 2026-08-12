/**
 * @file v03.001-字段变化.test.ts
 * @description V0.3 测试 1/4：字段名变化时的智能匹配。
 * 验证 fieldMatcher 能把「AI 理解出的逻辑列名」可靠地映射到真实表头，
 * 高置信自动映射、中/低置信进入候选确认。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  matchFields,
  extractTaskFields,
  applyConfirmedMatches,
} from "@/services/ai/fieldMatcher";

test("字段变化：逻辑列名『采购金额』可匹配到真实表头『金额(元)』", () => {
  // 真实表头与 AI 表达存在差异（少了"采购"、多了"(元)"）
  const headers = ["商品名称", "金额(元)", "数量", "备注"];
  const res = matchFields(["采购金额"], headers);
  const m = res.matches[0];
  // 应能找到候选，且候选首项是 "金额(元)"
  assert.ok(m.candidates.length > 0);
  assert.equal(m.candidates[0].header, "金额(元)");
  // 中/低置信 -> 需要用户确认
  assert.equal(res.needConfirm, true);
});

test("字段变化：完全一致的表头自动映射，无需确认", () => {
  const headers = ["商品名称", "采购数量", "采购金额"];
  const res = matchFields(["采购数量", "采购金额"], headers);
  // 逻辑列名 == 真实表头 -> 高置信自动匹配
  assert.equal(res.needConfirm, false);
  assert.equal(res.mapping["采购数量"], "采购数量");
  assert.equal(res.mapping["采购金额"], "采购金额");
});

test("字段变化：无匹配字段时给出候选并需要用户选择", () => {
  const headers = ["品名", "单价", "数量", "合计"];
  const res = matchFields(["商品名称", "金额"], headers);
  const byField = new Map(res.matches.map((m) => [m.field, m]));
  // "商品名称" 应候选到 "品名"（别名命中）
  assert.ok((byField.get("商品名称")?.candidates[0]?.header) === "品名");
  // "金额" 应候选到 "合计"（关键词别名）
  assert.equal((byField.get("金额")?.candidates[0]?.header), "合计");
  assert.equal(res.needConfirm, true);
});

test("字段变化：用户确认后 applyConfirmedMatches 生成可用映射", () => {
  const headers = ["品名", "合计", "数量"];
  const res = matchFields(["商品名称", "金额"], headers);
  const mapping = applyConfirmedMatches(res, {
    商品名称: { matchedTo: "品名" },
    金额: { matchedTo: "合计" },
  });
  assert.equal(mapping["商品名称"], "品名");
  assert.equal(mapping["金额"], "合计");
});

test("extractTaskFields 汇总分组列与计算列且去重", () => {
  const fields = extractTaskFields(["商品名称"], [
    { column: "采购数量" },
    { column: "采购金额" },
  ]);
  assert.deepEqual(fields, ["商品名称", "采购数量", "采购金额"]);
});
