/**
 * @file route.ts (/api/excel)
 * @description Excel 执行 Agent 接口（程序执行层）。
 * 接收 { file, task, fieldMap? }，交给 excelEngine.executeTask 执行真实的分组求和。
 * fieldMap 为可选的「逻辑列名 -> 真实列名」映射（来自字段智能匹配/前端确认，V0.3）。
 * 返回处理结果：resultFileId（结果文件）、preview（处理前摘要）、
 *               result（处理后摘要），供前端展示与结果审查使用。
 * 关键点：此处只调用「程序实现」（exceljs），AI 不在此直接修改 Excel。
 * 成功后写入一条操作日志（logger.ts，本地 JSON）。
 */
import { excelEngine } from "@/services/excel/processor";
import { writeOperationLog } from "@/services/log/logger";
import type { ExcelFile, Task } from "@/types/task";

interface ExcelRequestBody {
  file: ExcelFile;
  task: Task;
  fieldMap?: Record<string, string>;
}

export const runtime = "nodejs"; // exceljs 需要 Node 运行时

export async function POST(request: Request) {
  let body: ExcelRequestBody | undefined;
  try {
    body = (await request.json()) as ExcelRequestBody;

    if (!body?.file?.fileId || !body?.task?.operation) {
      return Response.json({ ok: false, error: "参数不完整。" }, { status: 400 });
    }

    // 调用程序引擎执行真实处理（分组求和），带可选字段映射
    const outcome = await excelEngine.executeTask({
      file: body.file,
      task: body.task,
      fieldMap: body.fieldMap || undefined,
    });

    // 成功日志（失败路径在 catch 中统一记录）
    await writeOperationLog({
      requirement: "",
      task: body.task,
      fieldMap: body.fieldMap || undefined,
      sourceFileName: body.file.fileName,
      preview: outcome.preview,
      result: outcome.result,
      verification: undefined,
      durationMs: outcome.durationMs,
      resultFileId: outcome.resultFileId,
      success: true,
    });

    return Response.json({ ok: true, outcome });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Excel 处理失败。";
    // 记录失败日志
    await writeOperationLog({
      requirement: "",
      task: body?.task,
      success: false,
      error: message,
    }).catch(() => undefined);
    // 字段缺失等业务错误 -> 400，给出用户友好提示
    if (message.includes("未找到需要处理的字段")) {
      return Response.json({ ok: false, error: message }, { status: 400 });
    }
    return Response.json({ ok: false, error: "Excel 处理失败，请检查文件后重试。" }, { status: 500 });
  }
}
