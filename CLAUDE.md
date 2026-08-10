# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository

KMD (Kinetic Markdown) is a pnpm monorepo for a Markdown-like markup language and toolchain for animated, GPU-rendered kinetic typography.

Workspaces (declared in `pnpm-workspace.yaml`):

- `apps/editor` — Vue 3 + Pixi.js Web editor and editor-side KMD runtime code (`src/core/`).
- `apps/community-api` — Express mock backend used by the Android reader course project.
- `packages/language` — Shared KMD language assets (TextMate grammar, `language-configuration.json`). Imported as `@kmd/language`.
- `packages/reader-runtime-web` — Reader-only WebView/browser bundle package. Package duties and extraction gates live in `docs/planning/packages/reader-runtime-web.md`.

Not in the workspace:

- `extensions/vscode-kmd` — VS Code language extension. Keeps a packaged copy of `packages/language` assets that must stay in sync (verified by `pnpm language:check`).
- `apps/android-reader/` — Optional local checkout; ignored by this repo.

## Commands

Run from the repo root. Package manager is **pnpm**. There is no lint script.

```bash
pnpm install
pnpm dev                  # editor dev server (vite)
pnpm build                # editor: vue-tsc type-check + production build
pnpm preview              # editor: preview production build
pnpm test                 # editor vitest suite (parser golden + layout + effects + playback + invariants + shaders + frontmatter)
pnpm test:parser          # parser integration + corpus golden (vitest)
pnpm test:golden:write    # regenerate parser/layout golden files (REVIEW git diff, never blind-commit)
pnpm language:check       # verify packages/language assets match extensions/vscode-kmd packaged copies

pnpm reader:build         # build reader-runtime-web bundle to dist/reader-runtime/
pnpm reader:preview

pnpm community-api:dev    # tsx watch on apps/community-api/src/index.ts (listens on :3000)
pnpm community-api:build  # tsc
pnpm community-api:test   # vitest run
```

When working on parser, layout, effect routing, or shared runtime behavior, validate with `pnpm build` and `pnpm test` (vitest) before opening a PR. The editor test net (`apps/editor/src/test/`, vitest ^2.1.8) covers parser golden fixtures (full corpus + B0.1 syntax), layout coordinate stability, effects four-track classification, playback state-machine regression, INV-7/INV-8 invariant guards, GLSL shader compile gate, and frontmatter writeback — see `docs/planning/test-net-design-2026-07.md`. Add new regression cases as vitest tests under `src/test/`; golden files live under `src/test/__golden__/` and must be regenerated via `pnpm test:golden:write` then human-reviewed (never blind `--update`). Add sample KMD inputs under `apps/editor/public/` or `apps/editor/public/tests/`. Required gates scale with change scope — see the table under Working Stance & Principles.

## Working Stance & Principles

> 系统健康最大，长期痛苦最小。

### 实验期姿态（Pre-Production Stance）

KMD 处于密集实验与验证期，没有生产/线上环境，不对既有用户负兼容责任。因此：

- **摆脱兼容包袱**：不为"旧脚本逐字节不变"做设计；可以大刀阔斧重新设计 parser / runtime / 语言形态，无需弃用期、无需渐进绞杀。
- **保留工艺资产**：递归下降、类型化 AST、source range、已固化的回归行为（playback 331 用例 / golden 快照）是技术成果，不因激进改革而丢弃；golden 语料是"已知正确行为的证据库（参照系）"，不是"不许裂的保险丝"。
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
| playback、seek、effect 管线、timeline/easing、stage modifiers | 上一行 + `pnpm test:playback` + `pnpm test:invariants` |
| 浏览器渲染、Pixi 资源生命周期、ticker、WebGL 集成 | 再加 `pnpm test:e2e` |
| 任何 `*Filter.ts` | 再加 `pnpm test:shaders` |
| `@kmd/language` 或 VS Code 扩展资产 | `pnpm language:check` |

`pnpm build` 不编译 GLSL 模板字符串，shader 失败时它仍会过——shader 门禁（glslangValidator，硬 CI gate，无 `SKIP_SHADER_GATE` 逃生口；需 `glslangValidator` 在 PATH：`brew install glslang` / `pacman -S glslang` / `apt install glslang-tools`）负责抓这类错误。`test:e2e` 首次运行前 `pnpm exec playwright install chromium`。golden 文件（`src/test/__golden__/`）是特征快照——经 `pnpm test:golden:write` 再生后**人工审 git diff**，绝不盲提交（`vitest --update` 不碰它们：它们是纯 JSON，不是 vitest snapshot）。

## High-Level Architecture

### Where the runtime lives

The KMD core runtime code lives under `apps/editor/src/core/`. The reader-hostable contract layer is in `apps/editor/src/core/runtime/` (`ReaderRuntimeContract`, `ReaderRuntimeProtocol`, `ReaderRuntimeSession`, `RuntimeAssetPolicy`) and is consumed by `packages/reader-runtime-web`. Do **not** import editor UI modules (Vue components, Pinia, Monaco, TextMate, editor panels) from anything reached by the reader runtime hot path. Editor-only adapters that bridge runtime callbacks back to Pinia live in `apps/editor/src/runtime/`.

### Editor pipeline (data flow)

```
KMD source text
  → KMDParser (core/parser/Parser.ts)         # frontmatter + paragraph split
    → KMDScanner                              # tokenize each paragraph line
      → KMDCommandParser                      # parse @-chain effects (f.red.wave(...))
  → KMDParagraphData[]                        # tokens, globalEffects, blockOptions

Per paragraph render:
  KineticText.init(input)
    → LayoutPlanner / LayoutStreamBuilder     # measure + expand layout cmds → LayoutStream
      → TextLayoutEngine                      # assigns absolute x/y to each char
    → DisplayAssembler                        # materializes KineticChar + TokenWrapper into Pixi scene
  ParagraphExecutionPlan + ChainExecutionPlan
    → TextPlayer.buildTimeline()              # GSAP timeline drives char reveal, effects, stage cues

Multi-paragraph:
  ScriptPlayer
    → SegmentBuilder (scene-bake pass)        # pre-computes pData.snapshot for instant seekTo()
    → PlaybackController                      # seek / replay / behavior re-register
```

### Global singletons (module-level, not Vue-injected)

| Export          | File                                              | Purpose                                                  |
| --------------- | ------------------------------------------------- | -------------------------------------------------------- |
| `readerApp`     | `core/App.ts`                                     | Pixi `Application`, font loading                         |
| `stageManager`  | `core/stage/StageManager.ts`                      | Façade over `StageRuntime`, host session, audit          |
| `layout`        | `core/layout/LayoutEngine.ts`                     | Vertical flow accumulator, globalMarkers, scroll         |
| `parser`        | `core/parser/Parser.ts`                           | KMD parser entry point                                   |
| `scriptPlayer`  | `core/player/ScriptPlayer.ts`                     | Multi-paragraph playback + scene-baking                  |
| `effectManager` | `core/effects/EffectManager.ts`                   | Visual effect registry with mutex groups                 |
| `styleManager`  | `core/effects/StyleManager.ts`                    | Style modifier registry                                  |
| `layoutManager` | `core/layout/LayoutManager.ts`                    | Layout command expander registry                         |

### Core subsystems (`apps/editor/src/core/`)

- **`parser/`** — `Parser.ts` extracts YAML frontmatter and splits paragraphs; `KMDScanner` handles block options, `---` scene-clear, braced groups, markdown sugars (`**bold**`, `*italic*`, `# heading`), timing pipes `|`, and `>` advance signals. Commands after `@` go through `KMDCommandParser`. `ScopeRouter` / `CompatProjector` / `commandCatalog.ts` form the Phase A.R parser boundary; parsers operate against a `CommandRegistryView` rather than reaching into managers directly.
- **`layout/`** — `LayoutPlanner` does measurement and layout-stream expansion; `TextLayoutEngine` assigns coordinates; `LayoutEngine` (singleton) manages paragraph-level vertical stacking and resize. `LayoutPreflightResult` formalizes the phantom pass for forward-reference marker sync.
- **`effects/`** — `EffectManager` (visual effects with mutex groups), `StyleManager` (style modifiers), `EffectProcessor` (char/group/block application). Presets in `presets.ts`. Style/effect classification flows through typed metadata.
- **`stage/`** — `StageRuntime` owns camera/cameraOffset/buildMode/registry/apply/modifiers; `StageManager` is now a façade for host/presentation/audit/compat. Stage commands like `cam.move`, `cam.zoom`, `cam.rotate`, `scene.clear`, `pause` are registered in `stagePresets.ts`. `scene.clear` is the single runtime path for `---` (do not re-introduce `isSceneClear` displays in `SegmentBuilder`). Note: there is **no `bg` command** today — background is host-side `StageManager.setBackgroundColor` (solid color) plus an unused `backgroundLayer` container; `bg` is a planned command, see `docs/planning/ecosystem/special-commands-vocabulary-draft.md`.
- **`player/`** — `ScriptPlayer` is the façade; `SegmentBuilder` handles segment build + paragraph placement (consumes `ParagraphBuildInput`, not raw text); `PlaybackController` handles seek/replay/behavior re-register; `TextPlayer` consumes `ParagraphExecutionPlan` rather than reading semantic fields off `KineticChar` (legacy compat surface only). `ScriptSourceLoader` is the asset/source loader, constrained by `RuntimeAssetPolicy` under reader runtime.
- **`render/text/`** — Build context resolvers and `TextPlayer` execution machinery (timing cursor, stage cue scheduler, diagnostics sink).
- **`runtime/`** — Reader runtime contract, protocol envelope (`version`/`id`/`type`/`payload`), session façade (`loadSource / play / pause / seek / setTimeScale / inspect / dispose`), and host asset policy.
- **`types/`** — Shared contracts (`BaseCue`, `AnchorRef`, `ChainExecutionPlan`, `LayoutPreflightResult`, `DiagnosticEvent`, etc.). Effect/Layout/Stage command metadata typing lives here.
- **`diagnostics/` / audit bus** — Build-scope collector + runtime-scope bus that aggregates parser/layout/execution/stage diagnostics. Legacy `dumpReport()` / `camAuditLog` paths are compat wrappers.

### Vue / IDE layer (editor only)

`src/App.vue` is the shell with toolbar + dock layout. `src/store/editorStore.ts` (Pinia) holds `kmdContent`, `canvasConfig`, `timelineMarkers`, `layoutTree` (dock state persisted in localStorage), and the player reference. The dock system (`src/components/DockSystem/`) is a recursive split-pane tree with panel types `editor`, `preview`, `monitor`, `inspector`. Monaco grammar/theme/IntelliSense is driven from `packages/language` assets.

## Roadmap Authority

Do not maintain phase status, completed work summaries, or next-step lists in this file. Use `docs/planning/roadmap/implementation-roadmap.md` as the current roadmap authority, and keep phase records under `docs/planning/roadmap/`.

## Conventions

- Vue SFCs in PascalCase (`KmdEditor.vue`); stores / utilities in camelCase (`editorStore.ts`); 2-space indent, semicolons, single quotes in `.ts`.
- Do **not** extract `apps/editor/src/core/` into `packages/core/` unless the repository strategy and package plan explicitly call for it. Reader-runtime package boundary changes should be reflected in `docs/planning/packages/reader-runtime-web.md`.
- Import shared language assets via `@kmd/language`, never by reaching into `extensions/vscode-kmd/`.
- Adding new behavior:
  - Visual effects → export a `{ fn, meta }` from `core/effects/presets.ts` (auto-registers via `registerBatch`).
  - Style modifiers → register in `core/effects/StyleManager.ts`.
  - Layout commands → register an expander in `core/layout/layoutExpanders.ts`.
  - Stage commands → register in `core/stage/stagePresets.ts`.
  - Then update `KMDParser.validate()` in `core/parser/Parser.ts` if the new name must pass the known-command check.

## Docs To Read Before Changing Things

- `docs/README.md` — doc taxonomy (`planning/`, `knowledge/`, `archive/`).
- `docs/planning/roadmap/implementation-roadmap.md` — roadmap and sequencing authority; follow its links to active or historical phase records.
- `docs/planning/packages/reader-runtime-web.md` — reader package boundary and `packages/core` extraction gate.
- `docs/knowledge/integration/reader-runtime-web-bundle.md`, `android-webview-runtime-protocol.md` — before changing Android/WebView runtime integration.
- `docs/planning/ecosystem/repository-strategy.md` — when (not yet) to split packages.
- `docs/knowledge/runtime/core/command-routing.md`, `effect-pipeline.md`, `parser-pipeline.md` — before touching command routing, effects, or the parser.
- `docs/planning/TODO.md` — AI-collaboration task pool and historical execution log.

When you change command routing, effects, layout, stage, or language semantics, update the corresponding doc in the same change. Place new docs under `planning/`, `knowledge/`, or `archive/` per the rules in `docs/README.md`.

## KMD Syntax (quick reference)

```
---
mode: stage          # stage | scroll | page
designWidth: 1920
designHeight: 1080
fontFamily: Sasara Regular
---

[align=center .glitch]               # block options + global effects
{Hello} {World} @ f.red.wave  f.blue.bold
Plain text line @ .goto(0, 100)
---                                   # scene clear (fades out current text)
```

- `{...}` braced token group; maps 1:1 with effect chain slots.
- `@` separates body from commands.
- `f.effect(params)` per-token visual effect; bare `.effect` is global block effect.
- `>` / `>>` / `>>>` timing advance (char / group / block).
- `~` slow, `^` fast (line-scoped persistent speed sugars).
- `|` or `|(1s)` segment-level pause.
- `f.hold(1s)` effect-chain timing; `pause(Xs)` is a stage-level timeline pause.
- `**bold**`, `*italic*`, `# heading` are Markdown sugars; `---` is scene-clear.
