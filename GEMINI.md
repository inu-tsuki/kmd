# KMD - Kinetic Markdown Context

## Project Overview

**kmd** 是 Kinetic Markdown (KMD) 的主孵化仓库，当前同时承载 Web 编辑器、核心 runtime、VS Code 扩展与 Android Reader 规划。

*   **Core Engine:** Parser、layout、effect、stage 与 Pixi.js (v8) GPU 渲染桥接。
*   **Animation System:** GSAP 深度驱动动画生命周期。
*   **Framework:** Vue 3 + TypeScript for the current Web editor host.
*   **Version:** **v1.6.0 (Time Lord - Under Development)** - 正在实现全时序驱动架构、语义溯源与热重载跳转。

## Context Maintenance Protocol

1.  **Strict Context Alignment**: 每次执行 Directives 前，必须先读取 `docs/ai/TODO.md` 和 `docs/ai/MEMORY.md` 以确保任务对齐。
2.  **Autonomous Update**: 
    - 任务完成后，必须主动更新 `docs/ai/TODO.md` 的状态（勾选已完成项）。
    - 涉及架构变更或新功能实现后，必须同步更新 `docs/ai/MEMORY.md`。
3.  **Source of Truth**: `GEMINI.md` 与 `docs/ai/*` 共同构成最高优先级的指令来源。

## Kinetic Markdown (KMD) Syntax

一个标准的 KMD 段落包含：
1.  **Front Matter:** YAML 配置。支持 `designWidth/Height`、`speed` 及自定义 `var` 变量。
2.  **Paragraph Block:** `[Block Options] Body @ Commands`
3.  **Rhythm Standard (v1.1.0):**
    *   **\*\*Bold\*\*:** 重音强调。自动解糖为 `bold` 样式 + `slow` 节奏。
    *   **\*Italic\*:** 轻声私语。自动解糖为 `thin` + `dim` 样式 + `fast` 节奏。
    *   **# Heading:** 特殊身份/字体。为全行应用 `special` 样式预设。
    *   **---**: 情境转场。强制清屏并等待 0.5s。
4.  **Control Sugars:**
    *   **! (Wait):** 强制同步等待当前演出。
    *   **| (Pause):** 行内停顿，支持 `|(1s)` 显式传参。
    *   **> / >> / >>>**: 独立时序控制。分别对应“字符级 Go”、“行级 Go”、“段落级 Go”。
    *   **~ / ^**: 持久化语速调节（慢速/快速）。作用于当前行，换行重置。

## Architecture & Pipeline (v1.1.5)

### 1. 核心管线 (The Pipeline)
1.  **Scanner (KMDScanner):** 线性扫描识别 Sugar Token。
2.  **Layout Oracle (TextLayoutEngine):** 基于 **Baseline V2** 的坐标图预计算。
3.  **Director (ScriptPlayer):** 全局生命周期管理，支持 `stage/scroll/page` 三种模式。
4.  **Performance (KineticText):** 核心播放逻辑，集成了**双层级持久化速度状态机**。

### 2. 智能编辑器系统 (v1.1.5)
*   **Monarch Highlighting**: 深度定制的语法着色，支持转义符、命名空间 (`cam.`, `f.`)、节奏糖和 YAML 头文件。
*   **IntelliSense**: 监听 `.`, `f.`, `cam.`, `@`, `:` 等触发符。支持从 Manager 注册表实时提取补全项。
*   **Diagnostics**: 实时静态语法校验，对未知指令、非法变量引用提供红波浪线标注。

## Development

### Key Commands
```bash
pnpm dev      # 启动开发环境
npm run test:parser  # 运行解析器测试
npx vue-tsc -b  # 项目级类型检查
