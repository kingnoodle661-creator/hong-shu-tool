"use client";

/**
 * @file StepProgress.tsx
 * @description 五步骤状态进度条（V0.3）。
 * 展示处理主流程的可视进度：上传 → 理解 → 确认 → 处理 → 检查。
 * 当前所处的阶段高亮为蓝色，已完成阶段显示对勾，未到阶段置灰。
 */
import { memo } from "react";
import { STEP_LIST, type ProcessStage } from "@/types/frontend";

interface StepProgressProps {
  /** 当前阶段 */
  stage: ProcessStage;
}

/** 各阶段在进度条中对应到第几步（1~5）；idle/error 映射到各不相同的位置 */
function stageIndex(stage: ProcessStage): number {
  switch (stage) {
    case "idle":
      return 0; // 尚无步骤
    case "uploaded":
    case "analyzing":
      return 1;
    case "confirming":
      return 2;
    case "processing":
      return 3;
    case "checking":
      return 4;
    case "done":
      return 5;
    case "error":
      return -1; // 出错时不高亮具体步骤
  }
}

function StepProgress({ stage }: StepProgressProps) {
  const current = stageIndex(stage);

  return (
    <ol className="flex w-full list-none items-center justify-between gap-0 px-1">
      {STEP_LIST.map((step, i) => {
        const idx = i + 1;
        const reached = current > 0 && idx <= current;
        const active = current === idx;
        return (
          <li key={step.key} className="flex flex-1 flex-col items-center gap-1">
            <span
              className={`flex h-10 w-10 items-center justify-center rounded-full text-lg font-bold transition-colors ${
                active
                  ? "bg-blue-600 text-white ring-4 ring-blue-200"
                  : reached
                  ? "bg-green-500 text-white"
                  : "bg-slate-200 text-slate-500"
              }`}
            >
              {reached && !active ? "✓" : idx}
            </span>
            <span
              className={`text-sm ${
                active ? "font-semibold text-blue-700" : "text-slate-500"
              }`}
            >
              {step.label}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

export default memo(StepProgress);
