# KMD - Gemini Context

> 最近更新：2026-07-07
> 本文件刻意保持最小化：项目事实只维护在下列权威文档中，避免多份 AI 上下文文件互相漂移。

**kmd** 是 Kinetic Markdown 的主孵化仓库：Markdown 式动态排版标记语言及其工具链（Web 编辑器、核心 runtime、reader-runtime-web 包、VS Code 扩展、Android Reader 集成）。技术栈：Vue 3 + TypeScript + Pixi.js v8 + GSAP，pnpm monorepo。

## 指令与事实的权威来源（按此顺序读取）

1. `CLAUDE.md`（仓库根）—— 架构总览、命令、约定、KMD 语法速查。**所有 AI 协作者共用**，不限于 Claude。
2. `AGENTS.md` —— 协作工作原则与回归门禁。
3. `docs/planning/roadmap/implementation-roadmap.md` —— 当前阶段与下一步的唯一权威。
4. `docs/planning/TODO.md` —— 任务池与历史执行记录。
5. `docs/README.md` —— 文档分类规则（planning / knowledge / archive）。

## 关键命令

```bash
pnpm install
pnpm dev              # 编辑器开发服务器
pnpm build            # vue-tsc 类型检查 + 生产构建
pnpm test:parser      # 解析器回归
pnpm language:check   # 语言资产同步校验
pnpm reader:typecheck # reader-runtime-web 类型检查
```

## 注意

- 本文件不维护版本号、阶段状态或架构细节 —— 那些以上述权威文档为准。
- 历史版本的 GEMINI.md 曾引用 `docs/ai/TODO.md`、`docs/ai/MEMORY.md`，该目录已不存在，请勿寻找。
