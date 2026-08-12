"use client";

/**
 * @file TaskInput.tsx
 * @description 处理需求输入组件（面向中老年：大输入框、大字、大按钮）。
 * 收集用户的一句话需求，点击「开始处理」后通过 onSubmit 交给父组件。
 * 处理中由父组件传入当前阶段提示（正在分析需求 / 正在处理Excel / 正在检查结果）。
 */
import { memo, useCallback, useState } from "react";

interface TaskInputProps {
  /** 是否已在上方完成文件上传（未上传时禁用处理按钮） */
  canProcess: boolean;
  /** 是否正在处理（禁用提交并显示阶段文案） */
  processing: boolean;
  /** 当前处理阶段提示文案 */
  stageLabel: string;
  /** 用户点击「开始处理」并提交需求 */
  onSubmit: (requirement: string) => void;
}

/** 示例需求，帮助用户了解怎么描述 */
const EXAMPLES = [
  "按商品名称汇总相同产品，分别计算采购数量、采购金额的合计数，保持原表头不变",
  "把采购数量这一列求和",
];

function TaskInput({ canProcess, processing, stageLabel, onSubmit }: TaskInputProps) {
  const [requirement, setRequirement] = useState("");

  const handleSubmit = useCallback(() => {
    if (!canProcess || processing) return;
    const text = requirement.trim();
    if (!text) return;
    onSubmit(text);
  }, [canProcess, processing, requirement, onSubmit]);

  return (
    <div className="flex w-full flex-col gap-4">
      <label
        htmlFor="requirement"
        className="text-2xl font-semibold text-slate-800"
      >
        请描述您要做什么
      </label>
      <textarea
        id="requirement"
        value={requirement}
        onChange={(e) => setRequirement(e.target.value)}
        rows={4}
        placeholder="例如：按商品名称汇总采购数量和金额"
        className="w-full resize-none rounded-2xl border-2 border-slate-300 bg-white p-4 text-2xl leading-relaxed text-slate-800 placeholder:text-slate-400 focus:border-blue-500 focus:outline-none"
      />
      <div className="flex flex-col gap-2">
        {EXAMPLES.map((ex) => (
          <button
            key={ex}
            type="button"
            onClick={() => setRequirement(ex)}
            className="self-start rounded-full bg-slate-100 px-4 py-2 text-left text-lg text-slate-600 hover:bg-slate-200"
          >
            💡 {ex}
          </button>
        ))}
      </div>

      <button
        type="button"
        onClick={handleSubmit}
        disabled={!canProcess || processing}
        className="mt-2 w-full rounded-2xl bg-blue-600 px-6 py-5 text-2xl font-bold text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-blue-400"
      >
        {processing ? stageLabel || "正在处理…" : "开始处理"}
      </button>

      {!canProcess && !processing && (
        <p className="text-lg text-slate-500">请先上传 Excel 文件</p>
      )}
      {processing && (
        <p className="text-xl text-blue-600" role="status">
          {stageLabel || "正在处理…"}
        </p>
      )}
    </div>
  );
}

export default memo(TaskInput);
