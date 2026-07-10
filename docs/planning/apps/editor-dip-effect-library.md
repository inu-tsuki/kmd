# Editor DIP Effect Library Plan

> 状态：Active planning
> 最近更新：2026-06-25（M1 首审：加 §8.1 实现现状对照、§9.2 背景作阅读基底层）
> 代号：DIP-FX
> 归属：`apps/editor`（KMD core runtime effect 层）
> 实现规格（交接稿）：`editor-dip-effect-library-spec.md`
> 审查入口（PR 清单）：`editor-dip-effect-library-review.md`

## 1. 背景与定位

这是一个**创作优先（project-first）**的特效库子项目，同时作为数字图像处理（DIP）课程大作业。课程方只要求“与课程相关”，未指定实现方式，因此本项目以“做出想做的动态排版作品”为第一目标，课程相关性由库的技术构成自然满足，不为凑算法而设计。

现状（截至本文档）：

- `behavior` / `entrance` 赛道已饱和（约 18 个：位移、缩放、透明度类几何动画）。
- `filter` 赛道仅 3 个真实 fragment-shader 滤镜：`rgbShift`、`warp`、`blur`（外加 `visual.ts` 里的合成式 `glitch`）。

结论：动态排版当前缺的不是“字怎么动”，而是“字的质感与氛围”——辉光、溶解、做旧、风格化。这一空缺恰好与 DIP 主场（逐像素 / 邻域运算）重合，因此“创作优先地补 filter 赛道”与“课程相关”不冲突。

## 2. 设计纲领：DIP / 非 DIP 边界

本库的范围由一条边界定义，这条边界本身就是一句图像处理的工作定义，可直接用于报告叙事：

> **DIP 滤镜库管“像素被怎么处理”（per-pixel / 邻域运算，fragment shader），不管“图元被怎么移动”（transform / 粒子，GSAP timeline）。**

推论：

- 一个完整创作镜头常是**“运动 + 滤镜”的合成**。例：“文字踩进水里溅起浪花” = 下落位移（behavior，非 DIP） + 水下折射/波纹位移/模糊（filter，DIP）。
- KMD 链式语法 `f.fall.underwater(...)` 天生支持这种合成。
- **本库只负责 fragment-shader 那一半**；运动那一半复用已有 behavior 体系，或单列为“非 DIP 配套 behavior”，并在文档与报告中明确标注其不计入 DIP 叙事。

## 3. 特效清单

参数列为初稿，实现时按手感调整。`targetType` 决定难度与正确性：需要邻域信息的滤镜（bloom、halftone、edge 等）在 `group`/`block`/`stage` 级纹理上效果远好于逐字小纹理，须提前定。

### 3.1 核心 DIP 滤镜（撑起课程报告，目标 ≥6 个可讲原理）

| 特效 | 创作价值 | DIP 原理 | 关键参数 | 建议 targetType | 难度 |
|---|---|---|---|---|---|
| `bloom` 辉光 | 霓虹 / 强调字 | 高斯卷积 + 阈值提取 + 图像合成 | threshold, strength, radius | group/block | 中 |
| `dissolve` 噪声溶解 | 出场 / 消散转场 | 噪声生成 + 阈值化 | progress, scale, edgeColor | char/both | 低 |
| `pixelate` 像素化 | 复古 / 解码感 | 下采样与重采样 | size | both | 低 |
| `halftone` 半调 | 印刷 / 波普风 | 采样量化 + 网点 | scale, angle, shape | block | 中 |
| `outline` 描边/外发光 | 可读性 + 风格 | 形态学膨胀 / 距离场 | width, color, glow | char/both | 中 |
| `scanline` CRT 扫描线 | 复古屏幕氛围 | 周期采样 + 几何畸变 | density, curvature, flicker | block/stage | 中 |
| `lut` / `duotone` 调色 | 整体氛围统一 | 点运算 + 色彩空间变换 | shadow, highlight / lutTexture | block/stage | 低 |
| `displace` 位移映射 | 热浪 / 水波 / 玻璃 | 几何变换 + 位移贴图 | map, amount, speed | char/both | 中 |
| `edge` 边缘检测 | 线稿 / 描线风 | Sobel / Laplacian 卷积 | threshold, color, mix | block | 中 |
| `sharpen` 锐化 | 清晰 / 硬朗质感 | unsharp mask 卷积 | amount, radius | both | 低 |
| `emboss` 浮雕 | 金属 / 石刻质感 | 方向卷积核 | strength, angle | both | 低 |
| `posterize` 色彩量化 | 海报 / 扁平风 | 量化 + 有序抖动(Bayer) | levels, dither | both | 低 |
| `gray` / `threshold` 灰度/二值 | 黑白 / 强对比 | 点运算 + 阈值 | mix / level, soft | both | 低 |

### 3.2 合成 / 氛围滤镜（创作驱动，DIP 相关性弱，可选挂钩）

| 特效 | 说明 | 备注 |
|---|---|---|
| `underwater` 水下 | displace 波纹 + 蓝移 + 轻模糊的组合预设 | 由 3.1 原语组合，是“浪花镜头”的 DIP 半边 |
| `noise` / `grain` 颗粒 | 叠加噪声纹理 | 做旧 / 胶片 |
| `vignette` 暗角 | 径向亮度衰减 | 点运算，氛围 |
| `chromatic` 色散 | 边缘 RGB 偏移（强化版 rgbShift） | 复用现有 split 思路 |

### 3.3 非 DIP 配套 behavior（按需，明确标注不计入 DIP 叙事）

“浪花”里的下落、粒子飞溅等纯运动效果。优先复用 `gravity`/`jump`/`wave`；确需新增的（如粒子 `splash`）单独成项，不混入 filter 赛道。

## 4. 工程标准（用于截断清单）

1. **参数化**：每个特效 ≥2~3 个有意义参数，可进 `f.xxx(a, b)` 链式语法，并能与 behavior 自由组合（`f.red.bloom.wave` 是 KMD 灵魂）。
2. **作用域可行性**：邻域类滤镜不要硬塞 `targetType: char`；先定 group/block/stage 级纹理路径。
3. **mutex / stackable**：想清互斥组，避免叠加冲突（参考 `blur` 的 `stackable: true`）。
4. **全图统计类回避**：直方图均衡化等需要全图统计的算法在纯 fragment shader 不好做——用分块近似 / 预计算 LUT，或直接避开。

## 5. 实现模式（每个特效的落地步骤）

照现有 `RGBSplitFilter` + `blur`/`rgbShift` preset 抄：

1. **GLSL**：`apps/editor/src/core/filters/XxxFilter.ts`——继承 Pixi v8 `Filter` + 自定义 fragment shader（30~80 行）。
2. **Preset**：在 `core/effects/presets/filter.ts`（或新建分类文件并在 `presets/index.ts` 导出）导出 `{ fn, meta }`，经 `registerBatch` 自动注册。
3. **元数据**：按 `effects/types.ts` 的 `EffectMetadata` 填 `type:"filter"` / `track` / `targetType` / `mutexGroup` / `stackable`。
4. **白名单**：~~在 `KMDParser.validate()` 加名字~~ —— **不需要**。`validate()` 经 `registryView.has()` 查注册表，preset 注册后自动 known（详见 spec §1 纠正 1）。CLAUDE.md 该条是硬编码时代遗留。
5. **验证**：`pnpm build`（vue-tsc 类型检查）+ `pnpm dev` 实测；示例 KMD 放 `apps/editor/public/tests/`。
6. **文档**：同步更新 `docs/knowledge/runtime/core/effect-pipeline.md`（CLAUDE.md 约定）。

## 6. 里程碑

- **M0 全流程打通**：选最简单的 `pixelate`（或 `gray`），跑通 shader → preset → 语法 → 示例 → 文档，作为后续模板。
- **M1 课程核心集**：完成 3.1 中 ≥6 个能讲原理的滤镜（建议覆盖卷积 / 量化 / 形态学 / 点运算四类，报告结构自然成型）。
- **M2 创作集 + demo 作品**：补 3.2，并产出 1~2 个 KMD 演示作品（含“运动+滤镜”合成镜头，如 underwater）作为答辩成片。任务：
  - **任务 B（背景图地基，前置）**：editor-dev 级 `bg(color)`（B1）+ `bg(src)`（B2，`public/` 加载图挂 `backgroundLayer`）+ **`:bg` 滤镜路由（B3，已纳入本批）**。解锁「文字滤镜叠真实画面」+「DIP 滤镜应用到背景图本身 = 色调族照片级验证」。交接稿见 `../ecosystem/special-commands-vocabulary-draft.md` §10。
  - `displace`（underwater 基石原语）提为创作滤镜第一优先（§8.1）。
  - `underwater` 组合预设、`dissolve`、`noise`、`vignette`、`scanline` 按 demo 缺口取舍。
- **M3 收尾**：~~先过 **M3.0 Surface Profile Decision** gate~~（✅ 2026-07-10 已通过：17 个 DIP-FX 效果已标注 surface profile——`text-only` ×4 / `profile-split` ×4 / `background-ready` ×9，见 spec §3 表格 + §0.6 标注结果）。随后按 demo 缺口补非 DIP 配套 behavior，并整理报告叙事（库边界 = DIP 定义）。执行顺序、条件式 behavior gate、提交结构与编写者提示词见 [`editor-dip-effect-library-m3-plan.md`](editor-dip-effect-library-m3-plan.md)。

### 6.1 验证表面与背景图依赖（决定怎么即刻验证 M1）

滤镜分两族，验证表面不同——排优先级前须分清：

| 滤镜族 | 例 | 有意义的验证表面 | 现状 |
|---|---|---|---|
| 空间 / alpha 族 | pixelate, outline, halftone, bloom | `[.x:block]` 整段多字形栅格即可 | **现在就能验**（spec §0.3 双示已要求） |
| 色调 / 梯度族 | emboss, edge, duotone, posterize, sharpen | **连续色调照片**（逐字 / 整段都偏退化） | 需 `bg(image)`，见下 |

- **`bg(color)`**：`setBackgroundColor` 的 KMD 别名（special-commands 草案 §3 近期动作）。可作 M2 demo 背景底，但**纯色无连续色调 → 不验证任何滤镜**，只给文字对比底。
- **`bg(image)`**：色调族「教科书级」验证的唯一表面，但**不是一行 DIP 任务**，分两段成熟度：
  - **编辑器-dev 级**：从 `public/` 直接 `Assets.load(path)` → Sprite 挂 `StageManager.backgroundLayer`，不走 manifest/policy。**足以即刻验证色调族**，是解锁 M1 色调族完整验证的最小路径。
  - **阅读器-硬化级**：manifest `images` 通道 + `resolveControlledSourceUrl` 安全闸 + 作者图来源——属**资产引入机制** epic（跨 editor/reader-runtime/Work），见 §8.2。
- **结论**：M1 空间族今天即可验（`:block`）；色调族完整验证依赖 `bg(image)` 的编辑器-dev 级，后者依赖资产引入机制至少落地一段。`displace` 等 M2 创作滤镜同样靠 `bg(image)` 才能演示水下/折射在真实画面上的效果。

## 7. 报告叙事（课程角度）

不写成“我实现了 N 个 DIP 算法”，而是：“我为动态排版引擎设计了一个风格化滤镜库，其中运用了卷积、量化、形态学、点运算等图像处理技术。”作品是主角，课程知识是支撑，库的范围边界本身即一句图像处理定义。

## 8. 开放项

- 各滤镜最终 `targetType` 与作用域用法（char/group/block）已在 spec §1.1 / §3 定稿；block 纹理范围待 M0 实测（spec §7.2）。
- demo 作品的具体题材（歌词 / 视觉小说开场 / 赛博朋克标题序列）待定，将反向校正清单优先级。
- `frame`（全屏）作用域是否要做，取决于 demo——架构判断见 §9。**2026-07-09 订正**：`frame`（连同 `bg`）的触发语法不会走 `CommandLevel` 冒号后缀（`:frame`/`:bg`）——`docs/knowledge/language/design.md` D12 已封盘"覆盖范围永远不归 `:` 管，归主语管"，两者应作内建对象主语（`bg.<effect>(...)`，同 `cam`/`flow`/`var`）。DIP-FX M2 Task B（2026-07-09，`3a38445`）把 `:bg` 实现为 `CommandLevel` 第四值，正是漏看了这条决议，也漏看了下面这一条——本节早在 Task B 之前就已用 `bg.brightness`/`bg.blur` 的命名空间形态描述背景可读性用法。详见 spec §0.5.1、`migration.md` 解析器工程债 #9、架构体检处方 11/12。
- 背景图作为阅读体验一等表面（`bg.brightness`/`bg.blur` 为可读性）已立草案 `../ecosystem/reading-experience-vision-draft.md`；它给本库连续色调类滤镜定位了「背景表面」这个归宿（spec §7.3），与 `frame` 镜头层是不同的层。
- `bg` 命令本身（纯色别名 / 图像基底 / 叙事换景三重身份）的词汇表归属见 `../ecosystem/special-commands-vocabulary-draft.md` §3。
- DIP-FX 的"两用"承诺已收束为 surface profile 模型：同名效果复用视觉语义，但允许文字、背景、frame 使用不同 profile/default/shader。M3 不把完整 `bg.*` / `frame.*` 系统塞进收尾，只先补 profile 表与 demo 必需的最小背景 profile。

### 8.2 资产引入机制（`bg(image)` 与色调族验证的前置，待讨论/立草案）

`bg(image)`、未来的纹理类滤镜（displace 的位移贴图、noise/lut 的纹理）都依赖「KMD 怎么引入外部图像资产」。现状盘点（核对 `core/runtime/RuntimeAssetPolicy.ts`、`core/App.ts`）：

- **地基存在且资产无关**：`resolveRuntimeAssetUrl` 把相对路径解析到 `assetBaseUrl`（非字体专用）；`resolveControlledSourceUrl` 是安全闸（只放行白名单/https/同源，否则 throw）；`assetManifest` 现有 `fonts` 字段。字体范式 = manifest 声明 → 解析 URL → 加载器（FontFace + `Assets.load`）→ 用。
- **缺图片那一份**：manifest 无 `images` 通道；core 无图片加载器（grep 仅字体用 `Assets.load`）；作者图来源（本地上传 / URL / 随 Work 发布）未定。`bg(image)` ≈「对图片重做字体已做完的事」，无架构难题，是一份明确扩展工作。
- **两段成熟度**（§6.1）：编辑器-dev 级（`public/` 直接 load，解锁验证）可先行；阅读器-硬化级（manifest + 安全闸 + 作者来源）是跨 editor/reader-runtime/Work 的 epic，须过 `packages/reader-runtime-web.md` 资产策略。
- **已立草案**：`../ecosystem/asset-import-mechanism-draft.md`（资产引入机制：现状盘点 + 两段成熟度 + 设计决策点）。`bg` 命令的 editor-dev 级落地交接见 `../ecosystem/special-commands-vocabulary-draft.md` §10。

### 8.1 实现现状对照（M1 首审，2026-06-25）

落地与设想的差距盘点，供后续校正（细节见 spec §0.3 / review.md）：

- **作用域**：路由模型（`targetType:"both"` + 调用点 `:block`）本身对，spec「推荐作用域」列也保留了 bloom/halftone→block。但**默认演示**多走逐字，导致色调类看着像失效——本质是「默认呈现」与「样例只给一示」的问题，非算法错。已订正为「笔画级 / 连续色调级两种合法用法、样例须双示」。
- **默认参数**：emboss/edge 默认「替换」原图（吃掉字形）→ 改「叠加」（spec §4 卡）。
- **选型顺序**：先做了报告友好的教科书四件套，创作旗舰 `displace`（underwater 基石）/`dissolve` 留 M2 未做——`displace` 提为 M2 第一优先。
- **流程**：`edge` 带 GLSL 编译错误合并（build 不编译 shader）→ 补 shader 编译门禁（review.md A 节）。
- **工艺**：shader 功底、预乘 alpha 纪律、seek 幂等 infra（含 block seek 修复、`InstantCleanup` 扩 `Filter[]`）质量高，是加分项。漂移在产品方向与默认值，不在工艺。

## 9. 作用域与能力分层（含 “stage” 命名碰撞的处置）

本节回答三件相关的事：滤镜作用域怎么落、为什么不会把 KMD 锁进叙事、镜头系统未来去哪。细节与代码引用见 spec §1.1 / §7.1。

> 其中 §9.2 能力分层、§9.3 镜头插件化、“stage” 命名碰撞是**跨包跨应用的生态级判断**，权威与完整版已上移至 `../ecosystem/presentation-modes-and-capability-layering-draft.md`（草案）。本节只保留与滤镜库直接相关的摘要与触发点。

### 9.1 “stage” 的三重命名碰撞与处置

仓库里 “stage” 当前同时指三样东西，是迷惑的根源：

| 名字 | 指什么 | 处置 |
|---|---|---|
| `mode: "stage"` | **呈现模式**（定比例信箱，对 scroll/page） | 既有语言资产，**不动** |
| `StageRuntime`/`StageManager`/`stagePresets` | **镜头/电影感子系统**（cam/bg/scene.clear） | 既有代码，短期不改名；长期定位见 §9.3 |
| ~~stage-scope 滤镜~~ → **`frame`-scope** | 我们新造的“全屏后处理”作用域 | **现在改名为 `frame`**，把碰撞消灭在源头 |

`frame` = 在相机变换之后、对合成完的整帧做屏幕空间后处理。**2026-07-09 订正**：`frame` 名字仍保留，但不再计划挂进"四个作用域"的 `CommandLevel` 枚举——按 `design.md` D12，它和 `bg` 一样该走主语路线，不走 `:` 后缀。详见 §8、spec §0.5.1。

### 9.2 能力分层：为什么滤镜库不会把 KMD 锁进叙事

KMD 远不止叙事——它可作视频素材、字幕、提词器、叙事作品等。按能力的**普适性**分层，各能力的归属就清楚了：

| 层 | 普适性 | 字幕 | 提词器 | 视频素材 | 叙事 | 归属 |
|---|---|---|---|---|---|---|
| 内容 + 时序（文字揭示） | 全普适 | ✓ | ✓ | ✓ | ✓ | 核心 |
| 逐元素动效（effect：behavior/entrance/**filter**） | 大体普适、按需 | 可选 | 罕用 | 大量 | 大量 | 核心 |
| **背景作阅读基底**（bg 图 + 亮度/模糊为可读性） | 大体普适 | ✓ | ✓ | 部分 | ✓ | 核心（阅读层，见草案） |
| 镜头/电影感（cam/bg/scene、frame 后处理） | **形态专属** | ✗ | ✗ | 部分 | ✓ | 能力模块（见 §9.3） |

> **背景的两种身份要分清**（详见 `../ecosystem/reading-experience-vision-draft.md`）：作**阅读基底**（字铺图上、压暗虚化保证对比度）是跨形态普适的阅读核心；作**镜头场景**（叙事换景、运镜天幕）才是形态专属的镜头层。`bg.brightness`/`bg.blur` 的可读性那一刀落在普适侧——这也是本库连续色调类滤镜（blur/duotone/bloom…）的天然作用对象（spec §7.3）。

- **本滤镜库的 char/group/block 三作用域是跨形态普适能力**：字幕可用 fade/outline，视频素材大量用，叙事更不用说。它属核心，**不绑定叙事**。
- **只有 `frame` 作用域偏叙事/视频**，因为它本质是“对相机合成帧后处理”，属镜头层——因此它**不并入普适滤镜核心，而归镜头能力**（§9.3）。你担心的“被锁进叙事”，正是被这条切分挡住：普适的那部分留核心、专属的那部分隔离出去。

### 9.3 镜头系统的未来去向：概念上是插件，物理上分三段

镜头系统是“形态专属能力”，常驻默认开启会把 KMD 的默认身份推向“叙事电影播放器”。但 `docs/planning/ecosystem/repository-strategy.md` 明确：`packages/core` API 未稳定前不拆物理包。故路径分三段：

1. **现在（仅文档）**：命名这条缝——声明镜头为“形态专属能力模块”、滤镜库为“普适核心能力”；`frame` 作用域改名落地。代码不动。
2. **将来（下次碰 stage / mode 矩阵成熟时）**：在 core 内做**能力注册缝**，让 cam/bg/scene 作为“可门控能力”注册，非叙事 mode（scroll/字幕/提词器）可不加载——手法同 reader-runtime 已在做的“门控 editor-only 能力”。`frame`-scope 滤镜随这层一起接线（spec §7.1）。
3. **最终（由 `packages/core` 抽取门槛触发）**：物理插件 / 拆包，仅在 core API 稳定后。届时镜头能力可成为独立 `@kmd/*` 插件包。

> 本节是生态级判断的摘要。若镜头能力门控/插件化要正式立项，应在 `docs/planning/ecosystem/` 单列一份能力分层文档，并从 repository-strategy 链接。
