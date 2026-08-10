# 物理抽出私有 @kmd/core，但不冻结公共 API

- 日期：2026-08-10
- 状态：已采纳
- 取代：`2026-07-20-reader-runtime-reexport-not-core-package.md` 的物理位置决策

## 背景

`apps/editor/src/core/` 同时被 Web editor 与 `@kmd/reader-runtime-web` 消费。Phase R 期间选择相对路径复用，是为了避免在 Phase B 前把不稳定的 parser / execution / segment API 误包装成已稳定的公共包。

此后 Android artifact/WebView smoke、reader hot path 去 editor-shell 依赖、语言设计收敛均已完成。继续把共享 runtime 放在 editor 目录下，会让所有权和依赖方向与事实不符；reader 还必须借用 editor 的 TypeScript/Vite 工具链。

## 决策

将 parser、layout、effects、filters、stage、render、player、state、diagnostics 与 runtime contract 物理迁入 `packages/core/src/`，建立 private workspace 包 `@kmd/core`。

- `@kmd/core` 直接声明 `gsap`、`pixi.js`、`zod` 运行依赖，并拥有独立 TypeScript 门禁。
- editor 与 reader 通过 workspace package import 消费 core；reader 拥有自己的 TypeScript/Vite 开发依赖。
- Monaco/TextMate 适配器迁到 `apps/editor/src/editor/`，不得进入 core 闭包。
- `scripts/check-core-boundary.mjs` 阻止 core 导入 Vue、Pinia、Monaco、TextMate、Oniguruma，阻止相对路径逃逸，并禁止恢复 `apps/editor/src/core` 第二事实源。
- 包保持 `private: true`。深层 exports 仅服务 monorepo 迁移与 Phase B 开发，不承诺 semver 稳定性，不发布 npm。

## 取舍

收益是物理目录、依赖所有权和实际复用关系一致；editor 与 reader 不再通过跨应用相对路径共享实现，独立 typecheck 能直接验证 core 边界。

代价是 Phase B 改动仍会触及多个 workspace 消费者，且当前深层 import surface 较宽。该代价被明确记为“内部 API 可变”，不通过虚假的版本稳定承诺掩盖。

## 不变量与门禁

- 单一 core 真相源：仅 `packages/core/src/`。
- reader hot path 不含 editor-only 依赖。
- `pnpm core:check`、`pnpm build`、`pnpm test`、`pnpm reader:build` 共同守护物理边界、类型、行为与 bundle。
- Phase B 可以自由重构内部 exports；独立发布必须另立 ADR，并重新审查 API、session ownership、host boundary 与 semver 策略。
