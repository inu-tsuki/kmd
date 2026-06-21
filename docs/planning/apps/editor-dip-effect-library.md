# Editor DIP Effect Library Plan

> 状态：Active planning
> 最近更新：2026-06-13
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
- **M2 创作集 + demo 作品**：补 3.2，并产出 1~2 个 KMD 演示作品（含“运动+滤镜”合成镜头，如 underwater）作为答辩成片。
- **M3 收尾**：非 DIP 配套 behavior 按 demo 缺口补；整理报告叙事（库边界 = DIP 定义）。

## 7. 报告叙事（课程角度）

不写成“我实现了 N 个 DIP 算法”，而是：“我为动态排版引擎设计了一个风格化滤镜库，其中运用了卷积、量化、形态学、点运算等图像处理技术。”作品是主角，课程知识是支撑，库的范围边界本身即一句图像处理定义。

## 8. 开放项

- 各滤镜最终 `targetType` 与作用域用法（char/group/block）已在 spec §1.1 / §3 定稿；block 纹理范围待 M0 实测（spec §7.2）。
- demo 作品的具体题材（歌词 / 视觉小说开场 / 赛博朋克标题序列）待定，将反向校正清单优先级。
- `frame`（全屏）作用域是否要做，取决于 demo——架构判断见 §9。

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

`frame` = 在相机变换之后、对合成完的整帧做屏幕空间后处理。四个作用域定为 `char / group / block / frame`，无一叫 stage。

### 9.2 能力分层：为什么滤镜库不会把 KMD 锁进叙事

KMD 远不止叙事——它可作视频素材、字幕、提词器、叙事作品等。按能力的**普适性**分层，各能力的归属就清楚了：

| 层 | 普适性 | 字幕 | 提词器 | 视频素材 | 叙事 | 归属 |
|---|---|---|---|---|---|---|
| 内容 + 时序（文字揭示） | 全普适 | ✓ | ✓ | ✓ | ✓ | 核心 |
| 逐元素动效（effect：behavior/entrance/**filter**） | 大体普适、按需 | 可选 | 罕用 | 大量 | 大量 | 核心 |
| 镜头/电影感（cam/bg/scene） | **形态专属** | ✗ | ✗ | 部分 | ✓ | 能力模块（见 §9.3） |

- **本滤镜库的 char/group/block 三作用域是跨形态普适能力**：字幕可用 fade/outline，视频素材大量用，叙事更不用说。它属核心，**不绑定叙事**。
- **只有 `frame` 作用域偏叙事/视频**，因为它本质是“对相机合成帧后处理”，属镜头层——因此它**不并入普适滤镜核心，而归镜头能力**（§9.3）。你担心的“被锁进叙事”，正是被这条切分挡住：普适的那部分留核心、专属的那部分隔离出去。

### 9.3 镜头系统的未来去向：概念上是插件，物理上分三段

镜头系统是“形态专属能力”，常驻默认开启会把 KMD 的默认身份推向“叙事电影播放器”。但 `docs/planning/ecosystem/repository-strategy.md` 明确：`packages/core` API 未稳定前不拆物理包。故路径分三段：

1. **现在（仅文档）**：命名这条缝——声明镜头为“形态专属能力模块”、滤镜库为“普适核心能力”；`frame` 作用域改名落地。代码不动。
2. **将来（下次碰 stage / mode 矩阵成熟时）**：在 core 内做**能力注册缝**，让 cam/bg/scene 作为“可门控能力”注册，非叙事 mode（scroll/字幕/提词器）可不加载——手法同 reader-runtime 已在做的“门控 editor-only 能力”。`frame`-scope 滤镜随这层一起接线（spec §7.1）。
3. **最终（由 `packages/core` 抽取门槛触发）**：物理插件 / 拆包，仅在 core API 稳定后。届时镜头能力可成为独立 `@kmd/*` 插件包。

> 本节是生态级判断的摘要。若镜头能力门控/插件化要正式立项，应在 `docs/planning/ecosystem/` 单列一份能力分层文档，并从 repository-strategy 链接。
