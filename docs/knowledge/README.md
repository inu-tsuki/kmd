# Knowledge Base

> 最近更新：2026-06-16

这里放长期机制、语言设计、研究资料和维护者需要反复查阅的上下文。它回答“系统实际上如何工作，以及为什么可以这样理解”。

## 入口文档

- `runtime/core/parser-pipeline.md`：`source -> AST -> IR -> runtime` 主路径。
- `runtime/core/command-routing.md`：KMD 指令分类、路由与消费路径。
- `runtime/core/effect-pipeline.md`：特效分类、作用域和渲染应用路径。
- `architecture/work-kmd-content-model.md`：`Work` 与 `.kmd` 源文件的内容模型边界。
- `language/design.md`：语言设计探索草稿。
- `language/brainstorm.md`：Phase B 相关语言脑暴，记录未实现的候选语义。
- `architecture/MEMORY.md`：AI 协作期沉淀的全景架构记忆。
- `research/pretext.md`：外部项目调研。

## 子目录

- `language/`：语法、命名空间、指令语义、封装和创作者体验。
- `runtime/`：parser、layout、effect、stage、playback 等运行链路。
- `architecture/`：系统分层、host/runtime 边界、长期架构记忆。
- `integration/`：Android WebView、VS Code、editor shell 等宿主集成知识。
- `research/`：外部项目、论文、工具和理论参考。
- `decisions/`：后续新增 ADR，记录重要技术选择及其取舍。

## 维护规则

- 已被代码验证、需要长期维护的机制放进 `runtime/` 或 `architecture/`。
- 尚未收敛的新语法、命名空间、封装与排版想法放进 `language/`。
- 宿主接入的事实和协议放进 `integration/`，不要混进 runtime 机制文档。
- 外部项目或论文调研放进 `research/`。
- `architecture/MEMORY.md` 是协作记忆，不应单独作为最终事实来源。
