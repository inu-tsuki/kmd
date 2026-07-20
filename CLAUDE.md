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

When working on parser, layout, effect routing, or shared runtime behavior, validate with `pnpm build` and `pnpm test` (vitest) before opening a PR. The editor test net (`apps/editor/src/test/`, vitest ^2.1.8) covers parser golden fixtures (full corpus + B0.1 syntax), layout coordinate stability, effects four-track classification, playback state-machine regression, INV-7/INV-8 invariant guards, GLSL shader compile gate, and frontmatter writeback — see `docs/planning/test-net-design-2026-07.md`. Add new regression cases as vitest tests under `src/test/`; golden files live under `src/test/__golden__/` and must be regenerated via `pnpm test:golden:write` then human-reviewed (never blind `--update`). Add sample KMD inputs under `apps/editor/public/` or `apps/editor/public/tests/`.

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
