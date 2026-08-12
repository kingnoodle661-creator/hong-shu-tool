"use client";

/**
 * @file ResultCard.tsx
 * @description 处理结果 + 审查报告的展示组件（纯展示，不发起请求）。
 */
import { memo } from "react";
import type { PipelineResult } from "@/types/frontend";

interface ResultCardProps {
  /** 是否已有结果可展示 */
  hasResult: boolean;
  /** 流水线返回的结果 */
  result?: PipelineResult | null;
  /** 处理出错时的错误信息 */
  error?: string | null;
}

function ResultCard({ hasResult, result, error }: ResultCardProps) {
  // 错误提示
  if (error) {
    return (
      <div className="w-full rounded-2xl border-2 border-red-200 bg-red-50 p-6 text-2xl text-red-700">
        ⚠️ {error}
      </div>
    );
  }

  // 尚无结果
  if (!hasResult || !result) {
    return (
      <div className="w-full rounded-2xl border-2 border-slate-200 bg-white p-6 text-xl text-slate-400">
        📋 处理结果将显示在这里。
      </div>
    );
  }

  const { result: summary, verification, message, resultFileId, preview } = result;

  return (
    <div className="w-full rounded-2xl border-2 border-slate-200 bg-white p-6">
      <h3 className="text-2xl font-bold text-slate-800">✅ 处理完成</h3>

      {/* 处理结果摘要 */}
      <div className="mt-4 flex flex-col gap-2 text-xl text-slate-700">
        {message && <p className="text-slate-600">{message}</p>}
        {preview.sourceMetadata?.fileName && (
          <p className="text-slate-500">
            源文件：{preview.sourceMetadata.fileName}
            {preview.sourceMetadata.size
              ? `（${(preview.sourceMetadata.size / 1024).toFixed(1)} KB）`
              : ""}
          </p>
        )}
        <p>
          数据量：{preview.rowCount} 行 →{" "}
          <span className="font-semibold">{summary.rowCount} 行</span>
        </p>
        <p>
          金额合计：<span className="font-semibold">¥{summary.totalAmount.toFixed(2)}</span>
        </p>
        {summary.headers.length > 0 && (
          <p className="text-slate-600">表头：{summary.headers.join("、")}</p>
        )}
      </div>

      {/* 审查报告 */}
      {verification && (
        <div className="mt-5">
          <h4 className="text-2xl font-semibold text-slate-800">🔍 审查报告</h4>
          <div
            className={`mt-3 rounded-xl p-4 text-xl ${
              verification.success ? "bg-green-50 text-green-700" : "bg-amber-50 text-amber-700"
            }`}
          >
            {verification.summary && (
              <p className="font-bold">{verification.success ? "✔ " : "⚠ "}{verification.summary}</p>
            )}
            {!verification.summary && (
              <p className="font-bold">{verification.success ? "✔ 全部通过" : "⚠ 存在疑点，请核实"}</p>
            )}
            <ul className="mt-2 list-disc pl-5">
              {verification.checks.map((c) => (
                <li key={c.name} className="mt-1">
                  <b>{c.name}：</b>
                  <span>{c.result}</span>
                  {c.detail && <p className="text-base text-slate-500">{c.detail}</p>}
                </li>
              ))}
            </ul>
            {verification.details && verification.details.length > 0 && (
              <details className="mt-3">
                <summary className="cursor-pointer text-lg font-medium text-slate-600">
                  查看更多说明
                </summary>
                <ul className="mt-2 list-disc pl-5 text-base text-slate-600">
                  {verification.details.map((d, i) => (
                    <li key={i}>{d}</li>
                  ))}
                </ul>
              </details>
            )}
          </div>
        </div>
      )}

      {/* 下载按钮 */}
      {resultFileId && (
        <a
          href={`/api/excel/download?fileId=${encodeURIComponent(resultFileId)}`}
          className="mt-5 inline-block w-full rounded-2xl bg-green-600 px-6 py-4 text-center text-2xl font-bold text-white hover:bg-green-700"
        >
          ⬇️ 下载处理后的 Excel
        </a>
      )}
    </div>
  );
}

export default memo(ResultCard);
