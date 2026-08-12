"use client";

/**
 * @file ClarifyPanel.tsx
 * @description 需求澄清组件（V0.5-A 新增）。
 *
 * 当用户的描述较为模糊（例如「整理一下」「把一样的合起来」），
 * /api/ai 会返回 { status:"need_confirm", questions:[...] }。
 * 本组件把澄清问题与可点选的「操作选项」展示给用户：
 *   - 点击带 task 的选项 -> 进入后续流程（字段匹配 / 确认 / 执行）；
 *   - 点击「重新描述」-> 回到输入框让用户重新组织语言。
 * 面向中老年：大卡片、大按钮、一键即办。
 */
import { memo } from "react";
import type {
  ClarifyOption,
  ClarifyQuestion,
  Task,
} from "@/types/task";

interface ClarifyPanelProps {
  /** 用户原来的那句话需求（用于上下文提示） */
  requirement: string;
  /** 澄清问题列表 */
  questions: ClarifyQuestion[];
  /** 用户点选某个带任务的选项 */
  onPickOption: (task: Task) => void;
  /** 用户点选「重新描述」 */
  onRedo: () => void;
}

function ClarifyPanel({
  requirement,
  questions,
  onPickOption,
  onRedo,
}: ClarifyPanelProps) {
  return (
    <div className="w-full rounded-2xl border-2 border-amber-200 bg-amber-50 p-6">
      <h3 className="text-2xl font-bold text-slate-800">🤔 我需要再了解一下</h3>
      <p className="mt-2 text-lg text-slate-600">
        您说「<b className="text-slate-800">{requirement}</b>」，这有点笼统。
        请选一个您想要的操作，我马上帮您办：
      </p>

      <div className="mt-4 flex flex-col gap-3">
        {questions.map((q, qi) => {
          const activeOptions = q.options.filter(
            (o): o is ClarifyOption & { task: Task } => !!o.task
          );
          return (
            <div
              key={qi}
              className="rounded-xl border border-amber-300 bg-white p-4"
            >
              <p className="text-xl font-semibold text-slate-800">{q.question}</p>
              {activeOptions.length > 0 ? (
                <div className="mt-3 flex flex-wrap gap-2">
                  {activeOptions.map((o, oi) => (
                    <button
                      key={oi}
                      type="button"
                      onClick={() => onPickOption(o.task)}
                      className="rounded-full bg-amber-500 px-4 py-2 text-lg text-white transition-colors hover:bg-amber-600"
                    >
                      {o.label}
                    </button>
                  ))}
                </div>
              ) : (
                <p className="mt-2 text-lg text-slate-500">
                  请点击下方「重新描述」，用更具体的话告诉我。
                </p>
              )}
            </div>
          );
        })}
      </div>

      <div className="mt-5 flex flex-col gap-3 sm:flex-row">
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

export default memo(ClarifyPanel);
