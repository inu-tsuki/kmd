# DIP Filter PR — Review Entry Point

> 状态：Active（审查入口 / 可复用清单）
> 最近更新：2026-06-13
> 代号：DIP-FX
> 配套：实现规格 `editor-dip-effect-library-spec.md`，纲领 `editor-dip-effect-library.md`

本文件是 DIP 滤镜 PR 的**审查入口**：每个新滤镜 PR 来时，从这里逐条过。它是 spec §6 的权威副本——spec §6 只指回本文件，避免两处维护。条目改动以本文件为准。

## 用法

1. 对照 PR 的 diff 与示例 KMD（`public/tests/fx-<name>.kmd`），逐条勾。
2. 任一 **[阻断]** 项不过 → 打回，附本文件对应行号与 spec 章节。
3. **[观感]** 项不过 → 评论但不必阻断，留作者判断。
4. 过完清单后跑一次 spec §5 验收（`pnpm build` + `pnpm dev` 实测）。

## A. Pixi v8 Filter 契约 [阻断]

- [ ] GLSL 用 `#version 300 es` + `defaultFilterVert`，未自写顶点着色器。
- [ ] uniform 经 `super({ resources: { filterUniforms: {...} } })` 声明，类型串正确（`f32` / `vec2<f32>` / `vec3<f32>`）。
- [ ] uniform 经 getter/setter 暴露，`fn` 通过它写值，未直接改 `resources` 内部结构。
- [ ] filter 经 `target.filters = [...(target.filters||[]), f]` 追加，未直接覆盖既有 filters 数组。

## B. 算法正确性 [阻断]

- [ ] 邻域/卷积滤镜（sharpen/emboss/edge/bloom/outline/displace）设了 `filter.padding`，缩放画布/字号后边缘无透明截断。
- [ ] 颜色/点运算（gray/threshold/posterize/duotone/...）正确处理预乘 alpha（`c.rgb/max(c.a,1e-4)` 再写回乘 alpha），半透明字上无暗边。
- [ ] 量化类防除零（posterize `levels≥2`）；采样类边界 clamp。

## C. 时间轨与生命周期 [阻断]

- [ ] 动画滤镜走 `addModifier('behavior', …)` 驱动 uniform，**未**自建 `requestAnimationFrame`/Ticker。
- [ ] 用了 `addModifier` 或假定 KineticChar 的实现，有 `instanceof KineticChar` 守卫 + 非匹配 `console.warn` 后 return。
- [ ] 动画类 `seek`/重播后正确重启（behavior track 由 `registerBehaviors` 重注册，无残留状态）。

## D. 元数据与作用域（§1.1）[阻断]

- [ ] meta：`type:"filter"`；`track` 与“是否逐帧动画”一致（动画 `behavior`，静态 `instant`）；`mutexGroup` 命名 `filter_*`。
- [ ] `targetType` 取 `both`（或 `char`）。**不要**为“整段/全屏”臆造 `block`/`frame` 取值——作用域是 `level` 路由的事，不是 `targetType` 的事。
- [ ] 作用域语义自洽：邻域/连续区域类（bloom/halftone/vignette/scanline）示例用 `[.x:block]` 验证，而非 group/char；做成只在 char 生效视为作用域错配。
- [ ] **未碰 frame/镜头路径**：本批 PR 不应改 `StageRuntime`/`StageManager` 去塞 filters（那是 spec §7.1 / 概览 §9 的未来项）。若 PR 这么做，打回并引导到“`StagePostProcess` 兄弟模块”方案。

## E. 注册与集成 [阻断]

- [ ] preset 在 `presets/filter.ts` 导出 `{ fn, meta }`（新分类文件须在 `presets/index.ts` 加 `export *`）。
- [ ] **未**改 `Parser.validate()` 加白名单——命令经注册表自动 known（spec §1 纠正 1）；`f.<name>` 不再报 `Unknown command`。
- [ ] 参数全部 `params.x ?? <默认>`，缺参出合理画面，默认值与 spec 卡一致。

## F. 交付物 [阻断]

- [ ] 示例 KMD 落 `apps/editor/public/tests/fx-<name>.kmd`，覆盖默认 / 改参 / 与一个 behavior 组合（`f.<name>.wave`）三例。
- [ ] `pnpm build` 通过（vue-tsc 无新增错误）。
- [ ] effect-pipeline.md 同步补该滤镜行；首次新增 filter 分类时一并订正 `presets.ts`→`presets/` 表述。

## G. 观感与质量 [观感]

- [ ] 与既有 behavior（wave/shake/rainbow）组合无互斥误杀（除非 mutexGroup 有意约束）。
- [ ] 参数极值（size 很大、strength=0、progress=1）下画面不崩、不全黑/全白。
- [ ] 命名、注释密度、文件风格与 `RGBSplitFilter.ts` / `presets/filter.ts` 一致。
