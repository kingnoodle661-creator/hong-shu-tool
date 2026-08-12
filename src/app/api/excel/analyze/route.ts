/**
 * @file route.ts (/api/excel/analyze)
 * @description Excel 表分析 Agent 接口（V0.5-A 新增）。
 * 接收 { file }，只读分析整个文件：表头 / 行数 / 样例数据 / 表类型识别 /
 * 推荐操作。规则优先，规则无法确定时调 DeepSeek 兜底（兜底失败静默降级为通用表）。
 * 本接口只做「分析」，绝不修改任何 Excel 内容。
 */
import { excelEngine } from "@/services/excel/processor";
import type { ExcelFile } from "@/types/task";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { file: ExcelFile };

    if (!body?.file?.fileId) {
      return Response.json({ ok: false, error: "参数不完整。" }, { status: 400 });
    }

    const analysis = await excelEngine.analyze(body.file);

    return Response.json({ ok: true, analysis });
  } catch (e) {
    const message = e instanceof Error ? e.message : "表格分析失败。";
    return Response.json({ ok: false, error: message }, { status: 500 });
  }
}
