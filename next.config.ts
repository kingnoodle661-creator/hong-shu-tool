import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // exceljs 依赖 Node 内置模块，需在服务端外部加载，避免被打包器解析报错。
  // Next 15 使用 serverExternalPackages 声明。
  serverExternalPackages: ["exceljs"],
  /* 更多配置项后续按需添加 */
};

export default nextConfig;
