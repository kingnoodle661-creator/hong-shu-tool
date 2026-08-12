"use client";

/**
 * @file page.tsx
 * @description 首页（AI表格管家）V0.5-A：完整 Excel 处理闭环 + 表分析 + 需求澄清 + 处理前确认。
 * 流程：上传文件 -> Excel表分析(展示类型+推荐) -> 输入需求 -> AI解析(/api/ai)
 *      ->（模糊则需求澄清 / 具体则直接）-> 字段匹配(/api/excel/match)
 *      ->（必要则）处理前确认字段 -> 程序执行(/api/excel) -> 结果审查(/api/verify)
 *      -> 展示结果与审查报告 -> 下载。
 * V0.5-A 核心增强：模糊需求（如"整理一下""把一样的合起来"）不再报错，而是被表分析推荐
 *  与需求澄清引导成可执行任务，降低对用户提示词的要求。
 * 面向中老年用户：大字体、大按钮、简洁、手机适配。
 */
import { useCallback, useState } from "react";
import FileUpload from "@/components/FileUpload";
import TaskInput from "@/components/TaskInput";
import ResultCard from "@/components/ResultCard";
import StepProgress from "@/components/StepProgress";
import FieldConfirm from "@/components/FieldConfirm";
import TableAnalysis from "@/components/TableAnalysis";
import ClarifyPanel from "@/components/ClarifyPanel";
import type {
  PipelineResult,
  ProcessStage,
  ConfirmInfo,
} from "@/types/frontend";
import { STAGE_LABEL } from "@/types/frontend";
import type {
  ExcelFile,
  ProcessSummary,
  Task,
  TableAnalysis as TableAnalysisType,
  ClarifyQuestion,
} from "@/types/task";
import type { FieldMatchResult } from "@/types/fieldMatch";

export default function Home() {
  const [file, setFile] = useState<ExcelFile | null>(null);
  const [stage, setStage] = useState<ProcessStage>("idle");
  const [result, setResult] = useState<PipelineResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<ConfirmInfo | null>(null);
  const [requirement, setRequirement] = useState("");
  // 需求理解产出的结构化任务，用于确认后复用（避免重复请求 AI）
  const [resolvedTask, setResolvedTask] = useState<Task | null>(null);
  // V0.5-A：上传后表分析结果 + 是否在分析
  const [analysis, setAnalysis] = useState<TableAnalysisType | null>(null);
  const [analysisLoading, setAnalysisLoading] = useState(false);
  // V0.5-A：需求模糊时的澄清状态（问题列表）
  const [clarify, setClarify] = useState<{
    requirement: string;
    questions: ClarifyQuestion[];
  } | null>(null);

  // 上传成功：触发表分析，重置旧状态
  const handleUploaded = useCallback((f: ExcelFile) => {
    setFile(f);
    setResult(null);
    setError(null);
    setConfirm(null);
    setResolvedTask(null);
    setClarify(null);
    setAnalysis(null);
    setStage("uploaded");

    // 异步分析表格（只读，失败静默，不阻塞后续）
    setAnalysisLoading(true);
    fetch("/api/excel/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ file: f }),
    })
      .then((r) => r.json())
      .then((body: { ok: true; analysis: TableAnalysisType } | { ok: false; error: string }) => {
        if (body.ok) setAnalysis(body.analysis);
      })
      .catch(() => {
        /* 分析失败不影响上传流程 */
      })
      .finally(() => setAnalysisLoading(false));
  }, []);

  const processing =
    stage === "analyzing" || stage === "processing" || stage === "checking";

  /** 执行 Excel + 审查（可带 fieldMap），成功进入 done 并展示结果 */
  const runExcel = useCallback(
    async (
      fileArg: ExcelFile,
      task: Task,
      requirementText: string,
      fieldMap?: Record<string, string>
    ) => {
      try {
        // Excel 执行（带可选字段映射）
        setStage("processing");
        const exRes = await fetch("/api/excel", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ file: fileArg, task, fieldMap }),
        });
        const exBody = (await exRes.json()) as
          | {
              ok: true;
              outcome: {
                resultFileId: string;
                preview: ProcessSummary;
                result: ProcessSummary;
                durationMs: number;
                message: string;
              };
            }
          | { ok: false; error: string };
        if (!exRes.ok || !exBody.ok) {
          throw new Error((exBody as { error: string }).error || "Excel 处理失败。");
        }
        const { outcome } = exBody as {
          outcome: {
            resultFileId: string;
            preview: ProcessSummary;
            result: ProcessSummary;
            message: string;
          };
        };

        // 结果审查
        setStage("checking");
        const vfRes = await fetch("/api/verify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            requirement: requirementText,
            preview: outcome.preview,
            result: outcome.result,
            task,
          }),
        });
        const vfBody = (await vfRes.json()) as
          | { ok: true; verification: PipelineResult["verification"] }
          | { ok: false; error: string };
        if (!vfRes.ok || !vfBody.ok) {
          throw new Error((vfBody as { error: string }).error || "结果审查失败。");
        }

        setResult({
          ok: true,
          task,
          resultFileId: outcome.resultFileId,
          message: outcome.message,
          preview: outcome.preview,
          result: outcome.result,
          verification: (vfBody as { verification: PipelineResult["verification"] }).verification,
        });
        setStage("done");
      } catch (e) {
        setError(e instanceof Error ? e.message : "处理失败，请重试。");
        setStage("error");
      }
    },
    []
  );

  /** AI 理解 -> 字段匹配 ->（需要则确认 / 否则直接执行）的公共后半段 */
  const runMatchAndExecute = useCallback(
    async (
      fileArg: ExcelFile,
      task: Task,
      requirementText: string
    ) => {
      setResolvedTask(task);
      setClarify(null);

      // 字段智能匹配
      setStage("confirming");
      const mRes = await fetch("/api/excel/match", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ file: fileArg, task }),
      });
      const mBody = (await mRes.json()) as
        | { ok: true; headers: string[]; match: FieldMatchResult }
        | { ok: false; error: string };
      if (!mRes.ok || !mBody.ok) {
        throw new Error((mBody as { error: string }).error || "字段匹配失败。");
      }
      const { match, headers } = mBody as {
        match: FieldMatchResult;
        headers: string[];
      };

      if (match.needConfirm) {
        // 存在中/低置信字段 -> 进入处理前确认页
        setConfirm({ headers, match, selections: {} });
        setStage("confirming");
      } else {
        // 全高置信 -> 用自动映射直接执行
        await runExcel(fileArg, task, requirementText, match.mapping);
      }
    },
    [runExcel]
  );

  /** 主流程：表分析推荐 / 澄清选项 / 或 AI 已给出具体任务 -> 统一走匹配执行 */
  const handleProcess = useCallback(
    async (requirementText: string) => {
      if (!file) return;
      setResult(null);
      setError(null);
      setConfirm(null);
      setRequirement(requirementText);

      try {
        // 需求理解
        setStage("analyzing");
        const aiRes = await fetch("/api/ai", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ requirement: requirementText, fileId: file.fileId }),
        });
        const aiBody = (await aiRes.json()) as
          | { ok: true; status: "ready"; task: Task }
          | { ok: true; status: "need_confirm"; questions: ClarifyQuestion[] }
          | { ok: false; error: string };
        if (!aiRes.ok || !aiBody.ok) {
          throw new Error((aiBody as { error: string }).error || "需求理解失败。");
        }

        if (aiBody.status === "ready") {
          // 需求具体 -> 直接走匹配执行
          await runMatchAndExecute(file, aiBody.task, requirementText);
        } else {
          // 需求模糊 -> 展示澄清（不报错）
          setClarify({
            requirement: requirementText,
            questions: aiBody.questions || [],
          });
          setStage("uploaded");
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : "处理失败，请重试。");
        setStage("error");
      }
    },
    [file, runMatchAndExecute]
  );

  /** 点击表分析推荐里「带 task」的推荐 -> 直接执行 */
  const handlePickRecommend = useCallback(
    (task: Task) => {
      if (!file) return;
      const label = `${task.operation}${task.groupBy.length > 0 ? "（按" + task.groupBy.join("、") + "）" : ""}`;
      runMatchAndExecute(file, task, label).catch((e) => {
        setError(e instanceof Error ? e.message : "处理失败，请重试。");
        setStage("error");
      });
    },
    [file, runMatchAndExecute]
  );

  /** 点击表分析推荐里「我来描述」-> 回到输入框 */
  const handleDescribe = useCallback(() => {
    setStage("uploaded");
  }, []);

  /** 点击澄清面板里的某个操作选项 -> 直接执行对应任务 */
  const handlePickClarifyOption = useCallback(
    (task: Task) => {
      if (!file) return;
      const label = clarify?.requirement || "根据您选择的操作处理";
      runMatchAndExecute(file, task, label).catch((e) => {
        setError(e instanceof Error ? e.message : "处理失败，请重试。");
        setStage("error");
      });
    },
    [file, clarify, runMatchAndExecute]
  );

  /** 用户在确认页确认字段后继续：组装 fieldMap 并执行 */
  const handleConfirm = useCallback(
    async (selections: Record<string, string>) => {
      if (!file || !confirm || !resolvedTask) return;
      // 只保留用户选择过、且选定真实列名的映射
      const fieldMap: Record<string, string> = {};
      for (const fm of confirm.match.matches) {
        if (selections[fm.field]) fieldMap[fm.field] = selections[fm.field];
      }
      setConfirm(null);
      await runExcel(file, resolvedTask, requirement, fieldMap);
    },
    [file, confirm, resolvedTask, requirement, runExcel]
  );

  /** 回到重新描述：清空确认/澄清视图，保留文件 */
  const handleRedo = useCallback(() => {
    setConfirm(null);
    setClarify(null);
    setResolvedTask(null);
    setStage("uploaded");
  }, []);

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 px-5 py-8">
      <header className="text-center">
        <h1 className="text-5xl font-bold text-slate-800">📊 AI表格管家</h1>
        <p className="mt-3 text-xl text-slate-500">
          上传 Excel，用一句话完成表格处理
        </p>
      </header>

      {/* 五步骤进度条：处理开始后显示 */}
      {stage !== "idle" && <StepProgress stage={stage} />}

      <FileUpload onUploaded={handleUploaded} />

      {/* V0.5-A：表分析结果 + 推荐操作（上传后展示） */}
      {stage !== "idle" && !confirm && !result && !error && (
        <TableAnalysis
          analysis={analysis}
          loading={analysisLoading}
          onPickTask={handlePickRecommend}
          onDescribe={handleDescribe}
        />
      )}

      {/* V0.5-A：需求澄清（模糊需求）面板 */}
      {clarify && !confirm && !result && !error && (
        <ClarifyPanel
          requirement={clarify.requirement}
          questions={clarify.questions}
          onPickOption={handlePickClarifyOption}
          onRedo={handleRedo}
        />
      )}

      {/* 处理前字段确认页 */}
      {confirm && !result && !error && (
        <FieldConfirm
          requirement={requirement}
          match={confirm.match}
          onConfirm={handleConfirm}
          onRedo={handleRedo}
        />
      )}

      {/* 需求输入：确认/澄清中聚焦于相应面板，其余阶段展示输入框 */}
      {stage !== "confirming" && !clarify && (
        <TaskInput
          canProcess={!!file}
          processing={processing}
          stageLabel={STAGE_LABEL[stage]}
          onSubmit={handleProcess}
        />
      )}

      <ResultCard hasResult={!!result} result={result} error={error} />

      <footer className="mt-4 text-center text-base text-slate-400">
        文件仅用于本次处理，处理完成后自动清除。
      </footer>
    </main>
  );
}
