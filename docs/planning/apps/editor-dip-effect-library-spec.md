# Editor DIP Effect Library — Implementation Spec

> 状态：Active planning（实现规格 / 交接稿）
> 最近更新：2026-06-13
> 代号：DIP-FX
> 上游：`docs/planning/apps/editor-dip-effect-library.md`（清单与设计纲领）

## 0. 本文档定位与协作分工

本文档是**给代码编写者的实现规格**。规划与代码审查由本协作线负责，具体编码由代码编写者执行。规格的目标：照此实现一个滤镜无需反问，且审查有明确验收标准。

每个滤镜的交付 = §2 通用契约 + §4 该滤镜的 spec 卡 + §5 验收。审查依据 §6 清单。

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
  | `group` | `{...} @ f.x` | `TokenWrapper` | 一个花括号词组 |
  | `block` | `[.x:block]` / 段落级 | `KineticText` | **整段**（path B：`applyGroupEffects(kt,…)`） |
  | `frame` | （无，见下） | `StageManager.world` / `contentLayer` | **整个已渲染场景**（相机合成后） |

- **`meta.targetType`（`char|group|both`）只回答“apply 时是否逐字下发”**。`EffectProcessor` 在 `level==="block"||"group"||targetType==="group"` 时走 `container_only`，即把 filter 直接挂到容器、不再逐字。所以滤镜的 `targetType` 取 `group` 或 `both` 即可让它在 group/block 两个作用域都按容器后处理；它不需要、也不可能有 `block`/`frame` 取值。
- **block 不是被 group 覆盖，而是比 group 更大的容器**（整段 `KineticText` vs 单词组 `TokenWrapper`），且**今天就能用**——bloom/halftone/vignette/scanline 这类要“整段连续区域”的滤镜，推荐用法是 `[.bloom:block]`，而非 group。
- **`frame` 作用域的挂点存在但未接线，且归属镜头层而非本滤镜核心**：`StageManager.world`（含 `backgroundLayer`+`contentLayer`，经 `ReaderHost.mountStage` 挂到 `app.stage`，相机变换作用其上）对其设 `.filters` 即整场景后处理。当前**没有任何 KMD 命令路由到它**——`StageRuntime` 是纯相机状态对象、不持容器、无 filters 概念。`frame` 是相机合成后的后处理，属镜头能力，应随镜头能力门控一起接线，详见 §7.1 与概览 §9。

## 2. 单个滤镜的通用实现契约

代码编写者对每个滤镜按此交付：

1. **GLSL + Filter 类** → `core/filters/<Name>Filter.ts`，结构同 `RGBSplitFilter.ts`。命名 `name: "<kebab>-filter"`。
2. **EffectFunction + meta** → 在 `presets/filter.ts` 用 `defineEffect(fn, meta)` 导出。
   - `fn(target, params)`：构造 filter、按 spec 卡把 `params` 写入 uniform、push 进 `target.filters`；动画类再 `addModifier`。
   - 静态滤镜 `track: "instant"`；含逐帧动画的 `track: "behavior"`。`type: "filter"`。
   - `mutexGroup` 命名 `filter_<name>`；可叠加的（如多个独立滤镜）`stackable: true`，互斥的省略。
3. **参数默认值**：`fn` 内对每个参数取 `params.x ?? <default>`，默认值见 spec 卡，缺参也要出合理画面。
4. **char 守卫**：`targetType` 含 `char` 且实现里用了 `addModifier` 或假定 KineticChar 时，加 `instanceof KineticChar` 守卫并对非匹配目标 `console.warn` 后 return（参考 `warp`）。
5. **示例 KMD** → `apps/editor/public/tests/fx-<name>.kmd`，至少覆盖：默认调用、改参调用、与一个 behavior 组合（如 `f.<name>.wave`）。
6. **文档** → 在 effect-pipeline.md 的 filter 段补一行该滤镜的 targetType/track/mutex。

## 3. 命名与参数总表

最终命名以此表为准（避免与现有 `rgbShift`/`warp`/`blur`/`glitch` 冲突）。参数为初稿，实现时可微调手感但需在 spec 卡与示例同步。

`targetType` 按 §1.1：纯逐像素的取 `both`（char/group/block 都自然）；需要“整段连续区域”的取 `both` 但**推荐作用域**标注为 `:block`（写法 `[.x:block]`），不是只能 group。下表“推荐作用域”是建议用法，不是代码限制。

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

#### `edge`
- Sobel：Gx/Gy 各一组 3×3，`mag=length(vec2(gx,gy))`，按 `uThreshold` 阈值，`uColor` 上色，`uMix` 与原图混合。
- targetType `both`。需 padding。

#### `bloom`
- 阈值提取亮部 → 高斯模糊（可用 Pixi `BlurFilter` 串联或自写两遍 separable）→ screen/add 合成回原图。`uThreshold`,`uStrength`,`uRadius`。
- **targetType `both`，推荐作用域 `:block`**（§1.1）：邻域 + 亮部扩散，char 小纹理几乎无效，整段 `KineticText` 才有意义。实现可在 `fn` 内组合 `BlurFilter` + 自写合成 filter（filter 数组按序执行）；或单 shader 内多 tap 近似。需 padding。
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

- **block 纹理范围实测**：bloom/halftone/vignette 走 `[.x:block]` 作用于 `KineticText` 时的纹理边界与 padding 行为，须在 M1 先用 `pixelate` 的 block 示例验证后再定稿这几个邻域滤镜的默认参数。
- **颜色解析工具**：确认 `visual.ts` 是否已有 hex→rgb 工具可复用；若无，在 filter 分类内置一个小工具函数，避免每个滤镜各写一份。
- **dissolve 的 progress 来源**：静态参数 vs 与 entrance/timeline 协同推进，影响是否需要新 track 行为；M2 立项时定。

## 8. 推进顺序（与概览 §6 里程碑对应）

1. **M0**：`pixelate`（both，含 char/group/block 示例）打通全链 + 落本 spec 的“模板”地位。顺带验证 block 纹理范围（§7.2）。
2. **M1**：`gray`→`threshold`→`duotone`→`posterize`（点运算/量化，快） → `sharpen`→`emboss`→`edge`（卷积，统一 padding 模式） → `outline` → `bloom`/`halftone`（最难，收尾）。覆盖卷积/量化/形态学/点运算四类，报告骨架成型。
3. **M2**：`displace`→`underwater`（浪花镜头）、`dissolve`、`noise`、`vignette`、`scanline`，按 demo 缺口取舍。
