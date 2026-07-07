# Language Knowledge

> 最近更新：2026-07-08

这里收纳 KMD 语言层的知识：语法、命名空间、指令语义、封装、排版表达和创作者体验。

## 入口文档

语言规范采用总-分结构，`design.md` 是唯一决议记录处，分章只写"是什么"。

- `design.md`：**总纲**——定位、五公理、词性总览、章节索引、封盘决议清单（D1–D27）。
- `chain-model.md`：链语法模型（主谓、拍、从句、实例化粒度、字面量、`$()`）。
- `selection-model.md`：选区与流模型（点/域双类型、选择器家族、围栏、flow）。
- `scope-and-lifetime.md`：作用域链、两级作用域、脚本区间生命周期、选项级联。
- `control-flow.md`：三高度 if、`#` 锚点与跳转、行内表达式、特效控制流。
- `frontmatter-schema.md`：文档级选项（frontmatter）的效力分层、字段 schema v1、解析与写回规则（D22 的展开）。
- `migration.md`：历史形态 → 新形态对照、解析器工程债清单（随实现更新）。
- `brainstorm.md`：尚未收敛、尚未实现的语言脑暴入口。
- `kmd-writing-guide.md`：基于现有 `.kmd` 样本归纳的创作守则（描述**当前已实现**语法）。

## 放置规则

- 语言设计草稿、语义讨论和 syntax proposal 放这里。
- 一旦设计进入实施阶段，对应阶段计划应写入 `../../planning/roadmap/`。
- 一旦实现稳定，运行机制应补进 `../runtime/`。
