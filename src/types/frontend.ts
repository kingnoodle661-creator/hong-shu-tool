/**
 * @file frontend.ts
 * @description 前端展示层使用的复合类型，供页面对接 API 流水线结果。
 */
import type {
  ProcessSummary,
  Task,
  VerificationSuite,
} from "./task";
import type { FieldMatchResult } from "./fieldMatch";

/** 一条完整处理流水线的前端视图 */
export interface PipelineResult {
  ok: true;
  /** 需求理解 Agent 产出的结构化任务（可作调试/展示） */
  task: Task;
  /** 处理结果文件的下载标识 */
  resultFileId: string;
  /** 处理简要说明 */
  message: string;
  /** 处理前摘要 */
  preview: ProcessSummary;
  /** 处理后摘要 */
  result: ProcessSummary;
  /** 结果审查报告 */
  verification: VerificationSuite;
}

/** 字段匹配待确认状态：AI 已理解，需要用户对中/低置信字段拍板 */
export interface ConfirmInfo {
  /** 真实表头 */
  headers: string[];
  /** 字段智能匹配结果（含候选/置信度） */
  match: FieldMatchResult;
  /** 用户已做出的选择：逻辑列名 -> 真实列名 */
  selections: Record<string, string>;
}

/**
 * 前端处理阶段状态机（V0.3 五步骤 + V0.5-A 表分析阶段）。
 * 可见步骤：①已上传/表分析 ②已理解 ③字段确认 ④处理中 ⑤检查中 ⑥完成
 */
export type ProcessStage =
  | "idle"
  | "uploaded"
  | "analyzing_file"
  | "analyzing"
  | "confirming"
  | "processing"
  | "checking"
  | "done"
  | "error";

/** 阶段 -> 展示文案 */
export const STAGE_LABEL: Record<ProcessStage, string> = {
  idle: "",
  uploaded: "已上传文件",
  analyzing_file: "正在分析表格…",
  analyzing: "正在分析需求…",
  confirming: "请确认表格字段",
  processing: "正在处理 Excel…",
  checking: "正在检查结果…",
  done: "处理完成",
  error: "处理出错",
};

/** 五步骤可视列表（供顶部进度条渲染） */
export const STEP_LIST: { key: string; label: string }[] = [
  { key: "uploaded", label: "上传" },
  { key: "analyzing", label: "理解" },
  { key: "confirming", label: "确认" },
  { key: "processing", label: "处理" },
  { key: "checking", label: "检查" },
];
