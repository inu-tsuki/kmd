# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository

KMD (Kinetic Markdown) is a pnpm monorepo for a Markdown-like markup language and toolchain for animated, GPU-rendered kinetic typography.

Workspaces (declared in `pnpm-workspace.yaml`):

- `apps/editor` — Vue 3 + Pixi.js Web editor shell and editor-only Monaco/TextMate integrations.
- `apps/community-api` — Express mock backend used by the Android reader course project.
- `packages/core` — Private monorepo source package for parser, layout, effects, stage, render, player, and reader-runtime contracts. Imported as `@kmd/core`; deep imports are internal and unstable during Phase B.
- `packages/language` — Shared KMD language assets (TextMate grammar, `language-configuration.json`). Imported as `@kmd/language`.
- `packages/kmd-language-server` — Node LSP server for KMD diagnostics. Reuses `@kmd/core/parser/Parser`, supports stdio and Node IPC, and is consumed by the VS Code extension.
- `packages/reader-runtime-web` — Reader-only WebView/browser bundle package. Package duties and extraction gates live in `docs/planning/packages/reader-runtime-web.md`.
- `extensions/vscode-kmd` — VS Code language extension and lightweight LSP client. Keeps a packaged copy of `packages/language` assets that must stay in sync (verified by `pnpm language:check`).

Not in the workspace:

- `apps/android-reader/` — Optional local checkout; ignored by this repo.

## Commands

Run from the repo root. Package manager is **pnpm**. There is no lint script.

```bash
pnpm install
pnpm dev                  # editor dev server (vite)
pnpm core:check           # core boundary guard + standalone TypeScript check
pnpm build                # core check + LSP server build + VS Code client build + editor type-check/build
pnpm preview              # editor: preview production build
pnpm test                 # core check + LSP tests + editor vitest suite (parser/layout/effects/playback/invariants/shaders/frontmatter)
pnpm test:parser          # parser integration + corpus golden (vitest)
pnpm test:golden:write    # regenerate parser/layout golden files (REVIEW git diff, never blind-commit)
pnpm language:check       # verify packages/language assets match extensions/vscode-kmd packaged copies

pnpm language-server:build      # type-check and bundle the Node LSP server
pnpm language-server:test       # LSP diagnostic adapter and core-parser integration tests
pnpm language-server:check      # language-server build + tests
pnpm vscode-kmd:build           # compile the lightweight VS Code LSP client
pnpm vscode-kmd:typecheck

pnpm reader:build         # build reader-runtime-web bundle to dist/reader-runtime/
pnpm reader:preview

pnpm community-api:dev    # tsx watch on apps/community-api/src/index.ts (listens on :3000)
pnpm community-api:build  # tsc
pnpm community-api:test   # vitest run
```

When working on parser, layout, effect routing, or shared runtime behavior, validate against the gate table below before opening a PR. Test net design, tripwire accounting, and golden-corpus philosophy live in `docs/planning/test-net-design-2026-07.md`.

## Working Stance & Principles

> 系统健康最大，长期痛苦最小。

### 实验期姿态（Pre-Production Stance）

KMD 处于密集实验与验证期，没有生产/线上环境，不对既有用户负兼容责任。因此：

- **摆脱兼容包袱**：不为"旧脚本逐字节不变"做设计；可以大刀阔斧重新设计 parser / runtime / 语言形态，无需弃用期、无需渐进绞杀。
- **保留工艺资产**：递归下降、类型化 AST、source range、已固化的回归行为（playback tripwire 套件 / golden 快照）是技术成果，不因激进改革而丢弃；golden 语料是"已知正确行为的证据库（参照系）"，不是"不许裂的保险丝"。
- **行为变更要有意为之**：改变既有行为时明确标注"这是有意变更"，由叙事验证 KMD 证明其更优，而非顺手偷袭。

有效期：直到项目敲定稳定对外形态、或真正需要维护线上用户为止，届时复核改写为兼容策略。此姿态作用于语言形态与兼容策略；不蔓延到已解决的运行时正确性（record/replay、seek 幂等、reader-runtime 边界——那些是地基，不是包袱）。

### 运行时工艺铁律（Working Principles）

**探针先于写代码（Verify-then-write）**：当修复依赖某个底层库或运行时表面（GSAP、Pixi、glslang、tsx、DOM）的行为时，先用一次性探针验证前提，再写依赖它的生产代码。断言运行时行为的代码注释必须经探针验证，不能靠推断。探针在与相关测试/生产路径相同的环境里跑，结果记进 commit message 或 planning note。

**构建期消解，而非运行时去重（Construction over runtime-dedup）**：当所有权能在构建期确立时，运行时刻意不做去重守卫（Set/cursor/epsilon）：baseline vs record、timeline 段边界、共享 helper 输出，应让任一时刻只有一个 apply driver 拥有。**例外**：当两个 driver 共享一个构建期无法分离的运行时事件时，一个最小的有状态所有权标志是可接受的逃生口，须在实现它的状态旁注明。判据：触发时刻能在构建期分离 → 修构建；共享同一运行时事件 → 用窄而有文档的运行时标志。

**回归须覆盖完整语义面，不止复现侧**：修 playback/effect bug 时，回归覆盖必须包含双向、触及受影响资源的每条操作路径、每条构建期写入路径、以及退化/空情形。playback 回归套件是其持久层；新修复应在那里加聚焦用例，而非只覆盖复现的那一侧。

**测试 harness 不得掩盖生产行为**：harness 会隐藏生产行为，尤其在 ticker、scheduler、timer、浏览器 API、mocked loader 周围。当修复针对此类行为时，套件可能只能验证*机制*而非*触发结果*。在测试里诚实注明该局限，对任何承重的库假设用真实环境探针。

**参数构建期一次消解，两条 apply 路径共享**：当一个资源有两条 apply 路径（自然播放与 seek 重放），两者必须消费**同一份预消解参数**。变量引用与对 fallback 敏感的数值字段在构建期一次消解，结果存进 record，两条路径重放同一对象。不让某条路径在运行时以不同 fallback 约定重新消解；fallback 值必须单源，否则两条路径会分叉。

### 测试门禁（按改动范围）

| 改动触及 | 必过门禁 |
|---|---|
| parser、layout 或共享 runtime | `pnpm build` + `pnpm test` + `pnpm test:parser` |
| KMD LSP server 或 VS Code client | `pnpm language-server:check` + `pnpm vscode-kmd:typecheck` |
| playback、seek、effect 管线、timeline/easing、stage modifiers | 上一行 + `pnpm test:playback` + `pnpm test:invariants` |
| 浏览器渲染、Pixi 资源生命周期、ticker、WebGL 集成 | 再加 `pnpm test:e2e` |
| 任何 `*Filter.ts` | 再加 `pnpm test:shaders` |
| `@kmd/language` 或 VS Code 扩展资产 | `pnpm language:check` |

`pnpm build` 不编译 GLSL 模板字符串，shader 失败时它仍会过——shader 门禁（Khronos `glslangValidator`，16.5.0 官方归档中的可执行文件名为 `glslang`；硬 CI gate，无 `SKIP_SHADER_GATE` 逃生口；二者之一需在 PATH）负责抓这类错误。`test:e2e` 首次运行前 `pnpm exec playwright install chromium`。golden 文件（`apps/editor/src/test/__golden__/`）是特征快照——经 `pnpm test:golden:write` 再生后**人工审 git diff**，绝不盲提交（`vitest --update` 不碰它们：它们是纯 JSON，不是 vitest snapshot）。

## High-Level Architecture

### Where the runtime lives

The KMD core runtime lives under `packages/core/src/`. Deep-dive pipeline docs:
`docs/knowledge/runtime/core/parser-pipeline.md`, `effect-pipeline.md`,
`command-routing.md` (also in the docs index below). This file records only
load-bearing boundaries, not structure descriptions:

- Reader-hostable contract: `packages/core/src/runtime/` (`ReaderRuntimeContract`, `ReaderRuntimeSession`, `RuntimeAssetPolicy`), consumed by `packages/reader-runtime-web`. `scripts/check-core-boundary.mjs` rejects editor-only dependencies and relative imports escaping the package. Editor-only bridges back to Pinia live in `apps/editor/src/runtime/`; Monaco/TextMate integrations live in `apps/editor/src/editor/`.
- Language-service host: `packages/kmd-language-server` adapts `KMDParser.validate()` to standard LSP diagnostics. `extensions/vscode-kmd/client.ts` owns only VS Code lifecycle and transport; parser semantics remain in `packages/core`.
- `scene.clear` is the single runtime path for `---`; do not re-introduce `isSceneClear` displays in `SegmentBuilder`.
- `SegmentBuilder` consumes `ParagraphBuildInput` (not raw text); `TextPlayer` consumes `ParagraphExecutionPlan` (not semantic fields off `KineticChar`).
- Module-level singletons (not Vue-injected): `readerApp`, `stageManager`, `layout`, `parser`, `scriptPlayer`, `effectManager`, `styleManager`, `layoutManager`.

## Roadmap Authority

Do not maintain phase status, completed work summaries, or next-step lists in this file. Use `docs/planning/roadmap/implementation-roadmap.md` as the current roadmap authority, and keep phase records under `docs/planning/roadmap/`.

## Conventions

- Vue SFCs in PascalCase (`KmdEditor.vue`); stores / utilities in camelCase (`editorStore.ts`); 2-space indent, semicolons, single quotes in `.ts`.
- `@kmd/core` remains private during Phase B. Physical package boundaries are enforced, but deep exports are monorepo-internal and must not be presented as a stable npm API or independently versioned release contract.
- Import shared language assets via `@kmd/language`, never by reaching into `extensions/vscode-kmd/`.
- Adding new behavior:
  - Visual effects → add a `{ fn, meta }` preset in `packages/core/src/effects/presets/` (visual/behavior/filter/entrance/timing; auto-registers via `registerBatch`).
  - Style modifiers → register in `packages/core/src/effects/StyleManager.ts`.
  - Layout commands → register an expander in `packages/core/src/layout/layoutExpanders.ts`.
  - Stage commands → register in `packages/core/src/stage/stagePresets.ts`.
  - Then update `KMDParser.validate()` in `packages/core/src/parser/Parser.ts` if the new name must pass the known-command check.

## Docs To Read Before Changing Things

- `docs/README.md` — doc taxonomy (`planning/`, `knowledge/`, `archive/`).
- `docs/planning/roadmap/implementation-roadmap.md` — roadmap and sequencing authority; follow its links to active or historical phase records.
- `docs/planning/packages/reader-runtime-web.md` — reader package boundary and completed internal `packages/core` extraction decision.
- `docs/knowledge/integration/reader-runtime-web-bundle.md`, `android-webview-runtime-protocol.md` — before changing Android/WebView runtime integration.
- `docs/knowledge/integration/kmd-language-server.md` — before changing the LSP server or VS Code client transport.
- `docs/planning/ecosystem/repository-strategy.md` — monorepo package boundaries and later publication gates.
- `docs/knowledge/runtime/core/command-routing.md`, `effect-pipeline.md`, `parser-pipeline.md` — before touching command routing, effects, or the parser.
- `docs/planning/TODO.md` — AI-collaboration task pool and historical execution log.
- `docs/planning/test-net-design-2026-07.md` — test net design, tripwire accounting, golden-corpus philosophy.
- `docs/planning/architecture-health-check-2026-07.md` — prescription ledger (处方 1–11 tracking); read before planning refactors.
- `docs/planning/theme-2-yard-sweep-2026-08.md` — theme-2 ledger: removals/renames, intentional-change notes, and the "deliberately not done" list with destinations.

When you change command routing, effects, layout, stage, or language semantics, update the corresponding doc in the same change. Place new docs under `planning/`, `knowledge/`, or `archive/` per the rules in `docs/README.md`.

## KMD Syntax (quick reference)

Authoritative grammar: `docs/knowledge/language/design.md` (封盘决议 D1–D27) plus
chapter docs; old→new mapping in `migration.md`. Do not maintain a second grammar
in this file — Phase B changes the language surface.

Orientation for reading samples: `{...}` braced token group (1:1 with effect chain
slots); `@` separates body from commands; `f.effect(params)` per-token vs bare
`.effect` global; `>`/`>>`/`>>>` advance; `~`/`^` speed sugars; `|` pause;
`---` scene clear; Markdown sugars `**bold**`/`*italic*`/`# heading`.
