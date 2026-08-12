/**
 * @file logger.ts
 * @description 操作日志服务（V0.3）。记录每次处理的关键信息到本地 JSON 文件。
 * - 使用本地文件系统（默认工作区 logs/ 目录），**不用数据库**（本项目禁用数据库）。
 * - 用途：审计 / 排查 / 统计处理成功率。日志文件按日切分，便于管理与清理。
 * - 不记录文件二进制内容，只记录元信息与摘要，避免隐私泄露。
 */
import { mkdir, readdir, appendFile, rename } from "fs/promises";
import { randomUUID } from "crypto";
import path from "path";
import type { Task } from "@/types/task";
import type { ProcessSummary } from "@/types/task";
import type { VerificationSuite } from "@/types/task";

/** 日志根目录：默认工作区 logs/，可通过 LOG_DIR 覆盖 */
const logDir = process.env.LOG_DIR || path.join(process.cwd(), "logs");

/** 单条操作日志的结构 */
export interface OperationLogEntry {
  /** 日志唯一 id */
  id: string;
  /** ISO 时间戳 */
  time: string;
  /** 用户输入的一句话需求 */
  requirement: string;
  /** 结构化任务（AI 理解 + 程序校验后）；解析/执行失败时可能缺省 */
  task?: Task;
  /** 字段智能匹配结果（逻辑列名 -> 真实列名，供排查字段映射问题） */
  fieldMap?: Record<string, string>;
  /** 源文件名 */
  sourceFileName?: string;
  /** 处理前摘要 */
  preview?: ProcessSummary;
  /** 处理后摘要 */
  result?: ProcessSummary;
  /** 结果审查报告 */
  verification?: VerificationSuite;
  /** 处理耗时（毫秒） */
  durationMs?: number;
  /** 处理结果的下载标识 */
  resultFileId?: string;
  /** 是否成功 */
  success: boolean;
  /** 出错时的错误信息 */
  error?: string;
}

/** 当前日志文件名（按日切分） */
function currentLogFile(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return path.join(logDir, `ops-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}.jsonl`);
}

/**
 * 写入一条操作日志（追加到当日 JSONL 文件）。
 * 容错极强：任何写入失败都不影响主流程（只吞错并 console 提示）。
 */
export async function writeOperationLog(
  entry: Omit<OperationLogEntry, "id" | "time">
): Promise<string> {
  const id = randomUUID();
  const record: OperationLogEntry = { id, time: new Date().toISOString(), ...entry };
  try {
    await mkdir(logDir, { recursive: true });
    await appendFile(currentLogFile(), JSON.stringify(record) + "\n", "utf8");
  } catch (err) {
    // 日志失败不影响业务流程
    console.warn("[logger] 写入操作日志失败：", err);
  }
  return id;
}

/**
 * 列出当前已有的日志文件（当日 + 历史），返回文件名。供管理/审计界面使用。
 */
export async function listLogFiles(): Promise<string[]> {
  try {
    return await readdir(logDir);
  } catch {
    return [];
  }
}

/**
 * 清理超过 N 天的日志文件。默认保留 30 天。
 * 用于避免日志无限增长（本项目无数据库，靠本地文件滚动清理）。
 */
export async function pruneOldLogs(maxDays = 30): Promise<number> {
  try {
    const files = await readdir(logDir);
    const cutoff = Date.now() - maxDays * 24 * 60 * 60 * 1000;
    let removed = 0;
    for (const f of files) {
      if (!/^ops-\d{8}\.jsonl$/.test(f)) continue;
      const [, y, m, d] = f.match(/^ops-(\d{4})(\d{2})(\d{2})\.jsonl$/)!;
      const ts = new Date(`${y}-${m}-${d}T00:00:00`).getTime();
      if (ts < cutoff) {
        await rename(path.join(logDir, f), path.join(logDir, `.trash-${f}`)).catch(() => undefined);
        removed++;
      }
    }
    return removed;
  } catch {
    return 0;
  }
}
