> 系统健康最大，长期痛苦最小.

# Repository Guidelines

## Project Structure & Module Organization

This repository is the KMD main incubation repo, not only the Web editor. `apps/editor/` contains the Web editor and KMD runtime: `src/components/` for Vue UI, `src/views/` for docked panels, `src/store/` for Pinia state, and `src/core/` for parser, layout, rendering, stage, and effects. Shared language assets live in `packages/language/`; editor code should import them through `@kmd/language` instead of climbing into extension folders. `packages/reader-runtime-web/` builds the reader-only WebView/browser bundle; its package boundary and extraction gates are documented under `docs/planning/packages/`. Static samples and fonts live in `apps/editor/public/`, with parser fixtures under `apps/editor/public/tests/`. Docs are classified as `docs/planning/`, `docs/knowledge/`, and `docs/archive/`; roadmap state belongs in `docs/planning/roadmap/`, not in agent instruction files. If `apps/android-reader/` exists, it is an ignored separate checkout with its own docs. The VS Code language extension is maintained in `extensions/vscode-kmd/`.

## Build, Test, and Development Commands

Use `pnpm` throughout. `dev`, `build`, `preview`, `test:parser`, `test:shaders`, `test:e2e`, and `language:check` run from the repo root (the root `package.json` proxies them). `test:playback` and `test:invariants` live in the editor package only — run them from `apps/editor/`, or from the root as `pnpm --filter @kmd/editor test:playback` / `test:invariants`.

- `pnpm dev` - start the Vite dev server for the editor.
- `pnpm build` - run `vue-tsc` type-checking, then produce a production build in `dist/`.
- `pnpm preview` - serve the built app locally for verification.
- `pnpm test:parser` - run the parser integration regression in `apps/editor/src/final-parser-test.ts`.
- `pnpm test:playback` - run the playback state-machine regression in `apps/editor/src/final-playback-test.ts` (seek/phase/resume semantics, effect lifecycle, baseline/record ownership). **Required gate for any playback, effect, timeline, or seek change.**
- `pnpm test:invariants` - run the INV-7/INV-8 structural guard in `apps/editor/src/test-invariants.ts` (no inline effect-track special-casing; no unverified boundary-behavior claims). **Required gate for any effect-routing or playback change.**
- `pnpm test:shaders` - compile every `*Filter.ts` fragment shader with `glslangValidator` (catches GLSL syntax/scope errors that `vue-tsc` cannot see). Requires `glslangValidator` on PATH.
- `pnpm test:e2e` - build the reader runtime and run Playwright Chromium against the production bundle. **Required for browser-only rendering, Pixi resource lifecycle, ticker, or WebGL integration changes.** Install the browser once with `pnpm exec playwright install chromium`.
- `pnpm language:check` - verify `@kmd/language` assets match the VS Code extension packaged copies.

### Gate requirements by change scope

| Change touches | Required gates (all must pass) |
|---|---|
| parser, layout, or shared runtime | `pnpm build` + `pnpm test:parser` |
| playback, seek, effect pipeline, timeline/easing, stage modifiers | `pnpm build` + `pnpm test:parser` + `pnpm test:playback` + `pnpm test:invariants` |
| browser rendering, Pixi resource lifecycle, ticker, or WebGL integration | also run `pnpm test:e2e` |
| any `*Filter.ts` | also run `pnpm test:shaders` (see below) |
| `@kmd/language` or VS Code extension assets | `pnpm language:check` |

`pnpm build` does not compile GLSL template strings, so it passes even when a shader fails to compile — always run the shader gate when touching any `*Filter.ts`.

## Coding Style & Naming Conventions

Write Vue SFCs and TypeScript modules with the existing style in each file: most code uses 2-space indentation, semicolons, and single quotes in `.ts` files. Name Vue components in PascalCase (`KmdEditor.vue`), stores and utilities in camelCase (`editorStore.ts`), and keep core engine folders grouped by subsystem (`parser/`, `layout/`, `effects/`). Prefer small, focused modules and update nearby docs when behavior changes are non-obvious. Do not extract `apps/editor/src/core/` into `packages/` until the repository strategy explicitly calls for runtime package extraction.

## Working Principles

These are stable, agent-actionable runtime principles. The case-by-case audit record belongs in `docs/knowledge/runtime/core/lifecycle-invariants.md`; this section keeps only the operational shortlist.

### Verify-then-write (探针先于写代码)

When a fix hinges on a behavior of an underlying library or runtime surface (GSAP, Pixi, glslang, tsx, the DOM), **verify the premise with a one-shot probe before writing production code that depends on it**. Code comments that assert runtime behavior must be probe-verified, not inferred. Run the probe in the same environment as the relevant test or production path, and record the result in the commit message or planning note.

### Construction over runtime-dedup, with a stated exception

The runtime deliberately avoids runtime dedup guards (Set/cursor/epsilon) when ownership can be established at construction time: baseline vs record, timeline segment boundaries, and shared helper outputs should make only one apply driver own any given moment. **Exception:** when two drivers share a runtime event that construction cannot separate, a minimal stateful ownership flag is the accepted escape hatch. Document the exception next to the state that implements it. Decision rule: if the trigger moments are separable at build time, fix construction; if they share one runtime event, use a narrow documented runtime flag.

### Regression must cover the full semantic surface, not just the reproducing side

When fixing a playback/effect bug, regression coverage must include both directions, every operation path that touches the affected resource, every build-time write path, and degenerate/empty cases. The playback regression suite is the persistence layer for this; new fixes should add focused cases there instead of only covering the side that reproduced.

### Do not let the test harness mask production behavior

Test harnesses can hide production behavior, especially around tickers, schedulers, timers, browser APIs, and mocked loaders. When a fix targets such behavior, the suite may only be able to verify the *mechanism* rather than the *fired outcome*. Document that limit honestly in the test, and use a real-environment probe for any load-bearing library assumption.

### Resolve effect parameters once at build time, share across both apply paths

When a resource has two apply paths, such as natural play and seek replay, both must consume the **same pre-resolved parameters**. Resolve variable references and fallback-sensitive numeric fields once at build time, store the result in the record, and replay that object on both paths. Do not let one path re-resolve at runtime with a different fallback convention; fallback values must stay single-sourced or the two paths will diverge.

## Testing Guidelines

There is no full unit-test suite or coverage gate yet. Add regression-oriented TypeScript scripts alongside the current parser tests when fixing engine bugs, and keep sample KMD inputs in `apps/editor/public/` or `apps/editor/public/tests/` when they help reproduce issues. Name ad hoc test files clearly, for example `test-variable-parser.ts` or `final-parser-test.ts`. GLSL fragment shaders in `*Filter.ts` are validated by `pnpm test:shaders` (glslangValidator); `vue-tsc` does not compile GLSL template strings, so shader syntax/scope errors (e.g. nested function definitions, which GLSL ES 3.00 forbids) are invisible to `pnpm build` — always run the shader gate when touching filters.

## Documentation & Architecture Notes

Before changing command routing or the effect pipeline, read `docs/knowledge/runtime/core/command-routing.md` and `docs/knowledge/runtime/core/effect-pipeline.md`. Before changing timeline/animation/easing behavior, read `docs/knowledge/runtime/core/timeline-and-easing.md`. Before changing repository layout, Android Reader integration, or package boundaries, read `docs/planning/ecosystem/repository-strategy.md`, the relevant package plan under `docs/planning/packages/`, and the relevant integration authority under `docs/knowledge/integration/`. For current phase and sequencing, read `docs/planning/roadmap/implementation-roadmap.md` instead of copying roadmap state into this file. If you add new commands, effects, layout behavior, or repository-level conventions, update the corresponding doc in the same change and place it under `planning/`, `knowledge/`, or `archive/` according to `docs/README.md`.

将这一机制推广到整个`docs/`中。当认为某一改动、举措或错误尝试值得记录，在`docs/`中管理它们。
