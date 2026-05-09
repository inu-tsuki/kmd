# Repository Guidelines

## Project Structure & Module Organization

This repository is the KMD main incubation repo, not only the Web editor. `src/` contains the current Web editor and KMD runtime: `components/` for Vue UI, `views/` for docked panels, `store/` for Pinia state, and `core/` for parser, layout, rendering, stage, and effects. Static samples and fonts live in `public/`, with parser fixtures under `public/tests/`. Design notes and architecture docs are in `docs/`; Android Reader planning lives in `docs/android-reader/`. The VS Code language extension is maintained in `extensions/vscode-kmd/`.

## Build, Test, and Development Commands

Use `pnpm` throughout.

- `pnpm dev` - start the Vite dev server for the editor.
- `pnpm build` - run `vue-tsc` type-checking, then produce a production build in `dist/`.
- `pnpm preview` - serve the built app locally for verification.
- `pnpm test:parser` - run the parser integration regression in `src/final-parser-test.ts`.

When working on parser, layout, effect routing, or shared runtime behavior, validate with `pnpm build` and `pnpm test:parser` before opening a PR.

## Coding Style & Naming Conventions

Write Vue SFCs and TypeScript modules with the existing style in each file: most code uses 2-space indentation, semicolons, and single quotes in `.ts` files. Name Vue components in PascalCase (`KmdEditor.vue`), stores and utilities in camelCase (`editorStore.ts`), and keep core engine folders grouped by subsystem (`parser/`, `layout/`, `effects/`). Prefer small, focused modules and update nearby docs when behavior changes are non-obvious. Avoid large directory moves until the repository strategy explicitly calls for `apps/` and `packages/`.

## Testing Guidelines

There is no full unit-test suite or coverage gate yet. Add regression-oriented TypeScript scripts alongside the current parser tests when fixing engine bugs, and keep sample KMD inputs in `public/` or `public/tests/` when they help reproduce issues. Name ad hoc test files clearly, for example `test-variable-parser.ts` or `final-parser-test.ts`.

## Documentation & Architecture Notes

Before changing command routing or the effect pipeline, read `docs/core/command-routing.md` and `docs/core/effect-pipeline.md`. Before changing repository layout, Android Reader integration, or package boundaries, read `docs/repository-strategy.md`. If you add new commands, effects, layout behavior, or repository-level conventions, update the corresponding doc in the same change.

将这一机制推广到整个`docs/`中。当认为某一改动、举措或错误尝试值得记录，在`docs/`中管理它们。
