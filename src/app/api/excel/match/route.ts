/**
 * @file route.ts (/api/excel/match)
 * @description 字段智能匹配接口（V0.3 新增）。
 * 接收 { file, task }，读取源文件表头，用 fieldMatcher 计算每个逻辑字段与
 * 真实表头的置信度与候选：
 *   - needConfirm=false：所有字段高置信，可自动映射直接执行。
 *   - needConfirm=true ：存在中/低置信字段，前端据此展示「字段确认」候选页，
 *                        用户选择后带 fieldMap 调用 /api/excel 执行。
 * 本接口只做「匹配」，不修改任何 Excel 内容。
 */
import { excelEngine } from "@/services/excel/processor";
import { matchFields, extractTaskFields } from "@/services/ai/fieldMatcher";
import type { ExcelFile, Task } from "@/types/task";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { file: ExcelFile; task: Task };

    if (!body?.file?.fileId || !body?.task?.operation) {
      return Response.json({ ok: false, error: "参数不完整。" }, { status: 400 });
    }

    // 读取源表头（仅读取，不修改文件）
    const headers = await excelEngine.readHeaders(body.file);

    // 提取 Task 需要的逻辑字段，做智能匹配
    const fields = extractTaskFields(body.task.groupBy, body.task.calculations);
    const match = matchFields(fields, headers);

    return Response.json({ ok: true, headers, match });
  } catch (e) {
    const message = e instanceof Error ? e.message : "字段匹配失败。";
    return Response.json({ ok: false, error: message }, { status: 500 });
  }
}
