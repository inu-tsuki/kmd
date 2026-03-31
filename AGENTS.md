# Repository Guidelines

## Project Structure & Module Organization

`src/` contains the app code: `components/` for Vue UI, `views/` for docked panels, `store/` for Pinia state, and `core/` for the KMD engine (parser, layout, rendering, stage, and effects). Static samples and fonts live in `public/`, with parser fixtures under `public/tests/`. Design notes and architecture docs are in `docs/`, especially `docs/core/` for command routing and effect flow. The VS Code language extension is maintained in `extensions/vscode-kmd/`.

## Build, Test, and Development Commands

Use `pnpm` throughout.

- `pnpm dev` - start the Vite dev server for the editor.
- `pnpm build` - run `vue-tsc` type-checking, then produce a production build in `dist/`.
- `pnpm preview` - serve the built app locally for verification.
- `pnpm test:parser` - run the parser integration regression in `src/final-parser-test.ts`.

When working on parser, layout, or effect routing, validate with `pnpm build` and `pnpm test:parser` before opening a PR.

## Coding Style & Naming Conventions

Write Vue SFCs and TypeScript modules with the existing style in each file: most code uses 2-space indentation, semicolons, and single quotes in `.ts` files. Name Vue components in PascalCase (`KmdEditor.vue`), stores and utilities in camelCase (`editorStore.ts`), and keep core engine folders grouped by subsystem (`parser/`, `layout/`, `effects/`). Prefer small, focused modules and update nearby docs when behavior changes are non-obvious.

## Testing Guidelines

There is no full unit-test suite or coverage gate yet. Add regression-oriented TypeScript scripts alongside the current parser tests when fixing engine bugs, and keep sample KMD inputs in `public/` or `public/tests/` when they help reproduce issues. Name ad hoc test files clearly, for example `test-variable-parser.ts` or `final-parser-test.ts`.

## Commit & Pull Request Guidelines

Recent history follows short Conventional Commit prefixes such as `feat:` plus a concise description; continue that pattern for `fix:`, `docs:`, and `refactor:` changes. Keep commits scoped to one concern. PRs should explain user-visible impact, list verification commands, link related issues, and include screenshots or GIFs for editor/UI changes. For parser or playback changes, include the KMD sample used to verify the behavior.

## Documentation & Architecture Notes

Before changing command routing or the effect pipeline, read `docs/core/command-routing.md` and `docs/core/effect-pipeline.md`. If you add new commands, effects, or layout behavior, update the corresponding doc in the same change.
