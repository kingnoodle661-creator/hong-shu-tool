import type { Metadata } from "next";
import "./globals.css";

/**
 * 全局元数据：面向中老年用户的简洁标题。
 */
export const metadata: Metadata = {
  title: "AI表格管家",
  description: "上传 Excel 文件，用一句话完成表格处理",
};

/**
 * 根布局：设置全屏高度与基线样式。
 * 字体使用系统中文栈（见 globals.css），避免构建时依赖 Google Fonts 外网。
 * 注意：本文件使用 Next.js 15 兼容的布局签名（Readonly<{ children }>）。
 */
export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN" className="h-full antialiased">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
