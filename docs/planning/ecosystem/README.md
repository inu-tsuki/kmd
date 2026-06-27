# Ecosystem Planning

> 最近更新：2026-06-16

这里放跨包、跨应用的 KMD 生态编排策略。它回答“这些仓库、包、应用如何一起演进”。

## 入口文档

- `repository-strategy.md`：KMD 主仓库、本地目录、Android Reader 协作和未来拆分策略。
- `documentation-architecture-refactor-plan.md`：文档信息架构重构计划，目标是单一权威来源、索引瘦身和 planning / knowledge 边界收口。
- `work-presentation-generation-draft.md`：`.kmd revision -> Work.presentation` 生态生成链草案，当前不作为 Android Reader 近期任务。
- `presentation-modes-and-capability-layering-draft.md`：多形态输出下的能力分层、“stage” 命名碰撞、镜头系统插件化方向草案（初步想法，未立项）。
- `reading-experience-vision-draft.md`：KMD 阅读体验愿景与多场景（字幕/提词器/阅读器/叙事）初步规划，背景作一等表面、亮度/模糊为可读性（草案，未立项）。
- `special-commands-vocabulary-draft.md`：舞台/特殊指令（cam.*/scene/pause/bg/未来音频转场）的词汇表与路线图——该有哪些演出级指令、现状 vs 规划、命名约定（草案，未立项）。

## 放置规则

- 影响多个包和应用的目录策略、发布策略、仓库命名、协作边界放这里。
- 只影响单个包的计划放 `../packages/`。
- 只影响单个应用的计划放 `../apps/`。
