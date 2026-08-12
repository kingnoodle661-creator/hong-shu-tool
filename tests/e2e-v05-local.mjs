/* V0.5-A 本地端到端验证脚本：针对 http://localhost:PORT 的生成环境 (next start)。
 * 覆盖：上传 -> 表分析 -> 需求理解(模糊->need_confirm；具体->ready) -> 去重执行 -> 下载。
 * 需要本地 .env.local 提供真实 DEEPSEEK_API_KEY（AI 环节）。
 */
const B = process.env.BASE || "http://localhost:3200";

function log(...a) { console.log(...a); }

async function uploadXlsx() {
  const { default: ExcelJS } = await import("exceljs");
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("采购");
  ws.addRow(["商品名称", "采购数量", "采购金额"]);
  ws.addRow(["苹果", 50, 500]);
  ws.addRow(["苹果", 50, "500"]); // 完全重复行
  ws.addRow(["香蕉", 30, 300]);
  const buf = Buffer.from(await wb.xlsx.writeBuffer());
  const fd = new FormData();
  fd.append("file", new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), "测试表.xlsx");
  const up = await fetch(B + "/api/upload", { method: "POST", body: fd });
  const ub = await up.json();
  return { status: up.status, body: ub };
}

async function main() {
  log("BASE", B);
  // 1) 上传
  const { status: upStatus, body: ub } = await uploadXlsx();
  log("[upload]", upStatus, JSON.stringify(ub.ok ? "ok" : ub.error));
  if (!ub.ok) return 1;
  const file = ub.file;

  // 2) 表分析
  const an = await fetch(B + "/api/excel/analyze", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ file }),
  });
  const anb = await an.json();
  log("[analyze]", an.status, anb.ok ? `type=${anb.analysis.tableTypeName} suggestions=${anb.analysis.suggestions.length}` : anb.error);
  if (!anb.ok) return 1;

  // 3) AI 需求理解（模糊 -> need_confirm，不报错）
  const ai = await fetch(B + "/api/ai", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ requirement: "把一样的合起来", fileId: file.fileId }),
  });
  const aib = await ai.json();
  log("[ai 模糊]", ai.status, JSON.stringify({ ok: aib.ok, status: aib.status, questions: aib.questions ? aib.questions.map(q => q.question) : [] }));
  if (!aib.ok) return 1;
  if (aib.status !== "need_confirm") {
    log("  注意: 模型判定为 ready（不满足模糊预期），仍继续");
  }

  // 4) AI 需求理解（具体 -> ready）
  const ai2 = await fetch(B + "/api/ai", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ requirement: "删除完全重复的行", fileId: file.fileId }),
  });
  const aib2 = await ai2.json();
  log("[ai 具体]", ai2.status, aib2.ok ? `status=${aib2.status} op=${aib2.task && aib2.task.operation}` : aib2.error);
  if (!aib2.ok) return 1;

  // 5) 去重执行（用 ready 的 task 或手工构造 distinct）
  const task = {
    operation: "distinct", groupBy: ["全部列"], calculations: [],
    keepHeader: true, sheetName: "", options: {},
  };
  const ex = await fetch(B + "/api/excel", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ file, task }),
  });
  const exb = await ex.json();
  log("[excel distinct]", ex.status, exb.ok ? `rows=${exb.outcome.result.rowCount} msg=${exb.outcome.message}` : exb.error);
  if (!exb.ok) return 1;

  // 6) 验证引擎（distinct 为非 sum 操作，应跳过金额校验）
  const vf = await fetch(B + "/api/verify", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ requirement: "删除完全重复的行", preview: exb.outcome.preview, result: exb.outcome.result, task }),
  });
  const vfb = await vf.json();
  log("[verify]", vf.status, vfb.ok ? `success=${vfb.verification.success} checks=${vfb.verification.checks.map(c=>c.name+':'+c.result).join(',')}` : vfb.error);
  if (!vfb.ok) return 1;

  // 7) 下载
  const dl = await fetch(B + "/api/excel/download?fileId=" + exb.outcome.resultFileId);
  const buf = Buffer.from(await dl.arrayBuffer());
  log("[download]", dl.status, `bytes=${buf.length} type=${dl.headers.get("content-type")}`);

  log("== V0.5-A 本地链路验证完成 ✅ ==");
  return 0;
}

main().then((c) => process.exit(c));
