# KMD Editor - Kinetic Markdown Context

## Project Overview

**kmd-editor** 是一个针对 **Kinetic Markdown (KMD)** 的演出级渲染引擎。

*   **Core Engine:** Pixi.js (v8) GPU 加速渲染。
*   **Animation System:** GSAP 深度驱动动画生命周期。
*   **Framework:** Vue 3 + TypeScript。
*   **Version:** **v1.1.5 (Intelligent Edition)** - 实现了智能 Monaco 编辑器集成、实时诊断与持久化节奏系统。

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
npm run test:parser  # 运行集成测试
npx vue-tsc -b  # 项目级类型检查
```
