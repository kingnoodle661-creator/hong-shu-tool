"use client";

/**
 * @file TableAnalysis.tsx
 * @description Excel 表分析结果展示组件（V0.5-A 新增）。
 *
 * 上传文件后自动调用 /api/excel/analyze，本组件展示：
 *   1. 表类型结论：「我发现这是一个【采购表】，共 N 行数据」。
 *   2. 常用处理操作推荐按钮（来自表分析的建议）。
 * 点击推荐：
 *   - 带 task 的 -> 直接交给父组件执行（onPickTask）；
 *   - task="describe" -> 提示用户转去描述（onDescribe）。
 * 面向中老年：大卡片、大按钮、简洁。
 */
import { memo } from "react";
import type { TableAnalysis as TableAnalysisData, Task } from "@/types/task";

/** 用 emoji 表示不同类型表，增强辨识度 */
const TYPE_EMOJI: Record<string, string> = {
  采购表: "🛒",
  销售表: "💰",
  库存表: "📦",
  财务表: "🧾",
  明细表: "📋",
  通用表: "📊",
};

interface TableAnalysisProps {
  /** 表分析结果；null 表示仍在分析中或失败 */
  analysis: TableAnalysisData | null;
  /** 是否正在分析（展示载入提示） */
  loading: boolean;
  /** 点击「带 task 的推荐」回调（直接把该任务带入提交流程） */
  onPickTask: (task: Task) => void;
  /** 点击「task=describe（我来描述）」回调 */
  onDescribe: () => void;
}

function TableAnalysis({ analysis, loading, onPickTask, onDescribe }: TableAnalysisProps) {
  if (loading) {
    return (
      <div className="w-full rounded-2xl border-2 border-slate-200 bg-blue-50 p-6 text-center">
        <p className="text-2xl font-bold text-blue-700" role="status">
          🔍 正在分析表格…
        </p>
      </div>
    );
  }

  if (!analysis) return null;

  const emoji = TYPE_EMOJI[analysis.tableTypeName] || "📊";

  return (
    <div className="w-full rounded-2xl border-2 border-green-200 bg-green-50 p-6">
      <h3 className="text-2xl font-bold text-slate-800">
        {emoji} 我发现这是一个<span className="text-blue-700">{analysis.tableTypeName}</span>
        <span className="ml-2 text-lg font-normal text-slate-500">
          （共约 {analysis.rowCount} 行）
        </span>
      </h3>

      <p className="mt-3 text-xl text-slate-700">您可以点一下，我帮您处理：</p>
      <div className="mt-3 flex flex-wrap gap-2">
        {analysis.suggestions.map((s, i) => {
          const suggestTask = s.task; // 捕获为 const，便于在闭包中收窄
          return suggestTask === "describe" ? (
            <button
              key={`${s.label}-${i}`}
              type="button"
              onClick={onDescribe}
              className="rounded-full bg-white border-2 border-blue-400 px-4 py-2 text-lg text-blue-700 transition-colors hover:bg-blue-50"
            >
              {s.label}
            </button>
          ) : (
            <button
              key={`${s.label}-${i}`}
              type="button"
              onClick={() => onPickTask(suggestTask)}
              className="rounded-full bg-blue-600 px-4 py-2 text-lg text-white transition-colors hover:bg-blue-700"
            >
              {s.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export default memo(TableAnalysis);
