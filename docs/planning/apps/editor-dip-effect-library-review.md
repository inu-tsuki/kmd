# DIP Filter PR — Review Entry Point

> 状态：Active（审查入口 / 可复用清单）
> 最近更新：2026-06-25（M1 首审：A 节加 shader 编译门禁，D 节加色调类双示/叠加-vs-替换）
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
- [ ] **vec3/vec4 uniform 值用 `Float32Array`，不是 `{x,y,z}` 对象**（!!! M1 血泪：Pixi v8 `UNIFORM_TO_SINGLE_SETTERS` 对 vec3/vec4 用数组索引 `v[0],v[1],v[2]`，`{x,y,z}` 的 `v[0]`=undefined→0→颜色全变黑色）。`vec2<f32>` 走另一条路径用 `v.x/v.y`，`{x,y}` 能用但建议统一 Float32Array。`hexToVec3` 已返回 Float32Array。
- [ ] uniform 经 getter/setter 暴露，`fn` 通过它写值，未直接改 `resources` 内部结构。
- [ ] filter 经 `target.filters = [...(target.filters||[]), f]` 追加，未直接覆盖既有 filters 数组。
- [ ] **shader 实际能编译**（!!! M1 血泪：`pnpm build` 不编译 GLSL 字符串，门禁对 shader 语法/作用域错失明——edge 把 `luma()` 定义在 `main()` 内部带着编译错误合并过）。检验任一即可：① 自动化门禁 `pnpm test:shaders`（glslangValidator / glslang-wasm 编译每个 fragment）；② 本地 `dtoplak.vscode-glsllint` 扩展（shader 顶部 `#pragma vscode_glsllint_stage: frag` 已就位，装扩展 + glslangValidator 即边写边红波浪线）；③ 至少 `pnpm dev` 实跑该滤镜并确认 console 无 WebGL 编译错误。**常见雷：GLSL 禁止函数嵌套定义——辅助函数（luma 等）一律放文件作用域。**

## B. 算法正确性 [阻断]

- [ ] 邻域/卷积滤镜（sharpen/emboss/edge/bloom/outline/displace）设了 `filter.padding`，缩放画布/字号后边缘无透明截断。
- [ ] 颜色/点运算（gray/threshold/posterize/duotone/...）正确处理预乘 alpha（`c.rgb/max(c.a,1e-4)` 再写回乘 alpha），半透明字上无暗边。
  - **安全去预乘**（M1 血泪：`c.rgb/max(c.a,1e-4)` 在抗锯齿边缘 a≈0.001 时颜色爆炸，产生亮斑/脏色）。必须用 `c.a > 0.001 ? c.rgb/c.a : vec3(0.0)` 条件分支，极小 alpha 时直接取黑。
- [ ] **辉光/扩散类（bloom/outline glow）需扩展 alpha 到文字外区域**（M1 血泪：bloom 原先 `finalColor = vec4(screened * c.a, c.a)` 把辉光限制在 alpha=1 的文字内，外部 alpha=0→不可见，只看着像模糊）。bloom 取 `outAlpha = max(c.a, bloomAlpha * strength)`，让亮部 tap 的 alpha 扩散到邻域。`outAlpha` 须 `clamp(..., 0.0, 1.0)` 防 `strength>1` 时 alpha 溢出导致 WebGL 混合异常。
- [ ] **bloom 采样用费马螺旋**（M1 血泪：固定半径 16 方向环形采样产生离散叠影/星状重影——16 个点在同半径上间隙大，每个点是一个独立叠影）。用费马螺旋：半径 `sqrt(i/16)` 平滑分布 0→1 + 黄金角 ~137.5° 旋转，采样点均匀散布在圆盘内。加权（中心权重高）近似高斯。
- [ ] **edge 内描边不双重乘 alpha**（M1 血泪：`edgeBand = a * (1.0 - minNeighbor)` 在抗锯齿边缘 a≈0.2 → edgeBand≈0.2 → 只混 20% 描边色 → 边缘发虚串色）。不乘 `a`（`finalColor` 已统一乘 `a`），让边缘像素被描边色充分覆盖。加 `smoothstep(0.0, 0.1, edgeBand)` 让描边锐利不粘连。
- [ ] 量化类防除零（posterize `levels≥2`）；采样类边界 clamp。

## C. 时间轨与生命周期 [阻断]

- [ ] 动画滤镜走 `addModifier('behavior', …)` 驱动 uniform，**未**自建 `requestAnimationFrame`/Ticker。
- [ ] 用了 `addModifier` 或假定 KineticChar 的实现，有 `instanceof KineticChar` 守卫 + 非匹配 `console.warn` 后 return。
- [ ] 动画类 `seek`/重播后正确重启（behavior track 由 `registerBehaviors` 重注册，无残留状态）。
- [ ] instant filter 的 fn `return filter` 实例（或组合预设 `return Filter[]`），供 `registerInstantEffects` seek 幂等清理。`InstantCleanup.filterInstance` 支持 `Filter | Filter[]`。
- [ ] block 作用域 instant filter 经 `SegmentBuilder` 路由进 `InstantEffectRecord` + `segmentTl.call`（非 `applyGroupEffects` 同步挂载），seek 回退能正确移除——char/group/block 三路径 seek 幂等均覆盖。

## D. 元数据与作用域（§1.1）[阻断]

- [ ] meta：`type:"filter"`；`track` 与“是否逐帧动画”一致（动画 `behavior`，静态 `instant`）；`mutexGroup` 命名 `filter_*`。
- [ ] `targetType` 取 `both`（或 `char`）。**不要**为“整段/全屏”臆造 `block`/`frame` 取值——作用域是 `level` 路由的事，不是 `targetType` 的事。
- [ ] 作用域语义自洽：邻域/连续区域类（bloom/halftone/vignette/scanline）示例用 `[.x:block]` 验证，而非 group/char；做成只在 char 生效视为作用域错配。
- [ ] **色调/连续色调类（emboss/edge/sharpen/threshold/posterize/duotone/bloom/halftone）样例双示**（spec §0.3 / §3 note）：须同时给 bare `f.x` 逐字（笔画级）与 `[.x:block]` 连续级两例，只给逐字 → 打回（连续色调类逐字会看着像失效）。
- [ ] **样例设非默认 `bgColor` + `fontColor`**（M1 血泪：默认黑底白字下，halftone 暗部大点对白字几乎不可见、bloom 辉光在纯白上对比不足、颜色类滤镜效果被黑/白极值淹没）。frontmatter 须设 `bgColor:` + `fontColor:` 让滤镜在彩色场景下可验证。halftone 的 `invert=true` 专用于白字黑底。
- [ ] **替换 vs 叠加**（emboss/edge 类）：默认参数不得把原图整体替换成吃掉字形的结果（emboss 别把 mix 写死 1.0、edge 别默认 `color=#000,mix=1` 抹黑字身）；色调类对文字应走叠加心智、默认偏向保留原图（spec §4 卡）。
- [ ] **未碰 frame/镜头路径**：本批 PR 不应改 `StageRuntime`/`StageManager` 去塞 filters（那是 spec §7.1 / 概览 §9 的未来项）。若 PR 这么做，打回并引导到“`StagePostProcess` 兄弟模块”方案。

## E. 注册与集成 [阻断]

- [ ] preset 在 `presets/filter.ts` 导出 `{ fn, meta }`（新分类文件须在 `presets/index.ts` 加 `export *`）。
- [ ] **未**改 `Parser.validate()` 加白名单——命令经注册表自动 known（spec §1 纠正 1）；`f.<name>` 不再报 `Unknown command`。
- [ ] 参数全部 `params.x ?? <默认>`，缺参出合理画面，默认值与 spec 卡一致。
- [ ] 颜色参数经 `hexToVec3`（`filters/colorUtils.ts`）转换——解析器 `autoConvert` 不解析 hex，`color="#fff"` 原样作为字符串到达 fn，滤镜侧必须自行转换。

## F. 交付物 [阻断]

- [ ] 示例 KMD 落 `apps/editor/public/tests/fx-<name>.kmd`，覆盖默认 / 改参 / 与一个 behavior 组合（`f.<name>.wave`）三例。
- [ ] `pnpm build` 通过（vue-tsc 无新增错误）。
- [ ] effect-pipeline.md 同步补该滤镜行；首次新增 filter 分类时一并订正 `presets.ts`→`presets/` 表述。

## G. 观感与质量 [观感]

- [ ] 与既有 behavior（wave/shake/rainbow）组合无互斥误杀（除非 mutexGroup 有意约束）。
- [ ] 参数极值（size 很大、strength=0、progress=1）下画面不崩、不全黑/全白。
- [ ] 命名、注释密度、文件风格与 `RGBSplitFilter.ts` / `presets/filter.ts` 一致。
