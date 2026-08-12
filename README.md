# 📊 AI表格管家

上传 Excel，用一句话完成表格处理（分组汇总、求和）。AI 理解需求并检查，**程序**负责执行 Excel 处理，结果审查通过后即可下载。面向中老年用户，手机微信可直接访问。

**核心原则**：AI 负责理解和检查，程序负责执行。禁止 AI 直接修改 Excel 内容。

## 目录
- [功能架构](#功能架构)
- [本地运行](#本地运行)
- [Vercel 部署（生产）](#vercel-部署生产)
- [环境变量说明](#环境变量说明)
- [文件存储架构（V0.4）](#文件存储架构v04)
- [手机浏览器测试清单](#手机浏览器测试清单)
- [其它说明](#其它说明)

---

## 功能架构

```
用户上传 Excel
   ↓
AI 理解需求（DeepSeek）→ 生成结构化任务 JSON
   ↓
字段智能匹配 /（必要时）人工确认
   ↓
程序执行 Excel 处理（exceljs，AI 不直接改表）
   ↓
程序结果审查（金额/数据量/表头/任务完成度）
   ↓
输出并下载 Excel
```

三个 Agent 分工：**需求理解**（AI）→ **Excel 执行**（程序）→ **结果审查**（程序规则为准，AI 仅参考）。

## 技术栈

- Next.js 15（App Router）+ TypeScript + Tailwind CSS + React
- API 使用 Next.js Route Handlers
- AI 调用 DeepSeek（需求理解 / 结果审查）
- Excel 处理：Node 生态 exceljs
- 文件存储：`StorageProvider` 抽象（本地磁盘 / Vercel Blob）
- 部署兼容 Vercel

---

## 本地运行

前置：Node.js 18+（建议 20/22 LTS）。

```bash
npm install

# 复制环境变量示例并按需填写
cp .env.example .env.local
# Windows: copy .env.example .env.local

npm run dev
```

打开 http://localhost:3000 。本地默认使用 `local` 存储驱动（写入 `./.uploads`），无需配置 Blob。

测试：
```bash
npm run test:v03     # 单元/集成测试
npm run build        # 生产构建（类型检查）
npm run lint         # ESLint
```

---

## Vercel 部署（生产）

### 前置准备
1. 把项目推送到 GitHub 仓库。
2. 在 vercel.com 用 GitHub 账号登录。

### 1. 导入项目
Vercel 控制台 → **Add New → Project** → 选择本仓库 → 确认 Framework 为 **Next.js**，构建命令 `npm run build` → **Deploy**。

### 2a. 配置文件存储（Vercel Blob）
生产环境默认使用 Blob 存储。若未配置 `BLOB_READ_WRITE_TOKEN`，上传会出现如下现象：页面提示「文件存储服务暂时不可用，请稍后重试」（Vercel 日志里会显示 `[Storage Error]` 和 `缺少 BLOB_READ_WRITE_TOKEN`）。按下面 4 步修复：

1. **创建 Vercel Blob**：项目页 → **Storage** → **Create Blob Store** → 选择 **Blob** → **Create**。
2. **复制 Token**：创建完成后，把 **`BLOB_READ_WRITE_TOKEN`** 的值复制出来（这是读写令牌，仅服务端使用，不要暴露到前端）。
3. **添加 Environment Variables**：**Settings → Environment Variables** 中添加，并勾选 **Production** 和 **Preview**：

| 变量名 | 值 | 说明 |
|---|---|---|
| `BLOB_READ_WRITE_TOKEN` | 第 2 步复制的值 | Blob 存储令牌（blob 模式必填）|
| `DEEPSEEK_API_KEY` | 你的 DeepSeek Key | 必填，用于 AI 理解/审查 |
| `STORAGE_DRIVER` | `blob` | 生产推荐；未设则 Vercel 自动默认 blob |
| `DEEPSEEK_MODEL` | `deepseek-chat` | 可选 |

4. **重新部署**：保存变量后，到 **Deployments** → 选最近一次 → **Redeploy**，让新环境变量生效。

> 本地开发用 `STORAGE_DRIVER=local`，文件写本地 `./.uploads`，无需 token。

### 3. 部署
保存环境变量后 Vercel 自动重新部署。之后通过 `https://<你的项目>.vercel.app` 访问，微信打开该链接即可使用。

### 4.（可选）自动清理过期文件
Vercel 支持 Cron：项目根添加 `vercel.json`：
```json
{
  "crons": [
    { "path": "/api/cleanup", "schedule": "0 3 * * *" }
  ]
}
```
每天 03:00 调用 `/api/cleanup` 清理超过 24 小时的临时文件。不配置也不影响使用，也可手动访问 `/api/cleanup`。

---

## 环境变量说明

| 变量 | 必填 | 说明 |
|---|---|---|
| `DEEPSEEK_API_KEY` | 是 | DeepSeek 模型 Key（只从环境读取，不写死） |
| `DEEPSEEK_BASE_URL` | 否 | DeepSeek API 地址，默认官方 |
| `DEEPSEEK_MODEL` | 否 | 模型名，默认 `deepseek-chat` |
| `STORAGE_DRIVER` | 否 | `local`（本地）/ `blob`（Vercel Blob）。未设时：Vercel→blob，本地→local |
| `BLOB_READ_WRITE_TOKEN` | blob 模式必填 | Vercel Blob 读写令牌 |
| `UPLOAD_DIR` | 否 | 仅 local 模式：上传文件目录，默认 `./.uploads` |
| `MAX_UPLOAD_SIZE_BYTES` | 否 | 上传大小上限，默认 10485760（10MB） |
| `EXCEL_ENGINE` | 否 | 处理引擎，`node`（默认） |

---

## 文件存储架构（V0.4）

业务代码只依赖统一的 `StorageProvider` **接口**，不直接接触本地文件系统。

```
services/storage/
├── types.ts     # StorageProvider 接口（save/get/delete/canResolve）
├── index.ts     # 工厂：按 STORAGE_DRIVER / VERCEL 选择驱动
├── local.ts     # 本地磁盘实现（本地开发默认）
├── blob.ts      # Vercel Blob 实现（生产，@vercel/blob）
└── lifecycle.ts # 文件生命周期：manifest 清单 + cleanupOldFiles(24h)
```

- **save**：写入并返回 `{ key, meta:{ url, pathname } }`。
- **get**：按 key 读回 Buffer（local 磁盘或 Blob 网络统一）。
- **download**：`/api/excel/download?fileId=...` → `storage.get(fileId)` 返回附件，两种驱动均可用。
- **生命周期**：上传/结果文件登记进 `__manifest.json` 清单（非数据库），超 24 小时由 `/api/cleanup` 清理。
- **隐私**：随机 fileId 不暴露真实文件名路径；Blob 对象 access 为 public（依赖随机 ID 难猜 + 24h 清理保护）。

> 换存储后端（如 S3/OSS）只需新增实现类并在 `index.ts` 接入，业务代码零改动。

---

## 手机浏览器测试清单

部署后在手机（微信内打开链接）逐项核对：
- [ ] 页面正常打开、排版适配手机（大按钮/大字体）
- [ ] 上传按钮可点击，选择 `.xlsx` 文件
- [ ] 输入一句话需求，点击开始处理
- [ ] 处理流程正常推进（顶部五步进度条）
- [ ] 结果审查通过，可点击「下载处理后的 Excel」得到文件
- [ ] 处理等待时间在可接受范围内

---

## 安全设计

- 上传白名单校验（扩展名 + MIME），文件以随机 fileId 落盘，防路径穿越。
- API Key 只从环境变量读取，不写死在代码；缺 `BLOB_READ_WRITE_TOKEN` 时给出明确错误。
- AI 输出经程序校验（schema + 字段匹配 + 结果审查），审查以程序规则为准。
- 文件生命周期自动清理，降低隐私文件滞留风险。

## 其它说明

- **无数据库**：本项目不使用数据库；文件生命周期用存储层内清单实现，日志用本地 JSON。
- **限制**：不做用户系统/登录/支付/小程序原生；仅支持 Excel（.xlsx/.xls）。
