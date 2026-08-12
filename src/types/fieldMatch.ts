/**
 * @file fieldMatch.ts
 * @description 字段智能匹配的类型定义（V0.3）。
 *
 * 用于「需求理解出 Task 里的逻辑列名」与「Excel 真实表头」之间建立映射。
 * 匹配分三个置信层级：
 *   - high   直接命中 / 高度相似，可自动完成映射，无需用户确认。
 *   - medium 存在多个候选 / 中文名不完全一致，需用户确认。
 *   - low    未找到可靠候选，进入候选选择页（可让用户手动指定）。
 */

/** 置信度等级 */
export type FieldConfidence = "high" | "medium" | "low";

/** 一个候选真实列名 + 其相似度得分（0~1） */
export interface FieldCandidate {
  /** Excel 真实表头名 */
  header: string;
  /** 相似度得分（0~1），用于排序展示 */
  score: number;
}

/** 某一字段（Task 逻辑列）的匹配结果 */
export interface FieldMatch {
  /** Task 中使用的逻辑列名 */
  field: string;
  /** 匹配到的真实表头名；未匹配时为 undefined（需用户选择） */
  matchedTo?: string;
  /** 按得分降序的候选真实列名 */
  candidates: FieldCandidate[];
  /** 置信度 */
  confidence: FieldConfidence;
  /** 是否已由用户确认（或高置信自动确认） */
  confirmed: boolean;
}

/** 一次字段匹配的完整结果 */
export interface FieldMatchResult {
  /**
   * 是否需要用户确认：
   * - false：所有字段均为 high 置信，可自动完成映射直接执行。
   * - true ：存在 medium/low 字段，前端应展示候选并收集用户选择。
   */
  needConfirm: boolean;
  /** 各字段的匹配详情 */
  matches: FieldMatch[];
  /**
   * 可直接使用的「逻辑列名 -> 真实列名」映射对象。
   * 仅在 !needConfirm（或用户确认后）时可安全用作执行时替换。
   */
  mapping: Record<string, string>;
}

/** 用户对某未知字段手工指定的映射 */
export interface FieldConfirmEntry {
  /** Task 逻辑列名 */
  field: string;
  /** 用户选择的真实表头名；传空表示「该列不需要」 */
  matchedTo: string;
}
