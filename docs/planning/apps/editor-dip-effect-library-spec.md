# Editor DIP Effect Library — Implementation Spec

> 状态：Active planning（实现规格 / 交接稿）
> 最近更新：2026-06-25（M1 首次 PR 审查：edge 编译阻断、色调类默认呈现/参数订正、背景图表面立项，见 §0.3 / §4 / §7.3）
> 代号：DIP-FX
> 上游：`docs/planning/apps/editor-dip-effect-library.md`（清单与设计纲领）

## 0. 本文档定位与协作分工

本文档是**给代码编写者的实现规格**。规划与代码审查由本协作线负责，具体编码由代码编写者执行。规格的目标：照此实现一个滤镜无需反问，且审查有明确验收标准。

每个滤镜的交付 = §2 通用契约 + §4 该滤镜的 spec 卡 + §5 验收。审查依据 §6 清单。

### 0.1 实现真相核对增量（M0 落地时发现，已订正本 spec）

M0（pixelate）实现期间对当前代码做了完整核对，发现并订正以下 5 处早期稿与现实的漂移：

1. **`defineEffect` 是 `presets/filter.ts:7-9` 内联的本地 helper**，不从外部 import——新 preset 必须写进既有 filter 分类文件或新建文件并在 `index.ts` 加 `export *`。（§2.2 已补注）
2. **`EffectMetadata` 无 `level` 字段**（`types.ts:11-19`）。`level` 属于 sugar 命令（`go`/`slow`/`fast`）的 `ParsedCommand.level`，与 meta 无关——meta 里别写。
3. **`track: "instant"` 原是死桶**：`TextPlayer.placeCharOnTimeline` 只读 `.behavior`/`.entrance`，instant 滤镜 fn 永不执行。已修复（commit `ce647c3`）——非 style 的 instant 特效经 `InstantEffectRecord` 收集，seek 时 `registerInstantEffects` reset+replay。现有 blur/rgbShift/warp 因含可选 `addModifier` 动画仍填 `behavior`；纯静态滤镜用 `instant`。（§2.2 已补注）
4. **group 作用域触发语法**：`{...} @ f.x` 默认仍逐字（char path），要容器级必须显式 `f.x:group`。早期稿把 braced group 当 group 触发语法有误。（§1.1 表已订正）
5. **`visual.ts` 无颜色解析工具**：早期 §7.2 暗示“可参考 visual.ts”，已证伪——须在 filter 分类内置小工具。（§7.2 已订正）

完整 filter 实现契约与 seek 幂等机制已沉淀至 `docs/knowledge/runtime/core/effect-pipeline.md` 的 Filter 特效模式段。

### 0.2 实现真相核对增量（M1 落地时发现，已订正本 spec）

M1（10 个滤镜）实现期间发现并订正以下漂移：

1. **block 作用域 instant filter seek 幂等缺口已修复**（原 §7.2 已知缺口）：`SegmentBuilder.build` 将 instant filter 从 `applyGroupEffects` 同步挂载分离，路由进 `InstantEffectRecord` + `segmentTl.call`，与 char/group 路径对称。char/group/block 三路径 seek 幂等均已覆盖。（§7.2 已更新）
2. **`InstantCleanup.filterInstance` 扩展为 `Filter | Filter[]`**：原仅支持单个 `Filter`。组合预设（M2 `underwater` 串联 displace + tint + blur）需 return `Filter[]`，`clearInstantEffects` 对数组全部移除 + 逐个 `destroy()`。M1 bloom 用单 shader return 单个，但扩展一并落地避免 M2 再改管线。
3. **bloom 实现路径订正为单 shader**（原 §4 卡给"BlurFilter 链 或 单 shader"两选项）：Pixi v8 的 `filters` 数组是线性管线，每个 filter 只接收上一个的输出，原图丢失。bloom 的 compose 需同时访问原图和模糊亮部，线性链无法提供，故用单 shader 16-tap 环形采样。（§4 bloom 卡已订正）
4. **`hexToVec3` 已交付**（`filters/colorUtils.ts`）：`"#fff"` / `"#aabbcc"` / `0xRRGGBB` → 0..1 `{x,y,z}`，匹配 Pixi v8 `vec3<f32>` uniform 值格式（延续 `vec2<f32>` 用 `{x,y}` 的约定）。解析器 `autoConvert` 不解析 hex（`color="#fff"` 原样作为字符串到达 fn），转换由滤镜侧负责。（§7.2 已更新）
5. **预乘 alpha 对偶作为 GLSL 模式内联**，非共享工具：`c.rgb/max(c.a,1e-4)` → 运算 → `result * c.a`。卷积类（sharpen/emboss/edge）邻域采样后也需先解预乘再运算。（§7.2 已更新）

### 0.3 M1 设计审查增量（首次 PR 审查发现，须回写本卡与清单）

M1 全 10 滤镜首次过审时发现：实现工艺（shader 功底、预乘 alpha 纪律、seek 幂等 infra）很高，但**内容层有 1 个阻断 bug + 一处默认呈现/参数的设计漂移**。本节是结论摘要，细节散见 §3 note / §4 各卡 / review.md A·D 节。

1. **`edge` shader 编译失败（阻断）**：`EdgeFilter.ts` 把 `luma()` 函数定义在 `main()` **内部**，GLSL ES 3.00 禁止嵌套函数定义 → shader 不编译 → `f.edge` 完全不渲染。对照 emboss/sharpen 内联 luma、halftone/bloom 在文件作用域定义 luma（正确）。**`pnpm build` 不编译 GLSL 字符串，门禁对此失明**——须补 shader 编译门禁，见 review.md A 节与概览的 GLSL 工作流建议。修法：把 `luma` 提到文件作用域。

2. **“字符消失/发灰”不是算法用错对象，是默认呈现 + 参数选择问题**。一个澄清:**文字本质是高频纹理**——字形的笔画边缘就是密集信号，edge/sharpen/emboss 作用在文字上得到的是「笔画轮廓线稿 / 笔锋强化 / 笔画明暗起伏」，是成立且有创作价值的**笔画级风格化**。退化来自两点，都可改默认值救回，无须动算法：
   - **默认呈现层级**:色调/邻域类滤镜(emboss/edge/sharpen/threshold/posterize/duotone/bloom/halftone)的「教科书」用法是作用在**连续色调表面**(整段 `[.x:block]` 烤栅格、或未来的背景图)，而非逐字小纹理。bare `f.x` 逐字是「笔画级」这一种用法，不该当成它们的默认演示。**两种用法都合法、意图不同**——样例 KMD 须**同时**给「逐字笔画级」与「`:block` 连续级」两示，让作者看到完整意图范围(当前样例多只给逐字，是失效观感的主因)。
   - **替换 vs 叠加**:`emboss`/`edge` 当前默认把原图**整体替换**为处理结果(emboss `mix(rgbC,vec3(emboss),1.0)` 写死 1.0；edge 默认 `color=#000,mix=1` 纯黑吃字)，在文字上即「字身被抹成灰块/黑剪影」。色调类滤镜对文字该走**叠加心智**(像 outline/bloom 那样在原图之上**加**轮廓/明暗)，默认参数应**偏向保留原图**。见 §4 emboss/edge 卡订正。

3. **选型优先级与原始「创作优先」定调有偏**:M1 先做完了「好讲原理」的教科书四件套(emboss/edge/sharpen/threshold/posterize)，而清单里**创作驱动**的 `displace`(浪花镜头 DIP 半边、underwater 基石原语)与 `dissolve`(出场/消散转场)留到 M2 未做。这不是做错(它们本就在 M2)，但 `displace` 是旗舰 demo 关键路径，**M2 应把它提为第一优先**。

4. **色调/连续色调类滤镜的真正归宿是背景图表面**:见 §7.3——阅读体验愿景草案把「背景作为一等表面」立项后，`bg.blur`/`bg.brightness`/`bg.duotone` 作用在真实连续色调照片上才是这批算子的教科书级正确用法，化解本节第 2 点的「逐字退化」焦虑。

## 1. 实现真相核对（动手前必读，含两处对既有约定的纠正）

以下基于当前代码（Pixi v8.15，`pixi.js` v8 filter API）核对：

- **滤镜挂载点**：`target.filters = [...(target.filters || []), filter]`。`target` 是 `KineticChar`（char 级）或 `TokenWrapper`/容器（group 级）。参考 `presets/filter.ts` 的 `blur`/`rgbShift`/`warp`。
- **GLSL 契约**：见 `core/filters/RGBSplitFilter.ts`。片元着色器用 `#version 300 es`，`in vec2 vTextureCoord` / `out vec4 finalColor` / `uniform sampler2D uTexture`；`uniform vec4 uInputSize` 由 Pixi 自动注入（`.zw = (1/width, 1/height)`）。顶点用 `defaultFilterVert`，不要自写。
- **自定义 uniform**：通过 `super({ glProgram, resources: { filterUniforms: { uXxx: { value, type: "vec2<f32>" } } } })` 声明，再用 getter/setter 暴露 `this.resources.filterUniforms.uniforms.uXxx`。
- **动画滤镜**：不要在 `requestAnimationFrame` 里手动驱动。按 `warp` 的模式，用 `target.addModifier(name, 'behavior', (time) => { filter.uTime = time * speed; return {}; })`，返回空对象（不叠加 transform），靠 Ticker 每帧调用。要求 `target instanceof KineticChar`（`addModifier` 是 KineticChar 的方法）。
- **注册即生效**：`EffectManager` 构造时 `this.registerBatch(Presets)`，`Presets` 来自 `presets/index.ts` 的 `export *`。在 `presets/filter.ts`（或新建分类文件并在 `index.ts` 加 `export *`）导出 `{ fn, meta }` 即自动注册。
- **【纠正 1】无需改 `Parser.validate()`**。`validate()` → `getCommandSemanticInfo(name, registryView)` → `registryView.has(name)` = `effectManager.has(name) || styleManager.has(name) || ...`。preset 注册后 `effectManager.has` 即为真，命令自动 known。CLAUDE.md 中“更新 `KMDParser.validate()` 白名单”的说法是硬编码白名单时代遗留，**对 filter 路径不再适用**；不要去找或新增白名单数组。验收只需确认 `f.xxx` 不再报 `Unknown command`。
- **【纠正 2】作用域是路由（`level`）问题，不是 `targetType` 取值问题**——见 §1.1。早期稿把 block 当作“被 group 覆盖”、把 stage 挂点写成 `StageRuntime`，两者都不准确，已订正。
- **文档同步**：`docs/knowledge/runtime/core/effect-pipeline.md` 仍写 preset 在单文件 `presets.ts`，实际已是 `presets/` 目录；新增 filter 分类时一并订正该处并补 filter 注册说明。

## 1.1 作用域模型（char / group / block / frame）——本库的核心架构判断

核对代码后确立的事实，这是整个滤镜库能“写一次、多作用域复用”的依据。
**命名注意**：第四个作用域命名为 `frame`（全屏屏幕空间后处理），**不叫 stage**——`stage` 在仓库里已被 `mode:"stage"`（呈现模式）和 `StageRuntime`（镜头子系统）占用，复用会三重碰撞。命名分层与镜头系统去向见概览 §9。

- **滤镜 `fn` 本身与作用域无关**。它只做 `target.filters = [...]`，`target` 是任意 Pixi `Container`。同一个 `bloom` fn 既能作用于单字，也能作用于整段，区别只在调用点传进来的 `target` 是哪个容器。
- **“作用域”由 `EffectConfig.level` 路由决定，而非 `meta.targetType`**。`level` 取值与目标容器：

  | scope | 触发语法 | 目标容器 | 纹理范围 |
  |---|---|---|---|
  | `char` | `f.x`（默认逐字） | `KineticChar` | 单字小纹理 |
  | `group` | `f.x:group`（**显式**；`{...} @ f.x` 默认仍逐字） | `TokenWrapper` | 一个花括号词组 |
  | `block` | `[.x:block]` / 段落级 | `KineticText` | **整段**（path B：`applyGroupEffects(kt,…)`） |
  | `frame` | （无，见下） | `StageManager.world` / `contentLayer` | **整个已渲染场景**（相机合成后） |

  > **【核对订正】** `targetType` 是能力描述，**不决定默认目标**：`"both"` 默认走逐字 char 路径（`{...} @ f.x` 仍逐字，见 `EffectProcessor.applyCharEffects` 的 `isBothCharMatch` 与 `11-mixed-levels.kmd:19-21` 注释）。要容器级必须显式 `:group`（`f.x:group`）或 `:block`（`[.x:block]`）。早期稿把 `{...} @ f.x` 当作 group 触发语法有误，已订正。

- **`meta.targetType`（`char|group|both`）只回答“apply 时默认是否逐字下发”**。`EffectProcessor` 在 `level==="block"||"group"||targetType==="group"` 时走 `container_only`，即把 filter 直接挂到容器、不再逐字。据此：
  - `targetType:"group"` → **默认**容器级（不写 `:group` 也按容器）。
  - `targetType:"both"` → **默认逐字 char**；要容器级**必须由调用点显式** `:group` / `:block`（是 `level` 路由把它升到 container_only，不是 `both` 自己升）。
  - 因此**想跨作用域复用的滤镜应取 `both`**，作者按需写 `f.x:group` / `[.x:block]` 取容器；它不需要、也不可能有 `block`/`frame` 取值。早期稿“`both` 即可让它在 group/block 都按容器后处理”的说法有误——`both` 不会自动升容器，已订正（与上方【核对订正】一致）。
- **block 不是被 group 覆盖，而是比 group 更大的容器**（整段 `KineticText` vs 单词组 `TokenWrapper`），且**今天就能用**——bloom/halftone/vignette/scanline 这类要“整段连续区域”的滤镜，推荐用法是 `[.bloom:block]`，而非 group。
- **`frame` 作用域的挂点存在但未接线，且归属镜头层而非本滤镜核心**：`StageManager.world`（含 `backgroundLayer`+`contentLayer`，经 `ReaderHost.mountStage` 挂到 `app.stage`，相机变换作用其上）对其设 `.filters` 即整场景后处理。当前**没有任何 KMD 命令路由到它**——`StageRuntime` 是纯相机状态对象、不持容器、无 filters 概念。`frame` 是相机合成后的后处理，属镜头能力，应随镜头能力门控一起接线，详见 §7.1 与概览 §9。

## 2. 单个滤镜的通用实现契约

代码编写者对每个滤镜按此交付：

1. **GLSL + Filter 类** → `core/filters/<Name>Filter.ts`，结构同 `RGBSplitFilter.ts`。命名 `name: "<kebab>-filter"`。
2. **EffectFunction + meta** → 在 `presets/filter.ts` 用 `defineEffect(fn, meta)` 导出（`defineEffect` 是该文件内联的本地 helper，不从外部 import）。
   - `fn(target, params)`：构造 filter、按 spec 卡把 `params` 写入 uniform、push 进 `target.filters`；动画类再 `addModifier`。
   - 静态滤镜 `track: "instant"`；含逐帧动画的 `track: "behavior"`。`type: "filter"`。
   - **instant filter 的 fn 必须 `return filter` 实例**：供 `PlaybackController.registerInstantEffects` 做 seek 幂等清理（从 `target.filters` 移除旧实例后重 apply）。behavior filter（靠 modifier）不需要返回。
   - **instant track 依赖**：原 instant 桶是死桶（`placeCharOnTimeline` 不读 `.instant`），已修复（见 `effect-pipeline.md` 四轨分类说明）。纯静态滤镜用 `instant`；现有 blur/rgbShift/warp 因含可选 `addModifier` 动画仍填 `behavior`。
   - `mutexGroup` 命名 `filter_<name>`；可叠加的（如多个独立滤镜）`stackable: true`，互斥的省略。
3. **参数默认值**：`fn` 内对每个参数取 `params.x ?? <default>`，默认值见 spec 卡，缺参也要出合理画面。
4. **char 守卫**：`targetType` 含 `char` 且实现里用了 `addModifier` 或假定 KineticChar 时，加 `instanceof KineticChar` 守卫并对非匹配目标 `console.warn` 后 return（参考 `warp`）。
5. **示例 KMD** → `apps/editor/public/tests/fx-<name>.kmd`，至少覆盖：默认调用、改参调用、与一个 behavior 组合（如 `f.<name>.wave`）。
6. **文档** → 在 effect-pipeline.md 的 filter 段补一行该滤镜的 targetType/track/mutex。

## 3. 命名与参数总表

最终命名以此表为准（避免与现有 `rgbShift`/`warp`/`blur`/`glitch` 冲突）。参数为初稿，实现时可微调手感但需在 spec 卡与示例同步。

`targetType` 一律取 `both`（§1.1：`both` 默认逐字、按需经 `:group`/`:block` 升容器，最灵活）。下表“推荐作用域”是建议用法（靠调用点写 `f.x:group` / `[.x:block]` 选择），不是 `targetType` 决定、也不是代码限制；需要“整段连续区域”的（bloom/halftone/...）务必用 `[.x:block]`，写成默认逐字会失去邻域语义。

> **【M1 设计审查】默认呈现 = 两种合法用法，样例须双示**（§0.3）。色调/邻域类（emboss/edge/sharpen/threshold/posterize/duotone/bloom/halftone）有两层意图：bare `f.x` 逐字 = **笔画级风格化**（文字是高频纹理，笔画边缘即信号）；`[.x:block]` = **连续色调级**（教科书用法，作用在整段烤栅格或未来背景图）。两者都合法、观感不同——样例 KMD **须同时给两示**，否则只给逐字会让连续色调类看着像「失效」。`edge`/`emboss` 另需把默认参数从「替换」改为「叠加」（§0.3 第 2 点 / §4 卡），否则逐字时字身被抹成灰块或黑剪影。

| name | track | targetType | 推荐作用域 | mutexGroup | 参数（默认） |
|---|---|---|---|---|---|
| `pixelate` | instant | both | char/group/block | filter_pixelate | size(8) |
| `gray` | instant | both | 任意 | filter_color | mix(1) |
| `threshold` | instant | both | 任意 | filter_color | level(0.5), soft(0.02) |
| `posterize` | instant | both | 任意 | filter_color | levels(4), dither(false) |
| `sharpen` | instant | both | 任意 | filter_conv | amount(1), radius(1) |
| `emboss` | instant | both | 任意 | filter_conv | strength(1), angle(45) |
| `edge` | instant | both | char/block | filter_conv | threshold(0.2), color("#000"), mix(1) |
| `bloom` | instant | both | **block** | filter_bloom | threshold(0.7), strength(1), radius(4) |
| `halftone` | instant | both | **block** | filter_halftone | scale(6), angle(0), shape("dot") |
| `outline` | instant | both | char/block | filter_outline | width(2), color("#fff"), glow(0) |
| `scanline` | behavior | both | **block**/frame(未来) | filter_scanline | density(2), curvature(0), flicker(0) |
| `duotone` | instant | both | 任意 | filter_color | shadow("#1a1a2e"), highlight("#e94560") |
| `dissolve` | behavior | both | char/block | filter_dissolve | progress(0), scale(8), edge("#fff") |
| `displace` | behavior | both | char/block | filter_displace | amount(10), scale(0.02), speed(0.01) |
| `noise` | behavior | both | block/frame(未来) | filter_noise | amount(0.1), mono(true) |
| `vignette` | instant | both | **block**/frame(未来) | filter_vignette | radius(0.75), softness(0.45) |
| `underwater` | behavior | both | char/block | （组合预设，见卡） | amount(8), tint("#2a6f97"), blur(2) |

> `mix`/`mut` 类参数统一 0~1。颜色参数在 `fn` 内解析为 vec3（可参考 `visual.ts` 既有色值解析；若无则简单 hex→rgb）。
> “frame(未来)”标注的滤镜在 frame 路由接线后（§7.1）能升级为真正的全屏后处理，届时 fn 无需改动——只是多一个调用作用域。

## 4. Spec 卡

格式：算法 / uniform / params→uniform / targetType 理由 / 注意。M0 与 M1 核心集给完整卡；M2 氛围类给精简卡。

### M0 参考实现（模板）

#### `pixelate`
- **算法**：下采样——把 `vTextureCoord` 量化到 `size`×`size` 像素网格中心后采样。
- **uniform**：`uSize: f32`（像素块边长，屏幕像素）。
- **params→uniform**：`uSize = params.size ?? 8`。
- **GLSL 核心**：`vec2 px = uSize * uInputSize.zw; vec2 uv = (floor(vTextureCoord/px)+0.5)*px; finalColor = texture(uTexture, uv);`
- **targetType `both`**：纯逐像素，char/group 皆可。
- **注意**：char 级小纹理 size 过大会糊成一块——示例里给 char 用小 size、group 用大 size 各一例。作为后续所有滤镜的代码模板。

#### `gray`
- **算法**：点运算，luma = dot(rgb, vec3(0.299,0.587,0.114))，按 `mix` 在原色与灰度间插值。
- **uniform**：`uMix: f32`。
- **GLSL 核心**：`vec4 c=texture(...); float l=dot(c.rgb,vec3(0.299,0.587,0.114)); finalColor=vec4(mix(c.rgb,vec3(l),uMix),c.a);`
- **targetType `both`**。注意预乘 alpha：对 `c.rgb` 操作前若 Pixi 输出为预乘，需 `c.rgb/max(c.a,1e-4)` 再写回乘 alpha（所有点运算/颜色滤镜统一处理，审查重点）。

### M1 核心集

#### `threshold`
- 点运算 + 软阈值。`uLevel`,`uSoft`。`float l=luma(c); float v=smoothstep(uLevel-uSoft,uLevel+uSoft,l); finalColor=vec4(vec3(v),c.a);`
- targetType `both`。

#### `posterize`
- 量化 + 可选 Bayer 抖动。`uLevels:f32`,`uDither:f32`(0/1)。`rgb = floor(rgb*uLevels + bayer*uDither)/uLevels;` bayer 用 4×4 矩阵按 `gl_FragCoord` 取。
- targetType `both`。注意 levels≥2 防除零。

#### `sharpen`
- unsharp mask：3×3 拉普拉斯核。`uAmount`,`uRadius`。9 次邻域采样，步长 `uRadius*uInputSize.zw`。
- targetType `both`。注意边缘采样越界——靠 padding 或 clamp。**所有卷积类必须设 `filter.padding`**（参考 warp 设 padding=20），否则邻域采样取到透明边。审查重点。

#### `emboss`
- 方向卷积核（按 `uAngle` 旋转的 [-1,0,+1] 梯度）+ 0.5 偏置。`uStrength`,`uAngle`。
- targetType `both`。需 padding。
- **【M1 设计审查订正】叠加而非替换**：当前 `mix(rgbC, vec3(emboss), 1.0)` 把 `1.0` 写死，**整体丢弃原字色**，在文字上只剩中灰浮雕块（浅底近隐形）。须加 `mix` 参数（默认 ≤0.5，偏向保留原图），把浮雕明暗作为**叠加在原字色之上的光照**，而非整体替换。逐字（笔画级）与 `[.x:block]`（整段连续）两种用法都给样例。

#### `edge`
- Sobel：Gx/Gy 各一组 3×3，`mag=length(vec2(gx,gy))`，按 `uThreshold` 阈值，`uColor` 上色，`uMix` 与原图混合。
- targetType `both`。需 padding。
- **【M1 阻断 bug】`luma()` 定义在 `main()` 内部 → GLSL ES 3.00 不编译**。必须把 `luma` 提到文件作用域（抄 halftone/bloom）。`pnpm build` 不编译 GLSL，须靠 shader 编译门禁拦（review.md A 节）。
- **【M1 设计审查订正】默认参数吃字**：默认 `color="#000", mix=1` → 纯黑轮廓**替换**整字，字身（无边缘处）也变黑成剪影。线稿用法的对的默认应是「在原字之上**叠加**亮色描线」——默认 `mix` 应偏低或默认 `color` 取亮色，保证字身可读。逐字（笔画线稿）与 `[.x:block]`（整段线稿）两示。

#### `bloom`
- 阈值提取亮部 → 高斯模糊 → screen/add 合成回原图。`uThreshold`,`uStrength`,`uRadius`。
- **targetType `both`，推荐作用域 `:block`**（§1.1）：邻域 + 亮部扩散，char 小纹理几乎无效，整段 `KineticText` 才有意义。
- **【M1 实现订正】多通道架构：extract → BlurFilter → composite**。原计划单 shader 多 tap 近似，实测高参数（radius=8, strength=2.5）下产生颗粒感（16-tap 采样空隙 + IGN 抖动方差被高强度放大）。改为多通道：①extract pass 自定义 shader 阈值提取亮部 → brightTex；②blur pass 复用 Pixi BlurFilter（分离高斯多通道，丝滑无噪点）；③composite pass 自定义 shader screen 合成 `uTexture`=blurredBrights + `uOriginal`=原图（通过 `addResource("uOriginal", 1, 0)` 绑定到独立 group 1，group 0 被 FilterSystem `_globalFilterBindGroup` 覆盖只含 uTexture）。`InstantCleanup` 的 `Filter | Filter[]` 扩展仍保留。padding = ceil(radius*2)。**【M1 视觉微调】composite 混合从 Screen `1-(1-rgb)(1-glow)` 改为胶片级曝光混合 `rgb+(1-rgb)(1-exp(-glow))`**——Screen 在高 strength 下 glow 突破 1.0 → 死白，曝光混合的 exp(-x) 渐近曲线提供软刹车保留原色 hue。
- 注意：这是难度最高项，建议 M1 末做。

#### `halftone`
- 网点：把坐标按 `uScale` 分网格、按 `uAngle` 旋转，网格内画半径正比于 luma 的点（`uShape` dot/line）。`uScale`,`uAngle`,`uShape:f32`。
- targetType `both`，推荐 `:block`（需连续区域才成网点视觉）。

#### `outline`
- 形态学膨胀近似：对 alpha 做多方向偏移采样取 max 得轮廓，`uWidth` 控制偏移、`uColor` 上色，`uGlow>0` 时叠加柔化外发光。
- targetType `both`（char 级即逐字描边，常用）。需 padding ≥ width。

#### `duotone`
- 点运算：luma 映射到 `uShadow`→`uHighlight` 渐变。两个 vec3 uniform。
- targetType `both`。

#### `scanline`（动画）
- 周期亮度调制 `sin(vTextureCoord.y * uDensity * resolutionFactor)`，可选 `uCurvature` 桶形畸变、`uFlicker` 随时间闪烁。
- **track `behavior`**：用 `addModifier` 驱动 `uTime`（flicker/滚动）。targetType `both`，推荐 `:block`（frame 路由接线后可升级整屏，§7.1）。

### M2 氛围集（精简卡）

- **`dissolve`**（behavior）：噪声场（hash 或噪声纹理）与 `uProgress` 阈值比较，低于则 alpha=0，阈值边缘用 `uEdge` 上色描边。`uProgress` 可由 entrance 协同推进或参数静态给。targetType both。
- **`displace`**（behavior）：位移贴图——`vTextureCoord += (noise(uv*uScale + uTime)*2-1)*uAmount*uInputSize.zw` 后采样。`uTime` 由 addModifier 推进。这是 `underwater` 的几何半边。targetType both，需 padding。
- **`noise`**（behavior）：叠加时变噪声，`uMono` 控制单色/彩噪，`uAmount` 强度。
- **`vignette`**（instant）：径向亮度衰减 `smoothstep(uRadius, uRadius-uSoftness, dist(uv,0.5))`。targetType both，推荐 `:block`（整段才有暗角语义；frame 路由接线后整屏更自然，§7.1）。
- **`underwater`**（组合预设）：**不是新 shader**，在 `fn` 内组合 `displace`（波纹）+ 蓝移（duotone/tint）+ 轻 `blur`，串进 `target.filters` 并统一用一个 addModifier 推进时间。是“文字踩进水里”镜头的 DIP 半边；运动半边（下落/浪花）由 behavior 负责，见 §1 设计纲领。targetType both。

## 5. 验收标准（每个滤镜）

代码编写者自测、审查复核：

1. `pnpm build` 通过（vue-tsc 类型检查无新增错误）。
2. `pnpm dev` 打开，加载 `public/tests/fx-<name>.kmd`，默认调用与改参调用画面符合 spec 卡描述，无 WebGL 报错。
3. `f.<name>` 不再产生 `Unknown command` 诊断（验证 §1 纠正 1 的自动 known）。
4. 与一个 behavior 组合（如 `f.<name>.wave`）能同时生效，无互斥误杀（除非 mutexGroup 有意约束）。
5. 卷积/邻域类：缩放画布或字号后边缘无透明截断（验证 padding）。
6. 颜色/点运算类：在半透明字上无暗边（验证预乘 alpha 处理）。
7. 动画类：`seek`/重播后动画正确重启（behavior track 由 `registerBehaviors` 重注册）。

## 6. 代码审查清单

清单已抽成可复用的**审查入口**：`editor-dip-effect-library-review.md`。每个滤镜 PR 从那里逐条过；条目改动以该文件为准（本节不再重复维护）。要点速记：Pixi v8 契约 / 算法正确性（padding、预乘 alpha）/ 时间轨生命周期 / 元数据与作用域（不臆造 `block`/`frame` 的 `targetType`、不碰镜头路径）/ 注册（不改 validate）/ 交付物。

## 7. 待调研 / 阻塞项

### 7.1 frame 作用域路由（镜头层）（未来项，独立于本批 char/group/block 滤镜）

不阻塞 M0–M2（它们靠 char/group/block 即可覆盖绝大多数镜头）。但若 demo 需要真正的整屏后处理（整屏 CRT、整屏水下、整屏暗角/噪声做旧），需新增一条 frame 路由（归镜头能力）。架构判断与建议见**概览文档 §9**，结论摘要：

- **不要把 filters 并进 `StageRuntime`**。它是纯相机状态对象、不持容器，且处在 reader-runtime 可移植边界上；塞进 Pixi 容器/filter 所有权会破坏这个干净边界。
- **建议做成 `StageRuntime` 的兄弟模块**（如 `StagePostProcess`），由它持有对 `StageManager.world`/`contentLayer` 的 filters 引用，命令经镜头/frame 路由（`partition()` 已把 `stageManager.has(name)` 的命令分到 stageConfigs）下发。
- **滤镜 `fn` 完全复用、零改动**：frame 路由只是把 `target` 解析为 world/content 容器再调同一个 fn。这正是 §1.1“写一次、多作用域复用”的兑现。
- 需定：world 还是 contentLayer 作默认全屏 target（背景要不要被滤镜吃到）；与相机变换的叠加顺序（filter 在相机变换之后，属屏幕空间后处理，通常正确）。

### 7.2 其他

- **block 纹理范围实测**：bloom/halftone/vignette 走 `[.x:block]` 作用于 `KineticText` 时的纹理边界与 padding 行为，须在 M1 先用 `pixelate` 的 block 示例验证后再定稿这几个邻域滤镜的默认参数。**（M0 进展：`pixelate:block` 已打通，正向播放生效。M1 进展：block 作用域 instant filter 的 seek 幂等缺口已修复——`SegmentBuilder` 将 instant filter 从 `applyGroupEffects` 同步挂载分离，路由进 `InstantEffectRecord` + `segmentTl.call`，与 char/group 路径对称。char/group/block 三路径 seek 幂等均已覆盖。）**
- **颜色解析工具**：【已交付】`filters/colorUtils.ts` 提供 `hexToVec3`（`"#fff"` / `"#aabbcc"` / `0xRRGGBB` → 0..1 归一化 `{x,y,z}`，匹配 Pixi v8 `vec3<f32>` uniform 值格式）。`visual.ts` 无 hex→rgb 工具、`styles.ts` 的 `toRgba` 是 `_glow` 闭包内本地函数（输出 CSS 字符串，不可复用）——均已核对。预乘/解预乘 alpha 对偶作为 GLSL 模式内联在各点运算/颜色滤镜 shader 内（`c.rgb/max(c.a,1e-4)` → 运算 → `* c.a`），非共享工具。
- **dissolve 的 progress 来源**：静态参数 vs 与 entrance/timeline 协同推进，影响是否需要新 track 行为；M2 立项时定。
- **时间曲线（ease）控制**：M1 视觉微调期间调研确认——底层架构完全可以支持 ease，无需架构变更。KMD 播放系统全建立在 GSAP 上，`ease` 是一等参数，`params` 管线端到端贯通，`gsap.parseEase` 已用于 seek-trim。缺失仅为实现层：①entrance/stage 效果硬编码 ease（~14 处一行改 `params.ease ?? <默认>`）；②parser 无 `ease` 语法（参数形式 `f.x(ease=power2.inOut)` 今天即可用，点修饰符 `f.x.ease` 需 grammar 改动）；③layout transition 需新效果（返回 GSAP tween → `captureTween` 挂载）。完整调研见 `docs/knowledge/runtime/core/timeline-and-easing.md`。M1 不需要 ease，可在任何时候添加。

### 7.3 背景图表面 = 连续色调滤镜的真正归宿（与阅读体验愿景联动）

色调/连续色调类滤镜（blur/brightness/duotone/bloom/halftone/edge…）在逐字小纹理上退化（§0.3），它们的教科书级正确对象是**一张真实连续色调照片**——也就是「背景图」。仓库目前尚无背景图作为阅读体验一等公民的规划，现已立草案 `docs/planning/ecosystem/reading-experience-vision-draft.md`：把 `background` 定为独立于「逐字」与「镜头 frame」的一等表面，其 `bg.brightness`/`bg.blur` **首要为可读性**（字铺在图上须压暗/虚化保证对比度），其次为氛围。该表面接线后，本库这批连续色调算子可直接复用 fn 作用其上（同 §1.1「写一次、多作用域复用」）。与镜头 `frame` 作用域（§7.1）的区别：`frame` 是相机合成后的叙事后处理（镜头层、形态专属）；`background` 是阅读基底（跨形态普适）。两者不同层，详见该草案与概览 §9。

## 8. 推进顺序（与概览 §6 里程碑对应）

1. **M0**：`pixelate`（both，含 char/group/block 示例）打通全链 + 落本 spec 的“模板”地位。顺带验证 block 纹理范围（§7.2）。
2. **M1**：`gray`→`threshold`→`duotone`→`posterize`（点运算/量化，快） → `sharpen`→`emboss`→`edge`（卷积，统一 padding 模式） → `outline` → `bloom`/`halftone`（最难，收尾）。覆盖卷积/量化/形态学/点运算四类，报告骨架成型。
3. **M2**：`displace`→`underwater`（浪花镜头）、`dissolve`、`noise`、`vignette`、`scanline`，按 demo 缺口取舍。
