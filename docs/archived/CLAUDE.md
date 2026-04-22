# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
pnpm dev        # Start Vite dev server
pnpm build      # Type-check (vue-tsc) then build for production
pnpm preview    # Preview production build
pnpm test:parser  # Run parser integration test (src/final-parser-test.ts via tsx)
```

Package manager is **pnpm**. There is no lint script configured.

## Architecture Overview

KMD Editor is a Vue 3 + Pixi.js v8 SPA for authoring and previewing **Kinetic Markdown (KMD)** — a custom markup language for animated, GPU-accelerated text displays.

### Data Flow

```
KMD source text
  → KMDParser (Parser.ts)               # splits into paragraphs + metadata
    → KMDScanner (KMDScanner.ts)        # tokenizes each paragraph line-by-line
      → KMDCommandParser                # parses @-chain effects like f.red.wave(amp=5)
  → KMDParagraphData[]                  # tokens, globalEffects, blockOptions

Per paragraph rendering:
  KineticText.init(kmdString)
    → TextBuilder.build()
      → LayoutStreamBuilder.build()     # tokens → LayoutStream (chars + layout cmds)
        → TextLayoutEngine.calculate()  # assigns absolute x/y to each char
      → creates KineticChar + TokenWrapper objects in Pixi scene graph
    → TextPlayer.play()                 # animates chars sequentially, processes sugars & effects
```

### Global Singletons

All are module-level singletons, not Vue-injected:

| Export          | File                                | Purpose                                                      |
| --------------- | ----------------------------------- | ------------------------------------------------------------ |
| `readerApp`     | `src/core/App.ts`                   | Pixi `Application`, font loading                             |
| `stageManager`  | `src/core/stage/StageManager.ts`    | Camera (x/y/zoom/rotation), layers, fixed-ratio letterboxing |
| `layout`        | `src/core/layout/LayoutEngine.ts`   | Vertical flow accumulator, global markers, scroll            |
| `parser`        | `src/core/parser/Parser.ts`         | KMD parser entry point                                       |
| `scriptPlayer`  | `src/core/player/ScriptPlayer.ts`   | Multi-paragraph playback + scene-baking                      |
| `effectManager` | `src/core/effects/EffectManager.ts` | Visual effect registry with mutex groups                     |
| `styleManager`  | `src/core/effects/StyleManager.ts`  | Style modifier registry                                      |
| `layoutManager` | `src/core/layout/LayoutManager.ts`  | Layout command expander registry                             |

### Core Subsystems

**Parser** (`src/core/parser/`): `KMDParser.parse()` extracts YAML frontmatter, splits on blank lines into paragraphs, and calls `KMDScanner.scan()` on each. The scanner handles `[block options]`, `---` scene-clear, `{braced groups}`, markdown sugar (`**bold**`, `*italic*`, `# heading`), timing pipes `|`, and `>` advance signals. Commands after `@` are parsed by `KMDCommandParser` into effect chains. Key types are in `types.ts`.

**Rendering** (`src/core/KineticText.ts`, `src/core/render/text/`): `KineticText extends Container` is the top-level Pixi object for one paragraph. `TextBuilder` converts KMD text to positioned `KineticChar` objects. `TextPlayer` drives character-by-character reveal with timing, applying visual effects via `EffectProcessor` and stage instructions via `stageManager`.

**Layout** (`src/core/layout/`): `LayoutStreamBuilder` measures character widths and expands layout instructions (e.g. `goto`, `left(0.5self)`) into pre/post `LayoutCommand`s. `TextLayoutEngine` processes the stream to compute final coordinates. `LayoutEngine` (`layout` singleton) manages paragraph-level vertical stacking and responsive reflow on resize.

**Effects** (`src/core/effects/`): `EffectManager` holds a registry of named effects (shake, wave, pulse, glitch, rgbShift, etc. defined in `presets.ts`) with mutex group enforcement. `StyleManager` handles style modifiers (red, bold, dim, etc.). `EffectProcessor` is the utility that applies effects at char/group/block scope.

**Stage** (`src/core/stage/`): `StageManager` owns the Pixi world container hierarchy (`backgroundLayer` → `contentLayer` → `uiLayer`) and applies camera transforms (scale + letterbox) in `stage` mode. Stage commands like `cam.move`, `cam.zoom`, `bg` are registered in `stagePresets.ts`.

**Playback** (`src/core/player/ScriptPlayer.ts`): On `load()`, runs a **scene-baking** pass — instantiates each `KineticText` with `isWarping=true` to pre-compute timing markers and state snapshots (`pData.snapshot`) for instant `seekTo()`. During live playback, `present()` uses a measure phase → position phase → rebuild phase pattern before calling `kt.play()`.

**Vue / IDE Layer**: `src/App.vue` is the shell with toolbar + dock layout. `src/store/editorStore.ts` (Pinia) holds `kmdContent`, `canvasConfig`, `timelineMarkers`, `layoutTree` (dock state persisted in localStorage), and player reference. The dock system (`src/components/DockSystem/`) is a recursive split-pane tree with four panel types: `editor`, `preview`, `monitor`, `inspector`.

### KMD Syntax Reference

```
---
mode: stage          # stage | scroll | page
designWidth: 1920
designHeight: 1080
fontFamily: Sasara Regular
---

[align=center .glitch]               # Block options + global effects
{Hello} {World} @ f.red.wave  f.blue.bold  # Two braced groups, two effect chains
Plain text line @ .goto(0, 100)      # Layout instruction
Scene clear ↓
---
```

- `{...}` — braced token group; maps 1:1 with effect chain slots
- `@` — separates body from commands
- `f.effect(params)` — visual effect on token; `.effect` — global block effect
- `>` / `>>` / `>>>` — timing advance (char / group / block level)
- `~` slow, `^` fast — speed sugars
- `|` or `|(1s)` — segment-level pause (timeline timing)
- `f.hold(1s)` — effect-chain timing (hold state Xs before next effect)
- `pause(Xs)` — stage command for timeline pause
- `**bold**`, `*italic*`, `# heading` — Markdown sugars
- `---` — scene clear (fade out current text)

### Fonts

Custom fonts live in `public/fonts/`. To add a font, register it in `src/core/App.ts` inside `loadFonts()`. The default font family is `"Sasara Regular"`. The dev server auto-loads `/final-test.kmd` from `public/` on startup.

### Command Routing & Effect Pipeline

The `@` command routing system has three prefix types (`f.`, `.`, bare name) mapped to three scopes (token, line, paragraph). This is the most common source of bugs. **Before modifying parser or layout code, read:**

- `docs/core/command-routing.md` — How `@` commands are classified, routed, and consumed. Includes the `lineScope` mechanism and five documented pitfalls.
- `docs/core/effect-pipeline.md` — How `EffectConfig` flows through partition → buildTimeline → apply. Explains `targetType` guards and the four-track classification.

**When fixing bugs in these areas, update the relevant doc's pitfall section.**

### Adding New Effects

- **Visual effects**: Export a `{ fn, meta }` object from `src/core/effects/presets.ts` — it auto-registers via `EffectManager.registerBatch(Presets)`.
- **Style modifiers**: Register in `src/core/effects/StyleManager.ts`.
- **Layout commands**: Register an expander in `src/core/layout/layoutExpanders.ts` via `layoutManager`.
- **Stage commands**: Register in `src/core/stage/stagePresets.ts` via `stageManager.register()`.
- After adding, update `KMDParser.validate()` in `Parser.ts` if the new name needs to pass the known-command check.
