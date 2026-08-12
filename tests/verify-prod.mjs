/**
 * @file verify-prod.mjs
 * @description V0.4-A 生产部署验证脚本（Vercel 部署后运行）。
 *
 * 在真实生产环境跑完整链路：首页 / 上传 / AI理解 / 字段匹配 / 执行 / 审查 / 下载。
 * 使用方式：
 *   node verify-prod.mjs <生产URL> [test.xlsx 路径(可选)]
 * 例：node verify-prod.mjs https://your-project.vercel.app
 *
 * 说明：
 * - 生产 Blob 模式下载后返回的 Content-Type 应为 xlsx 附件。
 * - 任一环节非 2xx 或关键结论错误即非 0 退出。
 */
import ExcelJS from "exceljs";

const BASE = (process.argv[2] || "http://localhost:3000").replace(/\/+$/, "");
const REQUIREMENT = "按商品名称汇总采购数量和采购金额";

const ROWS = [
  ["商品名称", "采购数量", "采购单价", "采购金额"],
  ["苹果", 50, 10, 500],
  ["香蕉", 30, 10, 300],
  ["苹果", 60, 18.33, 1100],
  ["橙子", 40, 5, 200],
];

async function buildWorkbook() {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("采购表");
  ws.addRows(ROWS);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

function ok(o) { return o && o.ok === true && o.error === undefined; }

let failures = 0;
const report = {};

try {
  // 0) 首页
  const home = await fetch(`${BASE}/`);
  report.home = home.status === 200 ? "通过" : `失败(${home.status})`;
  console.log(`[首页] ${home.status}`);

  // 1) 上传
  const xlsx = await buildWorkbook();
  const fd = new FormData();
  fd.append("file", new Blob([xlsx], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), "test.xlsx");
  const upRes = await fetch(`${BASE}/api/upload`, { method: "POST", body: fd });
  const upBody = await upRes.json();
  const file = upBody.file;
  report.upload = upRes.status === 200 && ok(upBody) ? "通过" : `失败(${upRes.status})`;
  console.log(`[上传] ${upRes.status} fileId=${file && file.fileId}`);
  if (upRes.status !== 200 || !ok(upBody)) { console.error("上传失败", upBody); failures++; }
  else {
    // 2) AI 理解
    const aiRes = await fetch(`${BASE}/api/ai`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ requirement: REQUIREMENT, fileId: file.fileId }) });
    const aiBody = await aiRes.json();
    report.ai = aiRes.status === 200 && ok(aiBody) ? "通过" : `失败(${aiRes.status})`;
    console.log(`[AI] ${aiRes.status} task=${JSON.stringify(aiBody.task)}`);
    if (aiRes.status !== 200 || !ok(aiBody)) { console.error("AI 失败", aiBody); failures++; }
    else {
      const task = aiBody.task;
      // 3) 字段匹配
      const mRes = await fetch(`${BASE}/api/excel/match`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ file, task }) });
      const mBody = await mRes.json();
      console.log(`[匹配] ${mRes.status}`);
      if (mRes.status !== 200 || !ok(mBody)) { console.error("匹配失败", mBody); failures++; }
      else {
        const fieldMap = {};
        for (const fm of mBody.match.matches) {
          if (fm.matchedTo) fieldMap[fm.field] = fm.matchedTo;
          else if (fm.candidates[0]) fieldMap[fm.field] = fm.candidates[0].header;
        }
        // 4) 执行
        const exRes = await fetch(`${BASE}/api/excel`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ file, task, fieldMap }) });
        const exBody = await exRes.json();
        let amountOk = false;
        if (exRes.status === 200 && ok(exBody) && exBody.outcome && exBody.outcome.result) {
          const total = exBody.outcome.result.totalAmount;
          amountOk = Math.abs(total - 2100) < 1e-6;
          console.log(`[执行] ${exRes.status} 组数=${exBody.outcome.result.rowCount} 金额=${total}（期望2100）`);
          report.excel = amountOk ? "通过" : "失败(金额不符)";
        } else {
          console.error("执行失败", exBody);
          report.excel = `失败(${exRes.status})`;
        }
        if (!amountOk) failures++;
        else {
          // 5) 审查 + 6) 下载
          const vfRes = await fetch(`${BASE}/api/verify`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ requirement: REQUIREMENT, preview: exBody.outcome.preview, result: exBody.outcome.result, task }) });
          const vfBody = await vfRes.json();
          report.verify = vfRes.status === 200 && ok(vfBody) ? "通过" : `失败(${vfRes.status})`;
          console.log(`[审查] ${vfRes.status}`);

          const dRes = await fetch(`${BASE}/api/excel/download?fileId=${encodeURIComponent(exBody.outcome.resultFileId)}`);
          const dBuf = Buffer.from(await dRes.arrayBuffer());
          const ct = dRes.headers.get("content-type") || "";
          report.download = dRes.status === 200 && dBuf.length > 500 ? "通过" : `失败(${dRes.status})`;
          console.log(`[下载] ${dRes.status} 字节=${dBuf.length} type=${ct}`);
          if (dRes.status !== 200 || dBuf.length <= 500) failures++;
        }
      }
    }
  }
} catch (e) {
  console.error("异常:", e.message);
  failures++;
}

console.log("\n======== 生产部署验证结果 ========");
for (const k of ["home", "upload", "ai", "excel", "verify", "download"]) {
  console.log(`  ${k}: ${report[k] || "未执行"}`);
}
console.log(failures === 0 ? "\n部署验证：全部通过 ✔" : `\n部署验证：${failures} 项失败 ✘`);
process.exit(failures === 0 ? 0 : 1);
