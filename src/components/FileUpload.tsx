"use client";

/**
 * @file FileUpload.tsx
 * @description 文件上传组件（面向中老年：大按钮、大字体、简洁）。
 * 调用 /api/upload 上传 .xlsx 文件，成功后通过 onUploaded 回调把服务端
 * 返回的 ExcelFile（含文件名称/大小）交给父组件。
 * 非 Excel 文件会提示"请上传 Excel 文件"。
 */
import { useCallback, useRef, useState } from "react";
import type { ExcelFile } from "@/types/task";

interface FileUploadProps {
  /** 上传成功后的回调 */
  onUploaded: (file: ExcelFile) => void;
}

/** 允许的文件格式 */
const ACCEPT_EXT = ".xlsx,.xls";

/** 把字节数格式化为可读文本 */
function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  return `${(kb / 1024).toFixed(2)} MB`;
}

export default function FileUpload({ onUploaded }: FileUploadProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [selectedName, setSelectedName] = useState<string>("");
  const [selectedSize, setSelectedSize] = useState<string>("");
  const [message, setMessage] = useState<string>("");
  const [uploading, setUploading] = useState<boolean>(false);
  const [dragging, setDragging] = useState<boolean>(false);

  /** 触发系统文件选择 */
  const handleClick = useCallback(() => {
    inputRef.current?.click();
  }, []);

  /** 上传指定的 File */
  const uploadFile = useCallback(
    async (file: File) => {
      if (!/\.(xlsx|xls)$/i.test(file.name)) {
        setMessage("请上传 Excel 文件（.xlsx 或 .xls）");
        return;
      }

      setSelectedName(file.name);
      setSelectedSize(formatSize(file.size));
      setMessage("");
      setUploading(true);

      try {
        const fd = new FormData();
        fd.append("file", file);
        const res = await fetch("/api/upload", { method: "POST", body: fd });
        const body = (await res.json()) as
          | { ok: true; file: ExcelFile }
          | { ok: false; error: string };

        if (!res.ok || !body.ok) {
          throw new Error((body as { error: string }).error || "上传失败");
        }

        setMessage("上传成功 ✔");
        onUploaded((body as { file: ExcelFile }).file);
      } catch (e) {
        setMessage(e instanceof Error ? e.message : "上传失败，请重试");
      } finally {
        setUploading(false);
      }
    },
    [onUploaded]
  );

  return (
    <div>
      <div
        onClick={handleClick}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          const file = e.dataTransfer.files?.[0];
          if (file) uploadFile(file);
        }}
        className={`w-full cursor-pointer rounded-2xl border-4 border-dashed p-10 text-center transition-colors select-none
          ${dragging ? "border-blue-500 bg-blue-50" : "border-slate-300 bg-white hover:border-blue-400"}
        `}
      >
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT_EXT}
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) uploadFile(file);
            e.target.value = "";
          }}
        />
        <div className="text-5xl mb-3">📄</div>
        <p className="text-2xl font-semibold text-slate-800">
          {selectedName || "点击上传 Excel 文件"}
        </p>
        <p className="mt-2 text-xl text-slate-500">
          {selectedSize ? `${selectedSize} · 支持 .xlsx / .xls` : "支持 .xlsx / .xls 格式"}
        </p>
        {uploading && <p className="mt-3 text-xl text-blue-600">正在上传…</p>}
      </div>
      {message && (
        <p
          className={`mt-2 text-lg ${
            message.startsWith("上传成功") ? "text-green-600" : "text-red-600"
          }`}
        >
          {message}
        </p>
      )}
    </div>
  );
}
