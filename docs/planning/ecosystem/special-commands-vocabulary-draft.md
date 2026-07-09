# Special Commands Vocabulary & Roadmap Draft

> 文档状态：草案 / 初步想法（未立项）
> 最近更新：2026-06-25
> 触发来源：DIP 滤镜库审查时发现 `bg` 被 CLAUDE.md / 能力分层草案假设存在，实际代码里查无此命令——暴露出「舞台/特殊指令」缺一份前瞻词汇表
> 相关：`presentation-modes-and-capability-layering-draft.md`（分层）、`reading-experience-vision-draft.md`（背景的阅读基底身份）、`../../knowledge/runtime/core/command-routing.md`（路由机制）

## 0. 这份文档要回答什么

KMD 的命令体系此前有三条轴各有归属：

- **机制**——命令怎么从 AST 路由到渲染：`knowledge/runtime/core/command-routing.md`。
- **分层**——某能力属普适核心还是形态专属：`presentation-modes-and-capability-layering-draft.md`。
- **阅读基底**——背景作为可读性表面：`reading-experience-vision-draft.md`。

缺的是第四条轴：**「该有哪些特殊指令」的词汇表与路线图**——现状有哪些、规划要哪些、各属哪层、命名怎么定。`bg` 就掉进了这条缝：它被 CLAUDE.md 和能力分层草案当作存在的命令引用，但 `stagePresets.ts` 里根本没有。本文件补这条轴。

> 本文是词汇表与路线图，不是近期实施计划。它**记录该有什么**，不规定何时做。立项触发见 §8。

## 1. 什么是「特殊指令」（边界定义）

KMD 命令按作用对象分四类，本文件只管最后一类：

| 类别 | 触发语法 | 作用对象 | 归属文档 |
|---|---|---|---|
| 视觉特效 | `f.x` / `.x` | 字 / 词组 / 段（KineticChar/TokenWrapper/KineticText） | DIP 滤镜库 + effect-pipeline |
| 样式修饰 | `f.red` / `.bold` | 同上，改样式属性 | StyleManager |
| 排版指令 | `.goto` / `.offset` / `.mark` | 布局坐标流 | command-routing §94 |
| **特殊指令** | `cam.move` / `scene.clear` / `pause` / （`bg`?） | **整个演出/场景/播放**（非某个文字元素） | **本文件** |

> **判据**：特殊指令作用在「演出本身」而非「某段文字」上——它移动相机、切换场景、暂停时间线、铺设背景。它们大多是 `kind: "camera"|"scene"|"playback"|...` 的舞台命令，经 `partition()` 里 `stageManager.has(name)` 分流到 stageConfigs。

## 2. 现状盘点（`stagePresets.ts` 实际注册）

| 命令 | kind | propertyKey | 作用 | 层归属 |
|---|---|---|---|---|
| `cam.move` | camera | camera.xy | 相机平移 | 镜头 |
| `cam.zoom` | camera | camera.zoom | 相机缩放 | 镜头 |
| `cam.rotate` | camera | camera.rotation | 相机旋转 | 镜头 |
| `cam.focus` | camera | camera.xy | 对焦到目标 | 镜头 |
| `cam.offset` | offset | offset.xy | 相机偏移 | 镜头 |
| `cam.reset` | camera | camera.reset | 复位相机 | 镜头 |
| `cam.shake` | modifier | — | 相机震动（持续 modifier） | 镜头 |
| `cam.drift` | modifier | — | 相机漂移（持续 modifier） | 镜头 |
| `scene.clear` | scene | scene.lifecycle | 清场（`---` 的运行时路径） | 镜头/场景 |
| `pause` | playback | playback.pause | 时间线暂停 | 播放 |

观察：**现状几乎全是 `cam.*`（镜头）**，加 `scene.clear` 和 `pause`。**没有任何背景命令**——背景目前只有 host 侧 `StageManager.setBackgroundColor`（纯色，`StageManager.ts:218`）和一个**空置的 `backgroundLayer` 容器**（`StageManager.ts:25/37/41`），二者都没有 KMD 命令入口。

> ⚠️ **事实订正**：CLAUDE.md 称「Stage commands like cam.move, cam.zoom, `bg`, scene.clear are registered in stagePresets.ts」——`bg` 那项是**愿景，非现状**，应订正（见 §6 行动项）。能力分层草案 §2/§3 同样把 `bg` 列入镜头子系统，是前瞻一致、但今天未兑现。

## 3. 中心案例：`bg` 的三重身份

`bg` 卡在缝里，正因为它不属单一层——同一个「背景」概念有三种用途，分属三层：

| 身份 | 用途 | 层 | 现状 | 近期动作 |
|---|---|---|---|---|
| **纯色底** | `bg(#1a1a2e)` 设一个纯色背景 | 基础/播放 | host 有 `setBackgroundColor`，无 KMD 命令 | **`bg` 作为 `setBackgroundColor` 的 KMD 别名**（最小、最便宜，建议先做） |
| **图像基底** | `bg("scene.jpg")` + `bg.brightness`/`bg.blur` 保证文字可读 | 阅读核心（普适） | 无；`backgroundLayer` 容器空置 | 接背景图到 `backgroundLayer`，处理复用 DIP 连续色调滤镜 fn（reading-experience §3） |
| **叙事换景** | 随场景切换、运镜天幕、转场 | 镜头（形态专属） | 无 | 随镜头能力门控接线（capability-layering §5） |

**设计姿态**：三者**共用同一个 `backgroundLayer` 承载容器**（很可能），但**默认与归层不同**——纯色底是普适基础，图像基底是阅读核心，叙事换景是镜头专属。命名上用 `bg`（设置）+ `bg.*`（处理，如 `bg.brightness`/`bg.blur`/`bg.tint`），与 `cam.*` 的点命名空间一致。

> 这正是 §0 说的「贯穿三层」：`bg` 的词汇表条目在本文件，它的阅读基底语义在 reading-experience 草案，它的镜头换景语义在 capability-layering 草案。三处交叉链接，不重复定义。

## 4. 规划/设想中的特殊指令（全量盘点）

把「KMD 作为多形态演出引擎该有哪些演出级指令」一次性铺开，避免再有命令掉进缝里。状态：✅现状 / 🟡近期建议 / 🔵设想（未论证）。

### 4.1 镜头（cinematics，形态专属）
- ✅ `cam.move/zoom/rotate/focus/offset/reset/shake/drift`（现状）
- 🔵 `cam.path`（沿路径运镜）、`cam.follow`（跟随某 token）——叙事 demo 若需要再论证。
- 🔵 整屏后处理 `frame` 作用域（DIP `frame`，spec §7.1）——属镜头层，随门控接线。

### 4.2 场景 / 转场（scene）
- ✅ `scene.clear`（现状，`---` 的运行时路径）
- 🔵 `scene.transition`（淡入淡出/推拉/溶解换场）——目前 `---` 只有清场，无「带过渡地切到下一场」。叙事主线很可能需要。
- 🔵 `scene.goto`（跳到命名场景）——非线性叙事/分支时才需要。

### 4.3 背景（background，跨层，见 §3）
- 🟡 `bg(color)`：`setBackgroundColor` 的 KMD 别名（近期建议）
- 🔵 `bg(image)` + `bg.brightness`/`bg.blur`/`bg.tint`/`bg.vignette`：图像基底 + 可读性处理（reading-experience §3）
- 🔵 背景视差 / 随模式流动（scroll/stage/page 行为，reading-experience §5）

### 4.4 播放 / 时序（playback / timing，普适）
- ✅ `pause`（现状，时间线暂停）
- 🔵 `wait(Xs)` vs `pause`：二者语义是否重叠须厘清——`pause` 是停时间线等交互，`wait` 可能是「停留 X 秒后自动继续」。命名/语义待定。
- 🔵 `speed` / `tempo`（全局节奏标量）——现有 `~`/`^` 是行级语法糖，是否要个演出级命令？

### 4.5 音频（audio，设想，未论证）
- 🔵 `bgm(track)` / `sfx(clip)` / `audio.fade`：背景音乐与音效。叙事/视频形态的强需求，但牵扯资源策略（`RuntimeAssetPolicy`）、reader-runtime 可移植边界，**须单独论证**，本文件只占位。

> 4.5 一旦认真做，会显著扩大 runtime 的资源/许可面，必须先过 `packages/reader-runtime-web.md` 的资源策略。现仅登记，不展开。

## 5. 命名与约定（草案）

- **点命名空间按子系统**：`cam.*`（镜头）、`scene.*`（场景）、`bg` + `bg.*`（背景设置 + 处理）、`audio.*`（音频）。与现有 `cam.*` 一致。
- **别名策略**：host 已有能力（如 `setBackgroundColor`）优先以**短 KMD 别名**暴露（`bg`），而非新造一套——降低实现面、对齐既有 host 契约。
- **`partition()` 分流**：新特殊指令注册进 `stagePresets.ts`（或未来按层拆分的注册文件），经 `stageManager.has(name)` 自动分流，无需改 `Parser.validate()`（同 DIP filter，spec §1 纠正 1）。
- **门控感知**：形态专属指令（cam/scene/frame）应可被能力门控（capability-layering §5）；普适指令（bg 纯色、pause、wait）默认可用。

## 6. 行动项（事实订正 + 近期最小动作）

- **订正 CLAUDE.md**：把「`bg` ... registered in stagePresets.ts」改为现状（无 `bg` 命令；背景只有 `setBackgroundColor` + 空置 `backgroundLayer`），并指向本草案为规划。
- **近期最小动作（若要兑现 `bg`）**：`bg(color)` 作为 `setBackgroundColor` 的 KMD 别名，注册进 `stagePresets.ts`，`kind: "background"` 或复用 playback/scene kind（待定）。这是三重身份里成本最低、且立即消除「文档假设存在但代码没有」矛盾的一步。
- **交叉链接**：capability-layering §2/§3、reading-experience §6 的 `bg` 引用回链本文件。

## 7. 与三条轴的关系（不重复定义）

| 轴 | 文档 | 回答 |
|---|---|---|
| 机制 | command-routing.md | 命令**怎么**路由（partition/lowering/消费路径） |
| 分层 | capability-layering-draft | 某能力属普适核心还是形态专属、镜头去哪 |
| 阅读基底 | reading-experience-draft | 背景作为可读性表面的愿景 |
| **词汇表** | **本文件** | **该有哪些特殊指令、现状 vs 规划、命名约定** |

本文件只管「该有什么命令」；具体某命令属哪层去 capability-layering，怎么路由去 command-routing，背景可读性去 reading-experience。

## 8. 立项触发条件

满足任意两条，可把相关条目从设想升为正式规划：

- 叙事 demo 实际需要某特殊指令（`bg` 图像、`scene.transition` 很可能最先触发）。
- 能力门控缝（capability-layering §5 第 2 段）开始实施，需要明确哪些特殊指令进门控。
- 出现非叙事形态（字幕/提词器）需求，需厘清哪些特殊指令普适、哪些专属。

## 9. 相关文档

- `presentation-modes-and-capability-layering-draft.md` —— 特殊指令的**分层**归属、镜头门控/插件化。
- `reading-experience-vision-draft.md` —— `bg` 的**阅读基底**身份、背景作一等表面。
- `asset-import-mechanism-draft.md` —— `bg(image)` 依赖的资产引入机制（图片加载/声明/安全闸）。
- `../../knowledge/runtime/core/command-routing.md` —— 命令**路由机制**（舞台指令消费路径 §114）。
- `repository-strategy.md` —— 物理拆包/插件化门槛（音频等重能力的资源策略前置）。

## 10. 近期执行交接：editor-dev `bg`（交给代码编写者）

> 这是一份**编码交接稿**（非规划讨论）。目标：让作者能在编辑器里铺背景，从而验证 M1 文字滤镜叠在真实画面上的读感、并为 M2 demo 备背景底。**编辑器-dev 级，不走 manifest/安全闸**（阅读器-硬化级见 `asset-import-mechanism-draft.md`）。

### 范围
- **B1 `bg(color)`**：`StageManager.setBackgroundColor` 的 KMD 别名。
- **B2 `bg(src)`（editor-dev）**：从 `public/` 直接加载图片挂 `backgroundLayer`。
- **B3 `:bg` 滤镜路由（已纳入本批）**：把 DIP 滤镜应用到背景图本身（tonal-on-photo，色调族照片级验证）。详见下「B3」。
- **非目标**：manifest/安全闸/作者图来源属资产 epic，不在本交接（阅读器-硬化级见 `asset-import-mechanism-draft.md`）。

### 落地点
- **命令注册**：`core/stage/stagePresets.ts`——`stageCommandMetadata` 加 `bg` 定义项（`kind` 新增 `"background"` 或复用，`propertyKey: "background.set"`），`stagePresets` 加 `bg` apply 函数。单命令按参数分派：有 `color` → 纯色；有 `src`/`image` → 图片。
- **背景能力**：`core/stage/StageManager.ts`——`setBackgroundColor`（`:218`，纯色现成）、`backgroundLayer` 容器（`:25/37/41`，图片挂这里）。从 stagePresets 经 `stageManager` 单例触达。
- **加载范式**：抄 `core/App.ts` 的 `Assets.load`；`import { Assets, Sprite, Texture } from "pixi.js"`。

### B1 实现要点
- apply：`const c = p.color ?? p[0]; if (c != null) stageManager.setBackgroundColor(c);` 同步，返回 `null`/0-dur tween。

### B2 实现要点（editor-dev）
- apply：`const url = p.src ?? p.image ?? p[0];` → `Assets.load(url).then(tex => { ... })`。Vite 把 `public/` 映射到根，dev 直接用相对路径（如 `tests/assets/photo.jpg`）；**dev 级不强制过 `resolveRuntimeAssetUrl`/安全闸**。
- 挂载：`const spr = new Sprite(tex);` → **cover 适配** designWidth/designHeight（按比例缩放铺满信箱）→ 清掉上一张背景 sprite → `stageManager.backgroundLayer.addChild(spr)`。
- 清理：用模块级变量记当前 bg sprite，换背景 / `scene.clear` 时 `spr.destroy()` + `tex` 释放，避免 GPU 泄漏（同 DIP filter 的 `destroy()` 纪律）。
- **⚠️ 阻抗（须标注，dev 可接受）**：`stagePresets` 的 apply 约定**返回 GSAP tween（同步）**，而 `Assets.load` 是异步——dev 级用 **fire-and-forget**（apply 内启动 load、resolve 时加 sprite，apply 本身返回 `null`）。后果：背景在加载完成后才出现（首帧可能空）；seek/重播的幂等不保证。这两点都属**阅读器-硬化级**再解决，dev 验证够用。

### 注册与校验
- 经 `stageManager.has("bg")` 自动 known（同 `cam.*`），**不改 `Parser.validate()`**（同 DIP filter，spec §1 纠正 1）。验收只需 `bg(...)` 不报 `Unknown command`。

### 交付物
- 示例 `public/tests/fx-bg.kmd`：`bg(color="#1a1a2e")`、`bg(src="tests/assets/<sample>.jpg")`、图上叠文字（验证 `f.outline`/`f.bloom` 在真实画面上的读感）。需附一张 sample 图进 `public/tests/assets/`。
- `pnpm build` 通过；`pnpm dev` 实测背景出现、cover 适配正确、换背景/清场无残留。

### B3 `:bg` 滤镜路由（已纳入本批，2026-07-09 落地后语法方向订正——见下方【订正】）
要把 duotone/emboss 等 DIP 滤镜**应用到背景图本身**（色调族「教科书级」验证 / 报告素材），需要一条「滤镜路由到 `backgroundLayer`」的路径。最小且前向兼容的做法：新增 `:bg` 作用域（复用 DIP 滤镜 `fn` 不改，把 `target` 解析为 `backgroundLayer` 上的当前 bg sprite，同 spec §1.1「写一次多作用域复用」），用法 `[.duotone:bg]`。它也是 `reading-experience` 的 `bg.brightness`/`bg.blur` 的底层（后者可作 `:bg` 语法糖）。

> **【订正】** 上一段把 `:bg` 定为底层、`bg.brightness`/`bg.blur` 降级为其语法糖——顺序反了。`docs/knowledge/language/design.md` D12 封盘"覆盖范围永远不归 `:` 管，归主语管"：`:bg` 选的是目标（背景精灵），理应由主语承担，`bg.<effect>(...)` 才是底层形态，`:bg` 至多是过渡期兼容写法。落地时也漏看了本节第 160 行自己的断言——"经 `stageManager.has("bg")` 自动 known（同 `cam.*`）"——`classifyCommand` 的真实判据是 `stageManager.has(name) && !effectManager.has(name)`，而 `visual.ts` 已注册同名元素级 `bg` 效果，`effectManager.has("bg")` 恒真，`bg(color=...)`/`bg(src=...)` 命令因此从未被路由到新 `stagePresets.ts` 实现。详见 spec §0.5.1、`migration.md` 解析器工程债 #9、架构体检处方 11/12。

- **落地点**：作用域解析在 `ScopeRouter` / `EffectProcessor`——`:bg` 把 effect target 解析为 `stageManager` 当前 bg sprite（B2 的模块级变量），filter 挂到该 sprite 的 `filters`。DIP 滤镜 `fn`/`meta` 不改。
- **依赖**：必须在 B2 之后（要有 bg sprite 才能挂滤镜）。
- **交付物**：示例 `public/tests/fx-bg.kmd` 增 `[.duotone:bg]` / `[.emboss:bg]` 段，验证色调族在真实照片上的教科书级效果。
- **验收**：`[.x:bg]` 不报 `Unknown command`/`Unknown scope`；`pnpm dev` 实测滤镜正确叠到背景图、与文字层独立、换背景/清场无残留 filter 泄漏（`destroy()` 纪律）。
