"use client";

/**
 * @file FieldConfirm.tsx
 * @description 字段确认组件（处理前确认页，V0.3）。
 *
 * 当 AI 理解出的字段与表格真实列名不完全一致（中/低置信）时展示此页：
 *   1. 用自然语言说明「我理解您的需求是针对这些列做处理」。
 *   2. 对每个待确认字段，列出候选真实列名供用户点选。
 *   3. 提供「重新描述需求」与「确认并继续」两个动作。
 * 用户确认后通过 onConfirm 返回 { 逻辑列名 -> 真实列名 } 映射。
 */
import { useCallback, useState } from "react";
import type { FieldMatchResult } from "@/types/fieldMatch";

interface FieldConfirmProps {
  /** 用户的一句话需求 */
  requirement: string;
  /** 字段匹配结果 */
  match: FieldMatchResult;
  /** 用户确认映射后回调（参数：逻辑列名->真实列名） */
  onConfirm: (mapping: Record<string, string>) => void;
  /** 用户点击「重新描述需求」 */
  onRedo: () => void;
}

export default function FieldConfirm({
  requirement,
  match,
  onConfirm,
  onRedo,
}: FieldConfirmProps) {
  // 记录每个字段当前选择的真实列名；默认取高置信命中或候选第一项
  const initial = useCallback(() => {
    const m: Record<string, string> = {};
    for (const fm of match.matches) {
      if (fm.confirmed && fm.matchedTo) m[fm.field] = fm.matchedTo;
      else if (fm.candidates[0]) m[fm.field] = fm.candidates[0].header;
    }
    return m;
  }, [match.matches]);
  const [selections, setSelections] = useState<Record<string, string>>(initial);

  const setField = useCallback((field: string, header: string) => {
    setSelections((prev) => ({ ...prev, [field]: header }));
  }, []);

  return (
    <div className="w-full rounded-2xl border-2 border-blue-200 bg-blue-50 p-6">
      <h3 className="text-2xl font-bold text-slate-800">🔍 请确认表格字段</h3>
      <p className="mt-2 text-lg text-slate-600">
        我理解您的需求是：<b className="text-slate-800">{requirement}</b>
      </p>
      <p className="mt-2 text-lg text-slate-600">
        您需要处理的列与表格列名不完全一致，请为每一项选择一个最匹配的表格列：
      </p>

      <div className="mt-4 flex flex-col gap-4">
        {match.matches.map((fm) => (
          <div
            key={fm.field}
            className="rounded-xl border border-slate-200 bg-white p-4"
          >
            <p className="text-xl font-semibold text-slate-800">
              需要：{fm.field}
              <span className="ml-2 text-base font-normal text-slate-400">
                {fm.confidence === "high"
                  ? "（高置信）"
                  : fm.confidence === "medium"
                  ? "（建议确认）"
                  : "（请选择）"}
              </span>
            </p>
            {fm.candidates.length > 0 ? (
              <div className="mt-3 flex flex-wrap gap-2">
                {fm.candidates.map((cand) => (
                  <button
                    key={cand.header}
                    type="button"
                    onClick={() => setField(fm.field, cand.header)}
                    className={`rounded-full px-4 py-2 text-lg transition-colors ${
                      selections[fm.field] === cand.header
                        ? "bg-blue-600 text-white"
                        : "bg-slate-100 text-slate-700 hover:bg-slate-200"
                    }`}
                  >
                    {cand.header}
                  </button>
                ))}
              </div>
            ) : (
              <p className="mt-2 text-lg text-red-500">
                未能在表格中找到相关列，请检查下拉选项或重新描述。
              </p>
            )}
          </div>
        ))}
      </div>

      <div className="mt-6 flex flex-col gap-3 sm:flex-row">
        <button
          type="button"
          onClick={() => onConfirm(selections)}
          className="flex-1 rounded-2xl bg-blue-600 px-6 py-4 text-2xl font-bold text-white transition-colors hover:bg-blue-700"
        >
          ✅ 确认并继续
        </button>
        <button
          type="button"
          onClick={onRedo}
          className="flex-1 rounded-2xl bg-white border-2 border-blue-400 px-6 py-4 text-2xl font-bold text-blue-700 transition-colors hover:bg-blue-50"
        >
          ↩️ 重新描述需求
        </button>
      </div>
    </div>
  );
}
