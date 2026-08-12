/**
 * @file task.ts
 * @description 系统核心类型定义 —— 三个 Agent（需求理解 / Excel执行 / 结果审查）
 *              之间传递的结构化任务契约（V0.2 协议）。
 *
 * 协作流程：
 *   需求理解Agent  ->  Task（结构化任务JSON）
 *   Excel执行Agent ->  解析 Task 并调用 processor 执行（程序计算，AI 不直接改表）
 *   结果审查Agent  ->  基于 Task + 处理前后摘要做程序化校验
 */

/** 支持的任务操作类型（本阶段支持 group_sum / sum，其余为预留） */
export type Operation = "group_sum" | "sum" | "unknown";

/** 计算方式（本阶段仅支持求和） */
export type CalculationMethod = "sum";

/** 一项计算：对某列执行某方法 */
export interface Calculation {
  /** 参与计算的列名 */
  column: string;
  /** 计算方法 */
  method: CalculationMethod;
}

/**
 * 需求理解Agent 输出的结构化任务。
 * 示例：
 * {
 *   operation: "group_sum",
 *   groupBy: ["商品名称"],
 *   calculations: [
 *     { column: "采购数量", method: "sum" },
 *     { column: "采购金额", method: "sum" }
 *   ],
 *   keepHeader: true
 * }
 */
export interface Task {
  /** 操作类型 */
  operation: Operation;
  /** 分组依据的列名列表（group_sum 需要） */
  groupBy: string[];
  /** 需要参与计算的列列表 */
  calculations: Calculation[];
  /** 是否保留原表头 */
  keepHeader: boolean;
  /** 操作对应的工作表名称，缺省则取第一个工作表 */
  sheetName?: string;
  /** 额外参数，后续扩展 */
  options?: Record<string, unknown>;
}

/** 单个 Excel 文件的最基本信息 */
export interface ExcelFile {
  /** 上传后生成的文件标识，用于从服务端临时存储中找回文件 */
  fileId: string;
  /** 原始文件名 */
  fileName: string;
  /** 文件大小（字节） */
  size: number;
  /** MIME 类型 */
  mimeType: string;
}

/** Excel执行Agent 的处理请求 */
export interface ProcessRequest {
  file: ExcelFile;
  task: Task;
  /**
   * 可选的「逻辑列名 -> 真实列名」映射（由字段智能匹配/前端确认产生，V0.3）。
   * 缺省时按原样在表头中查找；提供后先替换再执行，增强对字段名变化的容错。
   */
  fieldMap?: Record<string, string>;
}

/**
 * 处理摘要：用于结果审查Agent 对比"处理前/处理后"。
 * 由上传阶段（处理前）与 Excel 引擎（处理后）分别产出。
 */
export interface ProcessSummary {
  /** 列名（表头）列表 */
  headers: string[];
  /** 数据行数（不含表头） */
  rowCount: number;
  /** 金额合计（用于一致性校验；无金额时为 0） */
  totalAmount: number;
  /**
   * 源文件元信息（V0.3）：记录被处理的原始文件，便于审查/审计。
   * 仅处理前摘要（preview）携带，处理后摘要可缺省。
   */
  sourceMetadata?: {
    /** 原始文件名 */
    fileName?: string;
    /** 文件大小（字节） */
    size?: number;
    /** MIME 类型 */
    mimeType?: string;
    /** 处理方式说明，如 "node/exceljs" */
    engine?: string;
  };
}

/** Excel执行Agent 处理成功后的结果 */
export interface ProcessResult {
  /** 处理结果文件的下载标识 */
  resultFileId: string;
  /** 处理后摘要（供审查） */
  summary: ProcessSummary;
  /** 处理耗时（毫秒） */
  durationMs: number;
  /** 简要说明 */
  message: string;
}

/** 单项检查结论 */
export interface VerificationCheck {
  /** 检查项名称，如 "金额校验" / "表头检查" */
  name: string;
  /** 结果文案："通过" / "警告" / "未完成" 等 */
  result: string;
  /** 可选的补充说明 */
  detail?: string;
}

/** 结果审查Agent 的审查报告（程序规则为准） */
export interface VerificationSuite {
  /** 总体是否通过 */
  success: boolean;
  /** 逐项检查结果 */
  checks: VerificationCheck[];
  /**
   * 审查汇总文案（V0.3）：一句话说明总体结论，便于老人/非技术用户理解。
   */
  summary?: string;
  /**
   * 更细粒度的说明列表（V0.3）：可包含比 checks 更具体的证据/建议，
   * 前端可在"详情"折叠中展示。
   */
  details?: string[];
}
