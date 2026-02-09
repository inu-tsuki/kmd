# Project Memory: Kinetic Typography Engine (KMD)

> **Goal:** 构建一个高性能、插件化、支持复杂排版、艺术化演出和交互式阅读的 KMD 渲染引擎。
> **Stack:** Vue 3 + TypeScript + PixiJS v8 + GSAP

---

## 1. 核心设计哲学 (Core Philosophy)

1.  **文字即演员 (Text as Actor):** 文字拥有物理属性（位置、速度、震动、颜色、滤镜）的实体。
2.  **所见即所读 (WYSIWYR):** 演出指令深度内嵌于文本流，节奏与语义高度统一。
3.  **文学直觉排版 (Literary Intuition):** 定位算子 (`prev`, `next`, `line`) 遵循创作者对“文字盒子”的感知，而非物理像素。
4.  **全异步导演系统 (Director System):** [v0.9.0] 指令执行移至播放期，支持复杂的动画等待、信号分流与节奏控制。

---

## 2. 架构演进历程 (Version History)

### v0.9.0 - v1.0.0: 奠基、预言机与原子演出
*   **异步管线**: 确立了 `init -> applyEffects -> play` 的三相生命周期。
*   **Oracle Pass**: 引入双通扫描（Phantom Pass），使脚本能超前引用 `next.*` 点位。
*   **全知坐标系**: 确立以 `(960, 540)` 为原点的中心化设计空间。

### v1.1.0: 韵律标准与生产级表现
*   **Rhythm Standard**: 引入基于 MD 的韵律语法（`**` 加粗, `*` 轻声, `#` 特殊样式）。
*   **Baseline V2**: 彻底重构排版基准，实现了基于物理 `ascent` 的动态锚点对齐。
*   **Production Font System**: 使用原生 `FontFace` API 解决了 CJK 字体加载竞赛与匹配问题。

### v1.1.5: 智能编辑器与持久化节奏 (Latest)
*   **Intelligent Editor**: 深度集成 Monaco Editor，实现了上下文感知的 Monarch 语法高亮与 IntelliSense。支持命名空间 (`cam.`, `f.`) 过滤、层级后缀 (`:char/group`) 补全以及实时语法错误诊断。
*   **Persistent Rhythm**: 重新设计了播放引擎的速度状态机。实现了行级持久化 (`~`/`^` 增速在下一行自动重置) 与组级持久化 (`:group` 增速在 Token 播放完后自动重置)，解决了旧版本中速度糖衣无限累加的逻辑缺陷。
*   **UX Optimization**: 针对 CJK 环境优化了 Unicode 歧义字符高亮设置，提升了中文创作体验。

---

## 3. 技术栈演进对照表

| 功能模块 | v1.1.0 | v1.1.5 (Latest) |
| :--- | :--- | :--- |
| **编辑器** | 基础文本输入 | **Monaco + 上下文感知高亮/补全/诊断** |
| **节奏逻辑** | 逐字单次应用 (易累加) | **双层级持久化速度状态机 (自动重置)** |
| **指令验证** | 仅运行时校验 | **实时静态扫描 + 全指令集验证** |
| **命名空间支持** | 仅解析器支持 | **编辑器全链路高亮、补全、校验支持** |

---

## 4. 关键技术突破 (Milestones)

### 4.1 命名空间感知的 IntelliSense
1.1.5 引入。通过对 `EffectManager`、`StageManager` 等注册表的深度映射，编辑器现在能识别 `cam.move` 与 `f.red` 的区别，并在输入 `cam.` 或 `f.` 时提供精确的过滤建议。

### 4.2 双层级持久化速度系统
针对 KMD 独特的“文字流即脚本”特性，1.1.5 实现了速度因子的堆栈式管理。单字级 sugar 作用于当前行，而组级指令作用于当前 Token，确保了演出的节奏既能灵活多变，又能在逻辑边界处准时恢复。

---
*Last Updated: 2026-02-05*
