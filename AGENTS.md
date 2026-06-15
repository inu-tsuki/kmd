> 系统健康最大，长期痛苦最小.

# Repository Guidelines

## Project Structure & Module Organization

This repository is the KMD main incubation repo, not only the Web editor. `apps/editor/` contains the Web editor and KMD runtime: `src/components/` for Vue UI, `src/views/` for docked panels, `src/store/` for Pinia state, and `src/core/` for parser, layout, rendering, stage, and effects. Shared language assets live in `packages/language/`; editor code should import them through `@kmd/language` instead of climbing into extension folders. `packages/reader-runtime-web/` builds the reader-only WebView/browser bundle; its package boundary and extraction gates are documented under `docs/planning/packages/`. Static samples and fonts live in `apps/editor/public/`, with parser fixtures under `apps/editor/public/tests/`. Docs are classified as `docs/planning/`, `docs/knowledge/`, and `docs/archive/`; roadmap state belongs in `docs/planning/roadmap/`, not in agent instruction files. If `apps/android-reader/` exists, it is an ignored separate checkout with its own docs. The VS Code language extension is maintained in `extensions/vscode-kmd/`.

## Build, Test, and Development Commands

Use `pnpm` throughout.

- `pnpm dev` - start the Vite dev server for the editor.
- `pnpm build` - run `vue-tsc` type-checking, then produce a production build in `dist/`.
- `pnpm preview` - serve the built app locally for verification.
- `pnpm test:parser` - run the parser integration regression in `apps/editor/src/final-parser-test.ts`.
- `pnpm language:check` - verify `@kmd/language` assets match the VS Code extension packaged copies.

When working on parser, layout, effect routing, or shared runtime behavior, validate with `pnpm build` and `pnpm test:parser` before opening a PR.

## Coding Style & Naming Conventions

Write Vue SFCs and TypeScript modules with the existing style in each file: most code uses 2-space indentation, semicolons, and single quotes in `.ts` files. Name Vue components in PascalCase (`KmdEditor.vue`), stores and utilities in camelCase (`editorStore.ts`), and keep core engine folders grouped by subsystem (`parser/`, `layout/`, `effects/`). Prefer small, focused modules and update nearby docs when behavior changes are non-obvious. Do not extract `apps/editor/src/core/` into `packages/` until the repository strategy explicitly calls for runtime package extraction.

## Testing Guidelines

There is no full unit-test suite or coverage gate yet. Add regression-oriented TypeScript scripts alongside the current parser tests when fixing engine bugs, and keep sample KMD inputs in `apps/editor/public/` or `apps/editor/public/tests/` when they help reproduce issues. Name ad hoc test files clearly, for example `test-variable-parser.ts` or `final-parser-test.ts`.

## Documentation & Architecture Notes

Before changing command routing or the effect pipeline, read `docs/knowledge/runtime/core/command-routing.md` and `docs/knowledge/runtime/core/effect-pipeline.md`. Before changing repository layout, Android Reader integration, or package boundaries, read `docs/planning/ecosystem/repository-strategy.md`, the relevant package plan under `docs/planning/packages/`, and the relevant integration authority under `docs/knowledge/integration/`. For current phase and sequencing, read `docs/planning/roadmap/implementation-roadmap.md` instead of copying roadmap state into this file. If you add new commands, effects, layout behavior, or repository-level conventions, update the corresponding doc in the same change and place it under `planning/`, `knowledge/`, or `archive/` according to `docs/README.md`.

将这一机制推广到整个`docs/`中。当认为某一改动、举措或错误尝试值得记录，在`docs/`中管理它们。
