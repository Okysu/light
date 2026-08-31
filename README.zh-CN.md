<div align="center">

# Light

**本地优先的轻量知识库：Markdown 笔记、看板与视觉思考。**

简体中文 · [English](./README.md)

[![Release](https://img.shields.io/github/v/release/Okysu/light?include_prereleases&style=flat-square)](https://github.com/Okysu/light/releases)
[![Desktop builds](https://img.shields.io/github/actions/workflow/status/Okysu/light/release.yml?style=flat-square&label=desktop%20build)](https://github.com/Okysu/light/actions/workflows/release.yml)
[![Tauri 2](https://img.shields.io/badge/Tauri-2-24C8DB?style=flat-square&logo=tauri&logoColor=white)](https://v2.tauri.app/)
[![Vue 3](https://img.shields.io/badge/Vue-3-42b883?style=flat-square&logo=vuedotjs&logoColor=white)](https://vuejs.org/)

</div>

![Light 编辑器](./assets/editor.png)

Light 让知识始终可携带。每一篇笔记都是磁盘上的普通 `.md` 文件，不是专有数据库中的一条记录。桌面客户端直接使用你选择的文件夹；网页版离线存储在浏览器中，也可以安装为 PWA。

## 为什么是 Light？

- **本地优先**：编辑和保存不依赖服务器，也不需要持续联网。
- **轻量化**：启动快、界面聚焦，没有必须启用的云账号或臃肿功能。
- **数据可携带**：标准 Markdown、可读 frontmatter、相对附件链接和完整导出。
- **可选的加密同步**：连接自己的 S3 兼容存储，内容、路径和清单在上传前加密。
- **多种思考方式**：笔记、看板、画板、反向链接和知识图谱共享同一个工作区。

## 功能亮点

| | |
| --- | --- |
| ![搜索与命令](./assets/search.png) | ![设置](./assets/settings.png) |

- Milkdown 所见即所得 Markdown 编辑，支持 CommonMark、GFM、代码高亮、数学公式、Mermaid、脚注、文字高亮、音视频、表格和斜杠命令。
- Obsidian 风格 `[[双向链接]]`，支持锚点、别名、自动补全、重命名后引用更新、反向链接与全库知识图谱。
- 多列看板拖拽，支持标签、截止日期、优先级、子任务、负责人、关联笔记、筛选和归档。
- 无限画布，支持图形、箭头、手绘、嵌入笔记和看板卡片、组合、小地图以及 PNG/SVG 导出。
- 中文友好的全文检索、正则、高亮，与命令面板合一（`Ctrl/⌘ + K`）。
- 粘贴、拖入或斜杠命令导入附件，可选将粘贴的网络图片下载到本地，追踪引用来源、清理孤立附件，并可选图片 OCR。
- Markdown 压缩包、PDF 和离线静态站点导出。
- OpenAI、Anthropic 与 OpenAI 兼容服务，API Key 本机加密，支持流式输出、图文选区操作和 BYOK。
- 侧边栏可折叠的设置入口、AI 状态和 S3 同步状态，支持一键立即同步。
- 应用锁、敏感笔记加密、版本历史、回收站、日记、主题方案、自定义 CSS 与可配置快捷键。

## 支持平台

### Web / PWA

可以一键部署到 Vercel：

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/Okysu/light)

Vercel 使用 `pnpm build` 构建 `dist/`，并配置了 SPA 回退，直接访问子路径不会出现 404。

### 桌面客户端

Windows、macOS 和 Linux 构建会发布到 [GitHub Releases](https://github.com/Okysu/light/releases)。桌面版额外支持本地文件夹工作区、系统托盘、全局速记快捷键、平台化标题栏和单实例保护。

> 当前 RC 构建尚未进行商业代码签名，操作系统首次启动时可能显示安全提示。

## S3 端到端加密同步

Light 由设备直接连接 AWS S3、MinIO、Cloudflare R2 或其它兼容端点，不经过 Light 中转服务器。

- 文件内容、路径和清单使用 AES-256-GCM 加密。
- 密码通过 Argon2id 派生，也可使用离线恢复密钥。
- 双向增量、删除传播、离线恢复、冲突策略与 CAS 自动重试。
- 大附件采用流式分帧加密和可恢复 multipart 上传。
- S3 凭据只在本机加密保存，不会写入同步 Vault。

## 本地开发

需要 Node.js 22+、pnpm 10+，桌面开发还需安装 [Tauri 平台依赖](https://v2.tauri.app/start/prerequisites/)。

```bash
pnpm install
pnpm dev
```

| 命令 | 说明 |
| --- | --- |
| `pnpm dev` | 启动网页版开发服务器 |
| `pnpm tauri dev` | 启动桌面客户端开发模式 |
| `pnpm build` | 构建 Web/PWA |
| `pnpm tauri build` | 构建当前平台的桌面安装包 |
| `pnpm test` | 运行测试 |
| `pnpm typecheck` | 运行 Vue 与 TypeScript 检查 |

## 数据位置

如需避免粘贴图片的外链失效，可在 **设置 → 编辑器 → 自动下载到本地并替换外链** 中启用。图片会保存到 `attachments/` 并使用相对路径；单张上限 20 MiB，来源网站需要允许跨域读取。下载失败时保留原外链并提示。

- **桌面端**：用户选择的普通文件夹。
- **网页版**：浏览器私有 OPFS 存储；请通过导出或加密 S3 同步做好备份。

未知的 frontmatter 字段会原样保留，因此可以继续配合其它 Markdown 工具使用。

## 发布方式

`package.json` 是界面与 Tauri 安装包版本的唯一来源。推送类似 `0.0.1-rc` 的语义化版本 Tag 后，流水线会运行测试，并构建 Windows、Linux、macOS Apple Silicon 与 macOS Intel 版本，最后上传至 GitHub Releases。

## 许可证

Copyright © 2026 Light contributors。Light 使用 [GNU Affero General Public License v3.0](LICENSE)（`AGPL-3.0-only`）发布。
