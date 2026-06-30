# DIP Filter PR — Review Entry Point

> 状态：Active（审查入口 / 可复用清单）
> 最近更新：2026-06-28（技术债清理二：结尾重播不清理 entranceFilters + clearScreen 置空 segment + 容器级 blurIn timeline 统一 + stage modifier 清理）
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
- [ ] **modifier id 等于 effectName**（!!! 审计修复：`clearBehaviors` 用 `behavior.effectName` 调 `removeModifier`，`Map.delete` 精确匹配）。原 `rgbShift→rgbAnim`/`warp→warpAnim`/`blur→blurAnim`/`gravity→physics`/`fadeShake→shake` 五处不一致 → seek/stop/clearScreen 命中失败、modifier 残留继续写已 destroy 的 filter uniform。`fadeShake` 原用 `shake` id 还附带 `Map.set` 同 key 覆盖 `shake` 的隐患，改 `fadeShake` 后两者独立 tick 叠加。新 preset 的 `addModifier` 第一参数必须等于 `defineEffect` 的导出名。
- [ ] **容器级位移 behavior 用 `ContainerBehaviorOffset`，不 tween `pivot`**（!!! 审计修复：`shake:group`/`:block` 原 tween `target.pivot`，但 pivot 是布局中心值——`TokenWrapper` 构造时设为几何中心、`KineticText.position` 由段落定位写入。`kill()` 不恢复 → seek/stop/clearScreen 后永久错位）。容器级位移 behavior 须用 `addContainerOffset(target, effectName, fn)` 叠加 offset 到 position（与 char 级 `addModifier` 返回 `{x,y}` 叠加到 layoutX/Y 同构），返回 `{ tickerFn }`（`BehaviorFilterResult.filters` 可选）纳入 ticker cleanup；`BehaviorCleanup.offsetTarget` 记录绑定容器，`clearBehaviors` 调 `removeContainerOffset` 恢复 position=base。新容器级纯位移 behavior 复用此机制，勿 tween 布局属性（pivot/position 直接写）。
- [ ] **char 级 state 推进 tween 必须 return**：`fadeShake` 等 char 级 behavior 用 `gsap.to(state, ...)` 推进 modifier 参数时 fn 必须 `return gsap.to(...)`，记入 `BehaviorCleanup.tween`，cleanup `tween.kill()` 停止 state 推进（modifier 已由 `removeModifier` 移除，tween 残留只推进无人读的 state，泄漏但不抛错）。与容器级 offset 路径区分：char 级 tween 安全（tween 的是 state 对象非显示属性），容器级 tween pivot 不安全。
- [ ] 动画类 `seek`/重播后正确重启（behavior track 由 `registerBehaviors` 重注册，无残留状态）。
- [ ] instant filter 的 fn `return filter` 实例（或组合预设 `return Filter[]`），供 `registerInstantEffects` seek 幂等清理。`InstantCleanup.filterInstance` 支持 `Filter | Filter[]`。
- [ ] block 作用域 instant filter 经 `SegmentBuilder` 路由进 `InstantEffectRecord` + `segmentTl.call`（非 `applyGroupEffects` 同步挂载），seek 回退能正确移除——char/group/block 三路径 seek 幂等均覆盖。
- [ ] **behavior-track filter 的 fn 返回值符合 `BehaviorFilterResult` 契约**（!!! M2 准备修复：原 blur/rgbShift/warp 不 return filter → seek 累积 + stop/clearScreen 不释放 GPU）。char 级 fn `return filter`（`Filter | Filter[]`，modifier 靠 modName 清理）；容器级 fn `return { filters, tickerFn }`（`BehaviorFilterResult`）。纯 modifier behavior（shake/wave…）继续不 return，无影响。`registerBehaviors` / `segmentTl.call` 解包此契约记入 `activeBehaviorCleanups`。
- [ ] **容器级（`:group`/`:block`）animation 用 `gsap.ticker.add(fn)` 驱动**（!!! M2 准备：`addModifier` 是 KineticChar 专属，容器无 modifier 概念）。fn 内按 `target instanceof KineticChar` 分走 addModifier / ticker 两条路；ticker 回调更新 filter uniform（uTime/uProgress），cleanup 时 `clearBehaviors` 做 `gsap.ticker.remove(tickerFn)` + 移除 filter + `destroy()`。
- [ ] **group-scope behavior 进 `behaviors[]` cleanup 路径**（!!! M2 准备修复：原 `unrollGroupChain` 容器级 behavior 用独立 `tl.call` 不 push `behaviors` → seek 不重 apply、无 cleanup）。容器级 behavior 须 push `behaviors`（`target = wrapper`），经 SegmentBuilder 统一 `tl.call` + `registerBehaviors` seek 重注册，与 char 级对称。
- [ ] **block-scope behavior（filter + 位移）进 `behaviors[]` cleanup 路径**（!!! M2 准备补修 + 审计修复：原 `SegmentBuilder` 只分流 block 级 instant filter（`blockInstant`），behavior 落 `blockRemaining` → 同步 `applyGroupEffects` 执行但 fn 返回的 `{ filters, tickerFn }` 被丢弃，不进 `activeBehaviorCleanups` → seek/stop/clearScreen 清不到 filter + ticker 泄漏，打在 underwater 关键路径）。`blockBehavior` 分流条件为 **`track === "behavior"`**（非仅 `type === "filter"`）——覆盖 `type:"filter"+track:"behavior"`（blur/rgbShift/warp/M2 displace/underwater）和 `type:"behavior"+track:"behavior"`（`shake:block` 用 `ContainerBehaviorOffset` 返回 `{ tickerFn }`）。原条件只认 `type:"filter"` → `shake:block`（`type:"behavior"`）落 `blockRemaining` → `addContainerOffset` 启动 ticker 但返回值被 warn 后丢弃 → ticker 泄漏。`dim` 也 `track:"behavior"` 且容器分支用 `restoreProps` 机制（写 `target.alpha` 后记录原始值，`clearBehaviors` 恢复，seek 不残留半透明——审计修复，原裸写 `target.alpha` 不被 cleanup 还原；**不用 ContainerBehaviorOffset ticker 叠加 alpha**——ticker 每帧覆盖 `target.alpha` 会与 timeline alpha 动画如 blurIn 0→1 冲突）；`shift`/`glitch` `targetType:"char"` 对容器跳过，进 record 后解包 `result=undefined` 不进 cleanup，安全。behavior 须走 `blockBehavior` 分支路由进 `BehaviorRecord`（`target = char = paragraphText`）+ `segmentTl.call`（解包 `BehaviorFilterResult`/tween/offset），seek 由 `registerBehaviors` 重 apply。char/group/block × instant/behavior 六路径 seek 幂等均覆盖。
- [ ] **Filter 销毁用 `destroyFilterDeep`，非裸 `destroy()`**（!!! M2 准备补修：Pixi v8.15 `BlurFilter` 持有 `blurXFilter`/`blurYFilter` 且自身不 override destroy，裸销毁泄漏 X/Y 子 pass）。`clearBehaviors` / `clearInstantEffects` 共用 `destroyFilterDeep`：先销毁 `blurXFilter`/`blurYFilter`（若存在）再 destroy 外层。`f.blur` 返回裸 `BlurFilter`（behavior 路径）、M2 underwater 组合里的 blur 同此覆盖；`BloomFilter.destroy()` 已自行处理内部子 filter，helper 对无 X/Y 字段的 filter 无副作用。
- [ ] **dissolve 的 progress 来源**（spec §7.2 定案）：fn 内 `const state = { progress: 0 }` + `gsap.to(state, {progress:1, duration, ease})` 自动推进；ticker/addModifier 回调 `filter.uProgress = state.progress`；作者 `progress=` 静态给则锁定。track = behavior，不引入新 track。
- [ ] **入场特效创建持久 filter 须返回 `EntranceFilterResult`，filter 走 `entranceFilters` 非 `instantEffects`**（!!! 技术债修复：`blurIn` 创建 `BlurFilter` 靠 tween `onComplete` 移除，`stop` kill 时间线时 `onComplete` 不触发 → GPU 泄漏）。创建持久 filter 的 entrance 特效须返回 `{ tween, filter }`（`EntranceFilterResult`），`captureEntrance` 解包：tween → `captureTween` 入时间线，filter → `entranceFilters`（`EntranceFilterRecord`，**不进 instantEffects**）。`clearEntranceFilters(segment)` 在 stop/clearScreen 时移除 filter + `destroyFilterDeep`。**结尾重播不清理 entranceFilters**（tween 在时间线上，seek(0) 重播）；**seek 时不清理/重 apply**（entrance tween 靠时间线插值）。若走 instantEffects 路径会被 `registerInstantEffects` 在 seek 时重 apply → `gsap.set(alpha=0)` 重置 + rogue tween + `destroy()` 对 `{tween,filter}` 崩溃。容器级 entrance 的 alpha + filter 动画须并入同一 `gsap.timeline`（非另起 `gsap.to`），否则 filter tween 不入 segment timeline → orphan。
- [ ] **`clearScreen` kill 时间线 + 置空 segment**（!!! 技术债修复：原 `clearScreen` 只调 clear* 不 kill 时间线 → 入场 tween orphan；不置空 segment → 后续 playSegment/seekToTime/next 用已 kill 的 timeline + 已 destroy 的对象崩溃）。`clearScreen` 须先 `segment.timeline.pause().kill()` 再 clear*，**置空 segment**（与 stop 对齐——已 destroy 所有显示对象），并 reset layout + loadState(entryCheckpoint.stage) + clearModifiers。fade tween 在 destroy 前加 `gsap.killTweensOf(kt)` 兜底防并发 orphan。
- [ ] **stage modifier 在 stop/clearScreen 清理**（!!! 技术债修复：`cam.shake` 靠 tween `onComplete` 移除 modifier，stop kill 时间线后 `onComplete` 不触发 → 残留；`cam.drift` 无 tween、modifier 永久残留）。`StageManager.loadState` 只 restore camera + `killTweensOf`，不 `clearModifiers`。stop/clearScreen 须在 `loadState` 后显式调 `stageManager.clearModifiers()`。
- [ ] **`loadScript`/`loadSource`/`load` 先清旧 segment**（!!! 技术债修复：`loadSourceContent` 已 stop，但 `load`（ScriptPlayer.ts:205）仍依赖外部调用者 stop → 连续两次 load 旧 timeline/对象/资源残留）。`load` 也须先 `this.stop()` 再 build。runtime 公共入口（loadScript/loadSource/load 经 protocol dispatch）不保证上层已 stop。**生命周期不变量 INV-4**（见 `lifecycle-invariants.md`）。
- [ ] **容器级 alpha 行为用 `restoreProps`，不用 ticker 叠加**（!!! 技术债修复：`dim:group`/`:block` 用 `ContainerBehaviorOffset` ticker 叠加 alpha 会与 timeline alpha 动画如 blurIn 0→1 冲突——ticker 每帧覆盖 target.alpha）。容器级 alpha 行为（dim）须用 `restoreProps`（一次性写 `target.alpha` + 记录原始值 + `clearBehaviors` 恢复），**`ContainerBehaviorOffset` 仅支持 position（x/y）**。**生命周期不变量 INV-6**。
- [ ] **stage modifier 命令级生命周期建模**（!!! 审计修复）：(1) **duration 按命令语义**——`cam.shake` 的 `params[1]` 是 duration（默认 0.5），`cam.drift` 的 `params[1]` 是 speed。用 `getStageModifierDuration(command, params)` 按命令提取，不用通用 `params[1]`。(2) **clear boundary**——`cam.reset` 记为 `isClearBoundary`，`replayStageModifiers` 找最后一个 boundary，之前的 modifier 不重放（seek 到 reset 后不恢复 reset 前的 drift）。**单一真相源 `buildStageModifierRecord(command, params)`**——三路径（global `applyStageConfigs` / inline `TextStageCueScheduler.schedule` / token-chain `TextPlayer.unrollGroupChain`+`unrollCharChain`）共用此 helper，保证 `文字 @ cam.reset!` 与全局 cam.reset 行为一致（R2 修正：初版只在 global 路径特殊处理 cam.reset，inline/token-chain 落非 modifier 分支只 captureTween 不写 record；SegmentBuilder 聚合须 spread 全字段含 `isClearBoundary`）。(3) **cam.shake 中间强度**——seek 到 shake 中途时用 `power2.out` 衰减公式 `strength * (1 - elapsed/duration)^2` 计算剩余强度，不重新从满强度启动新 tween；用 `static:true` apply（恒定强度）——**不能用 `duration:0`**，GSAP 零时长 tween 同步触发 `onComplete` 自删（R2 修正）。(4) **三路径共用 recorder**——global/inline/token-chain 都 push `stageModifierRecords`。(5) **load idle 闪烁**——`stop({ suppressIdle: true })`。**生命周期不变量 INV-1 + INV-2 + 覆盖矩阵**。
- [ ] **block entrance 分流（`blurIn:block`）**（!!! 审计修复：`track:"entrance"` 的 block 级特效落 `blockRemaining` → `applyGroupEffects` 同步执行 → `{tween, filter}` 被 warn guard 漏掉 → tween 不进 timeline、filter 不进 entranceFilters → 泄漏）。`track:"entrance"` 须进 `blockEntrance` 分流：build 期 apply 后 tween 入 `segmentTl`、filter 进 `allEntranceFilters`。warn guard 也须识别 `{tween, filter}` 形状。新 block 级 entrance 特效必须走 `blockEntrance` 分流。
- [ ] **seek 顺序：clear-before-seek-before-reapply**（!!! 审计修复：原顺序 `timeline.seek → clearBehaviors` → restoreProps 写回旧 alpha 覆盖 timeline 刚插值的 alpha）。seek 顺序须为 `clearBehaviors → clearInstantEffects → timeline.seek → register*(replay)`。restoreProps 写回旧值 → timeline.seek 覆盖为插值结果 → 正确。**生命周期不变量 INV-2**。
- [ ] **`blockRemaining` 不得 return 资源**（技术债封口：`SegmentBuilder` 的 `blockRemaining` 桶经 `applyGroupEffects` 同步执行，返回值不进 record）。非 filter 的 block 级特效（style/action/pure-modifier behavior）**不得 return filter/tween/{filters,tickerFn}**——需 return 资源必须像 instant/behavior filter 那样在 SegmentBuilder 分流进 record 通道。`applyGroupEffects` 对违规 return `console.warn` 守卫。
- [ ] **删除死路径**（技术债清理）：legacy `KineticText.play`/`bakeTimeline`/`skipToEnd`/`applyParagraphEffects` + `TextPlayer` legacy `play`/`executePerformance`/`sliceLegacyPlaybackAssembly`/`fastForward`/`bakeTimeline`/`skipToEnd` + `LegacyTextPlaybackOptions` + `example/layout-debug.ts` 均已删除（Segment 引擎零引用）。新特效不得依赖这些 API；生产路径是 `ReaderRuntimeSession → scriptPlayer.playSegment → SegmentBuilder → TextPlayer.buildTimeline`。

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
