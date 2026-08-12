/**
 * @file e2e-fieldmap.mjs
 * @description V0.3 字段映射确认路径端到端测试。
 * 构造一个「逻辑列名与真实表头不一致」的任务，走：
 *   /api/excel/match 得到候选 -> 模拟用户确认 -> /api/excel 带 fieldMap 执行，
 * 验证即使 AI 表达与表头不同，映射后仍能正确分组求和。
 */
import ExcelJS from "exceljs";
const BASE = "http://localhost:3100";

async function buildWorkbook() {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("数据");
  ws.addRow(["货物名", "数量", "合计", "备注"]);
  ws.addRow(["苹果", 5, "￥50", "x"]);
  ws.addRow(["梨", 3, "30 元", ""]);
  ws.addRow(["苹果", 2, "20", "z"]);
  return Buffer.from(await wb.xlsx.writeBuffer());
}
const j = (o) => ({ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(o) });
let failures = 0;

// 上传
const fd = new FormData();
fd.append("file", new Blob([await buildWorkbook()], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), "字段映射表.xlsx");
const upRes = await fetch(`${BASE}/api/upload`, { method: "POST", body: fd });
const file = (await upRes.json()).file;
console.log(`[上传] ${upRes.status}`);
if (upRes.status !== 200 || !file?.fileId) process.exit(1);

// 直接用逻辑列名（与真实表头不同）构造任务 -> 应触发需确认
const task = { operation: "group_sum", groupBy: ["商品名称"], calculations: [{ column: "采购金额", method: "sum" }], keepHeader: true };

// 匹配
const mRes = await fetch(`${BASE}/api/excel/match`, j({ file, task }));
const mBody = await mRes.json();
console.log(`[匹配] ${mRes.status} needConfirm=${mBody.match?.needConfirm} 候选=${JSON.stringify(mBody.match?.matches?.map((m) => ({ f: m.field, c: m.candidates })))}`);
if (mRes.status !== 200 || !mBody.ok) { console.error(mBody); process.exit(1); }
if (!mBody.match.needConfirm) {
  console.log("【警告】未触发需确认（说明自动匹配已到位）");
}

// 模拟用户确认：为每个字段选候选首项
const fieldMap = {};
for (const fm of mBody.match.matches) fieldMap[fm.field] = fm.candidates[0]?.header;
if (!fieldMap["商品名称"] || !fieldMap["采购金额"]) { console.error("未能获得候选", mBody.match); process.exit(1); }
console.log(`[确认] fieldMap=${JSON.stringify(fieldMap)}`);

// 执行
const exRes = await fetch(`${BASE}/api/excel`, j({ file, task, fieldMap }));
const exBody = await exRes.json();
console.log(`[执行] ${exRes.status} 金额=${exBody.outcome?.result?.totalAmount} 消息=${exBody.outcome?.message}`);
if (exRes.status !== 200 || !exBody.ok) { console.error("执行失败", exBody); process.exit(1); }

// 期望：苹果(50+20=70) + 梨(30) = 100
const expected = 100;
if (Math.abs(exBody.outcome.result.totalAmount - expected) > 1e-6) {
  console.error(`金额不符：期望 ${expected}，实际 ${exBody.outcome.result.totalAmount}`);
  failures++;
} else {
  console.log(`[验算] 金额 ${exBody.outcome.result.totalAmount} == 期望 ${expected} ✔`);
}

// 反向：不提供 fieldMap 且字段确实缺失 -> /api/excel 应给出带候选的错误提示(400)
const badTask = { ...task, groupBy: ["根本不存在的列"], calculations: [{ column: "采购金额", method: "sum" }] };
const badRes = await fetch(`${BASE}/api/excel`, j({ file, task: badTask }));
const badBody = await badRes.json();
console.log(`[缺字段提示] ${badRes.status} 错误=${badBody.error}`);
if (badRes.status !== 400 || !/未找到/.test(badBody.error || "")) { console.error("缺字段未给出友好提示", badBody); failures++; }

console.log(failures === 0 ? "\n字段映射 E2E：全部通过 ✔" : `\n字段映射 E2E：${failures} 项失败 ✘`);
process.exit(failures === 0 ? 0 : 1);
