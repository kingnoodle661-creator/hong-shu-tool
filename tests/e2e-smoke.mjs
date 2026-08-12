/**
 * @file e2e-smoke.mjs
 * @description V0.3 端到端冒烟测试（需 dev server 运行于 :3100）。
 * 用真实 DeepSeek + 真实 exceljs 走完整闭环：
 *   上传(表头与常见表达略不同，触发字段确认) -> /api/ai -> /api/excel/match
 *   -> /api/excel(带 fieldMap) -> /api/verify
 * 打印各阶段 HTTP 状态与关键结果；任一失败以非 0 退出。
 */
import ExcelJS from "exceljs";

const BASE = "http://localhost:3100";
const FILE_NAME = "烟测采购表.xlsx";
const REQUIREMENT = "按品名汇总采购金额是多少";

// 表头故意用「品名」「金额(元)」，与自然表达「商品名称/采购金额」略不同
async function buildWorkbook() {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("采购表");
  ws.addRow(["品名", "数量", "金额(元)"]);
  ws.addRow(["苹果", 50, "￥500"]);
  ws.addRow(["香蕉", 30, "300 元"]);
  ws.addRow(["苹果", 60, "1,100"]);
  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}

function ok(o) { return o.ok === true && o.error === undefined; }

let failures = 0;
// 1) 上传
const xlsx = await buildWorkbook();
const fd = new FormData();
fd.append("file", new Blob([xlsx], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), FILE_NAME);
const upRes = await fetch(`${BASE}/api/upload`, { method: "POST", body: fd });
const upBody = await upRes.json();
const file = upBody.file;
console.log(`[上传] ${upRes.status} fileId=${file.fileId}`);
if (upRes.status !== 200 || !ok(upBody)) { console.error("上传失败", upBody); process.exit(1); }

// 2) 需求理解
const aiRes = await fetch(`${BASE}/api/ai`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ requirement: REQUIREMENT, fileId: file.fileId }) });
const aiBody = await aiRes.json();
console.log(`[AI] ${aiRes.status} task=${JSON.stringify(aiBody.task)}`);
if (aiRes.status !== 200 || !ok(aiBody)) { console.error("AI 失败", aiBody); process.exit(1); }
const task = aiBody.task;

// 3) 字段匹配
const mRes = await fetch(`${BASE}/api/excel/match`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ file, task }) });
const mBody = await mRes.json();
console.log(`[匹配] ${mRes.status} needConfirm=${mBody.match?.needConfirm} mapping=${JSON.stringify(mBody.match?.mapping)}`);
if (mRes.status !== 200 || !ok(mBody)) { console.error("匹配失败", mBody); process.exit(1); }
const match = mBody.match;

// 构造 fieldMap：优先用自动映射；若需确认，模拟用户选择候选首项并确认
const fieldMap = {};
for (const fm of match.matches) {
  if (fm.matchedTo) fieldMap[fm.field] = fm.matchedTo;
  else if (fm.candidates[0]) fieldMap[fm.field] = fm.candidates[0].header;
}
if (match.needConfirm) {
  console.log(`[确认] 需人工确认，自动选择首候选 ${JSON.stringify(fieldMap)}`);
}

// 4) 执行（带 fieldMap）
const exRes = await fetch(`${BASE}/api/excel`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ file, task, fieldMap }) });
const exBody = await exRes.json();
console.log(`[执行] ${exRes.status} 结果行=${exBody.outcome?.result?.rowCount} 金额=${exBody.outcome?.result?.totalAmount} message=${exBody.outcome?.message}`);
if (exRes.status !== 200 || !ok(exBody)) { console.error("执行失败", exBody); process.exit(1); }
const outcome = exBody.outcome;

// 5) 审查
const vfRes = await fetch(`${BASE}/api/verify`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ requirement: REQUIREMENT, preview: outcome.preview, result: outcome.result, task }) });
const vfBody = await vfRes.json();
console.log(`[审查] ${vfRes.status} success=${vfBody.verification?.success} summary=${vfBody.verification?.summary} checks=${vfBody.verification?.checks?.length}`);
if (vfRes.status !== 200 || !ok(vfBody)) { console.error("审查失败", vfBody); process.exit(1); }

// 6) 下载验证
const dRes = await fetch(`${BASE}/api/excel/download?fileId=${encodeURIComponent(outcome.resultFileId)}`);
const dBuf = Buffer.from(await dRes.arrayBuffer());
console.log(`[下载] ${dRes.status} 字节=${dBuf.length}`);
if (dRes.status !== 200 || dBuf.length < 1000) { console.error("下载失败"); failures++; }

// 校验关键业务结论：金额应 = 500 + 300 + 1100 = 1900
const expectedAmount = 1900;
if (Math.abs(outcome.result.totalAmount - expectedAmount) > 1e-6) {
  console.error(`金额不符：期望 ${expectedAmount}，实际 ${outcome.result.totalAmount}`);
  failures++;
} else {
  console.log(`[验算] 金额 ${outcome.result.totalAmount} == 期望 ${expectedAmount} ✔`);
}

console.log(failures === 0 ? "\nE2E 冒烟：全部通过 ✔" : `\nE2E 冒烟：${failures} 项失败 ✘`);
process.exit(failures === 0 ? 0 : 1);
