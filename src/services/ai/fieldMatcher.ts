/**
 * @file fieldMatcher.ts
 * @description 字段智能匹配（V0.3）。
 *
 * 职责：把 Task 里的「逻辑列名」（AI 从自然语言中提取，可能不精确）与
 *       Excel 真实表头对齐。用置信度分级，避免「找不到字段就报错」的笨重体验：
 *       - 高置信：自动匹配（如 AI 直接引用真实表头、或别名清晰命中）。
 *       - 中 / 低置信：返回候选列表，交给前端确认页，由用户拍板。
 * 纯确定性规则，不依赖 AI，保证可复现、可测试。
 */
import type {
  FieldCandidate,
  FieldConfidence,
  FieldMatch,
  FieldMatchResult,
} from "@/types/fieldMatch";

/** 相似度阈值：达到或超过即视为「高置信，可自动映射」 */
const HIGH_CONFIDENCE = 0.86;
/** 低于该阈值视为「弱候选」，仅在无更好候选时兜底 */
const LOW_FLOOR = 0.4;

/**
 * 归一化文本，用于比对：去空白、常见全角/半角统一、统一小写。
 */
function normalize(s: string): string {
  return s
    .replace(/[\s　·．・，,]+/g, "")
    .replace(/[（(]/g, "(")
    .replace(/[）)]/g, ")")
    .toLowerCase();
}

/**
 * 计算两个字符串的相似度（0~1）。
 * 组合三种信号，取最大值，提升中文表头匹配的稳健性：
 *   - 编辑距离相似度（Levenshtein）。
 *   - 子串包含关系（一方完全包含另一方）。
 *   - 关键词命中（可数名词 / 量词等，见下方句法规则）。
 */
function similarity(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;

  const na = normalize(a);
  const nb = normalize(b);
  if (na === nb) return 1;

  let best = editSimilarity(na, nb);

  // 子串包含：如 "采购金额" 与 "金额" 或 "金额(元)"
  if (na.includes(nb) || nb.includes(na)) {
    best = Math.max(best, 0.8);
  }

  // 关键词/别名信号：金额 / 数量 / 商品 / 名称 / 价格 / 单价
  const signal = keywordSignal(a, b);
  best = Math.max(best, signal);

  return Math.min(best, 1);
}

/** 关键词共现得分（0 / 0.5 / 0.75），用于中文财务表头的别名识别 */
function keywordSignal(a: string, b: string): number {
  const groups = [
    ["金额", "金额元", "总额", "款", "合计"],
    ["数量", "个数", "件数", "量"],
    ["商品", "品名", "产品", "物品", "货物", "货品"],
    ["名称", "名字", "姓名"],
    ["价格", "单价", "售价", "卖价"],
    ["日期", "时间", "年月日", "日期"],
    ["类型", "种类", "类别", "分类"],
    ["供应商", "供货商", "商家", "客户"],
  ];
  const hit = (s: string): number[] =>
    groups.map((g) => (g.some((k) => normalize(s).includes(normalize(k))) ? 1 : 0));

  const va = hit(a);
  const vb = hit(b);
  const matched = va.reduce((acc, v, i) => acc + (v === 1 && vb[i] === 1 ? 1 : 0), 0);
  if (matched === 0) return 0;
  // 命中同一组关键词 => 0.75；重叠超过一半组 => 更高
  return matched >= 2 ? 0.9 : 0.75;
}

/** 编辑距离相似度：1 - Levenshtein(a,b) / max(len) */
function editSimilarity(a: string, b: string): number {
  const la = a.length;
  const lb = b.length;
  if (la === 0 || lb === 0) return 0;
  let prev = Array.from({ length: lb + 1 }, (_, j) => j);
  for (let i = 1; i <= la; i++) {
    const cur = [i];
    for (let j = 1; j <= lb; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(cur[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    prev = cur;
  }
  return 1 - prev[lb] / Math.max(la, lb);
}

/** 解析 Task 需求到的所有逻辑字段（即分组列 + 计算列） */
export function extractTaskFields(
  groupBy: string[],
  calculations: { column: string }[]
): string[] {
  const fields = [...groupBy, ...calculations.map((c) => c.column)];
  return [...new Set(fields.filter(Boolean))];
}

/**
 * 对单个逻辑字段，在真实表头列表中计算候选并按得分降序。
 * @param field 逻辑字段名（Task 里的表达）
 * @param headers 真实表头
 * @returns 按得分降序的候选（含得分）
 */
export function candidatesForField(field: string, headers: string[]): FieldCandidate[] {
  const scored = headers
    .map((h) => ({ header: h, score: similarity(field, h) }))
    .filter((c) => c.score >= LOW_FLOOR)
    .sort((x, y) => y.score - x.score);
  // 仅保留前 3 名，降低确认页复杂度
  return scored.slice(0, 3);
}

/**
 * 为逻辑字段判定置信度与默认命中项。
 * 规则（确定性，可测试）：
 *   - 命中得分 >= 阈值且为最高候选人 => high，自动映射该候选。
 *   - 命中得分中等（有候选但不够高，或无唯一最优）=> medium，需用户确认。
 *   - 没有任何候选 => low，需用户手动选择。
 */
function classify(field: string, candidates: FieldCandidate[]): {
  confidence: FieldConfidence;
  matchedTo?: string;
} {
  if (candidates.length === 0) return { confidence: "low" };

  const top = candidates[0];
  if (top.score >= HIGH_CONFIDENCE) {
    // 极高命中且明显领先时，可直接采用唯一最优
    const second = candidates[1];
    if (!second || top.score - second.score >= 0.05) {
      return { confidence: "high", matchedTo: top.header };
    }
    return { confidence: "medium", matchedTo: top.header };
  }
  if (top.score >= 0.5) {
    return { confidence: "medium", matchedTo: top.header };
  }
  return { confidence: "low" };
}

/**
 * 对一组逻辑字段做整体匹配。
 * @param logicFields Task 需要的逻辑字段（分组 + 计算）
 * @param realHeaders Excel 真实表头
 */
export function matchFields(logicFields: string[], realHeaders: string[]): FieldMatchResult {
  const matches: FieldMatch[] = logicFields.map((field) => {
    const candidates = candidatesForField(field, realHeaders);
    const { confidence, matchedTo } = classify(field, candidates);
    return {
      field,
      matchedTo,
      candidates,
      confidence,
      confirmed: confidence === "high",
    };
  });

  const needConfirm = matches.some((m) => m.confidence !== "high" || !m.matchedTo);

  const mapping: Record<string, string> = {};
  for (const m of matches) {
    if (m.confirmed && m.matchedTo) mapping[m.field] = m.matchedTo;
  }

  return { needConfirm, matches, mapping };
}

/**
 * 合并用户确认结果：把用户的选择并入原始匹配，产出最终可用映射。
 * 用户对某字段可给出手工命中（matchedTo），或表示「忽略该字段」（空串）。
 */
export function applyConfirmedMatches(
  result: FieldMatchResult,
  confirmations: Record<string, { matchedTo: string; ignore?: boolean }>
): Record<string, string> {
  const map = { ...result.mapping };
  for (const m of result.matches) {
    const sel = confirmations[m.field];
    if (!sel) continue;
    if (sel.ignore) {
      // 用户要求忽略：不参与映射（执行时该字段将被排除）
      delete map[m.field];
      continue;
    }
    if (sel.matchedTo) {
      map[m.field] = sel.matchedTo;
    }
  }
  return map;
}
