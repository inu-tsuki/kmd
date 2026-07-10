# Public 样本打包进 Community API

> 文档状态：已落地
> 最近更新：2026-07-10

## 背景

`apps/editor/public/` 下积累了大量 KMD 示例文本——通用演示和 DIP-FX 滤镜展示。这些脚本此前只在 editor dev server 下可用，Android Reader 等 community-api 消费端无法通过标准 `GET /works/:id/source` 拉取它们。

2026-07-10 将这些样本打包进 community-api 的 seed 库，让 community-api 成为示例文本的统一分发入口。

## 范围

打包了 23 个 work（community-api 总数从 4 增至 27）：

- **通用示例（4 个）**：`inquisition`、`timing-demo`（`test-timing.kmd`）、`coord-stress`（`test.kmd`）、`font-test`。
  - 跳过 `test-markdown.kmd`（无 frontmatter title，语义过薄）和 `final-test copy.kmd`（`final-test.kmd` 副本）。
- **DIP-FX 滤镜展示（19 个）**：`bloom`、`duotone`、`edge`、`emboss`、`gray`、`halftone`、`noise`、`outline`、`pixelate`、`posterize`、`scanline`、`sharpen`、`threshold`、`vignette`、`displace`、`underwater`、`dissolve`、`cyberpunk-title`、`bg`。
  - work-id = 文件名去掉 `fx-` 前缀。

## 资源依赖处理

`bg` 和 `cyberpunk-title` 引用 `bg(src="tests/assets/sample-bg.jpg")`。运行时（`stagePresets.ts:469-472`）将非 `http`/`/`/`blob:` 开头的 src 前缀 `/`，解析为 `/tests/assets/sample-bg.jpg`。

处理方式：

1. 将 `sample-bg.jpg` 复制到 `apps/community-api/content/assets/`。
2. 在 `app.ts` 加 `express.static`：`app.use('/tests/assets', express.static(path.resolve(contentRoot, 'assets')))`。

这样 community-api 在 `/tests/assets/sample-bg.jpg` serve 背景图，与 editor dev server 的路径一致，KMD 源码不需要重写。

## 约束

- 新增 work 全部用 `lifecycleStatus: published`，不撞 `app.test.ts` 中 `mode=stage & status=submitted` 恰好返回 `[glass-rail, final-test]` 的硬断言。
- sourcePath 遵循 `content/works/<id>/rev-1.kmd` 格式，在 `readKmdSource` 的 `content/` 路径沙箱内。
- stats（scenes/lines/effects）为粗略估计，仅用于展示元数据，不作为精确度量。

## 后续

- 如果 `public/` 下新增了值得分发的示例，按同样方式复制到 `content/works/` 并在 `seed.ts` 添加条目。
- 如果 community-api 未来引入真实数据库，这些 seed works 可作为初始数据导入。
- coverUrl 字段目前是占位（`/assets/covers/<id>.jpg`），与原有 4 个 work 一致；有真实封面图后再补。