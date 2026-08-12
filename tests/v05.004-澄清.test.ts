/**
 * @file v05.004-澄清.test.ts
 * @description V0.5-A 测试 4/4：需求澄清（意图判断 + 澄清结果解析）。
 * 验证「模糊需求不报错」的核心：
 *   - parseIntentJudge 正确解析 ready/need_confirm；
 *   - 非法/空 judge 返回 null（安全降级）；
 *   - parseAndNormalizeClarify 从模型输出解析澄清问题与选项；
 *   - 解析失败时安全退化为通用澄清（而非抛「无法理解」）。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseIntentJudge,
  parseAndNormalizeClarify,
  parseAndValidateTask,
} from "@/services/ai/schema";

test("澄清：parseIntentJudge 解析 ready/need_confirm", () => {
  assert.equal(parseIntentJudge({ judge: "ready", hint: "具体" }), "ready");
  assert.equal(parseIntentJudge({ judge: "need_confirm", hint: "模糊" }), "need_confirm");
});

test("澄清：非法 judge 返回 null", () => {
  assert.equal(parseIntentJudge({ judge: "whatever" }), null);
  assert.equal(parseIntentJudge("not json"), null);
  assert.equal(parseIntentJudge({}), null);
});

test("澄清：parseAndNormalizeClarify 从模型输出解析选项", () => {
  const headers = ["商品名称", "采购金额"];
  const result = parseAndNormalizeClarify(
    {
      questions: [
        {
          question: "您想如何整理？",
          options: [
            {
              label: "按商品汇总",
              task: {
                operation: "group_sum",
                groupBy: ["商品名称"],
                calculations: [{ column: "采购金额", method: "sum" }],
                keepHeader: true,
                sheetName: "",
                options: {},
              },
            },
          ],
        },
      ],
    },
    headers
  );
  assert.equal(result.status, "need_confirm");
  assert.ok(result.questions && result.questions.length >= 1);
  const q = result.questions![0];
  assert.equal(q.options[0].label, "按商品汇总");
  assert.ok(q.options[0].task, "选项应带合法任务");
  if (q.options[0].task) {
    assert.equal(q.options[0].task.operation, "group_sum");
  }
});

test("澄清：解析失败/空结构安全退化为通用澄清，不抛错", () => {
  const headers = ["商品名称", "采购金额"];
  const result = parseAndNormalizeClarify(null, headers);
  assert.equal(result.status, "need_confirm");
  assert.ok(result.questions && result.questions.length >= 1);
  assert.ok(result.questions![0].options.length > 0, "兜底也有可选项");

  const empty = parseAndNormalizeClarify({ questions: [] }, headers);
  assert.equal(empty.status, "need_confirm");
});

test("澄清：默认澄清选项里 distinct「全部列」可通过 schema 校验", () => {
  const t = parseAndValidateTask({
    operation: "distinct",
    groupBy: ["全部列"],
    calculations: [],
    keepHeader: true,
    sheetName: "",
    options: {},
  });
  assert.equal(t.operation, "distinct");
});
