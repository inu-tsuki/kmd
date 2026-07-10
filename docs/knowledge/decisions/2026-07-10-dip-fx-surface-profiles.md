# DIP-FX Surface Profiles

- 日期：2026-07-10
- 状态：已采纳为 M3 gate

## 回应的力

DIP-FX 原规划强调"写一次、多作用域复用"，但 M1/M2 的实际落地已经把部分滤镜做成了更适合文字的版本。例如 `duotone` / `emboss` / `edge` 等在逐字小纹理上需要读取 alpha、笔画边缘或文字覆盖形状，不能再简单等同于照片级 RGB / luma 算法。

如果继续把"两用"理解成同一个 shader、同一组默认值无差别作用在文字和背景上，会有两个坏结果：

- 已经调好的文字观感被背景/图片语义反向拖坏。
- 背景图作为连续色调表面的教科书级 DIP 价值被文字适配稀释。

因此 M3 之前必须明确：DIP-FX 的复用单位是"效果语义"，不是强制单一 shader。

## 决策

DIP-FX 引入 **surface profile** 模型。

一个效果名可以跨 surface 复用，但每个 surface 可以有自己的 profile、默认值、参数解释，必要时也可以有不同 shader。作者看到的是稳定的效果语义；runtime / preset 选择适合目标表面的实现。

初始 surface：

| Surface | 目标 | 语义 |
|---|---|---|
| `text` | `KineticChar` / `TokenWrapper` / `KineticText` | 字形、笔画、alpha 边缘、逐字或整段文字纹理 |
| `background` | `StageManager` 当前背景 sprite | 阅读基底，首要为可读性，其次为氛围 |
| `frame` | 未来整帧后处理挂点 | 相机合成后的镜头层后处理，形态专属 |

实施原则：

- 同名效果若语义一致但信号模型不同，保留同名并拆 profile。例如 `duotone:text` 可以用 alpha / 笔画覆盖做文字渐变，`duotone:background` 可以用 luma / RGB 做照片调色。
- 若语义已经不同，拆名，不为了"两用"强行复用。例如文字 alpha 内描边与照片边缘检测不应共享同一个 `edge` 承诺。
- `:bg` 只是旧解析器兼容层。终态仍由 Phase B 主语链表达为 `bg.<effect>(...)`；M3 不继续扩张 `CommandLevel`。
- `frame` 不进入 `CommandLevel`，也不作为 M3 默认实现项；若 demo 需要整屏后处理，应另排镜头层能力。

## 方案对比

### 方案 A：坚持单 shader 两用

做法：所有支持 `both` 的滤镜都复用一个 `fn` / shader / 默认值，只通过不同 target 容器改变输入纹理。

代价 / 局限：实现最省，但会把文字和背景的信号模型混在一起。文字适配需要 alpha / 字形边缘；背景图需要 RGB / luma / 连续色调。两者强行一致会让一边退化。

### 方案 B：按效果拆成 text/background 两套名字

做法：所有分歧都显式改名，例如 `textDuotone`、`bgDuotone`。

代价 / 局限：语义最清楚，但作者心智变重，DIP-FX 会变成一堆表面专用命令，丢掉"同一个视觉意图跨表面成立"的语言优势。

### 方案 C：surface profile（采纳）

做法：效果名保留语义统一，效果 metadata / spec 标注支持的 surface 与 profile；实现可在内部按 surface 分派。

代价 / 局限：需要补一层 metadata 与文档表；未来实现 `bg.<effect>` 时要让路由携带 surface。

为什么最简方案不够用：M1/M2 已经证明文字滤镜不是连续色调滤镜的简单小纹理版本。继续单 shader 两用会让规划与实现互相扯坏。

## 触碰的不变量

- `targetType` 仍只表达 char/group/both 的旧 effect apply 能力，不扩展成 `background` 或 `frame`。
- `CommandLevel` 不再增加主语性质值；`:bg` 是兼容债，不是新模型。
- filter cleanup、seek 幂等、background sprite 生命周期仍按既有 effect pipeline 与 StageManager 纪律处理。
- 背景可读性操作的终态入口是 `bg.*`，不是文字滤镜语法的永久变体。

## 与 house style 的关系

这个决策延续仓库已有的"主语承担目标，作用域只管粒度"原则，也延续 reader/runtime 分层中的能力门控思路：普适阅读基底与镜头层后处理分开，不把所有显示表面塞进一个枚举。

## 可逆性

文档与 metadata 层可逆。若后续实现发现某个效果完全不需要拆 profile，可以把该效果标回单一实现；如果某个 profile 语义分裂过大，可以再拆名。该决策不锁死 KMD 源码格式，因为终态语法仍挂在 Phase B 主语链上。

## M3 落地方式

M3 不实现完整 `bg.*` / `frame.*` 系统。M3 先补 surface profile 表，作为 demo 与报告叙事的入口 gate：

- 为现有 DIP-FX 效果标注 `text-only`、`background-ready`、`profile-split`、`future-frame`。
- 更新示例/报告措辞：DIP-FX 复用的是视觉语义，具体实现按 surface 选择正确信号模型。
- 仅当 demo 需要时，挑选少数 `background` profile 做受限实现；其余留给后续 `bg.*` 规划。

## 结果

本 ADR 作为 M3.0 规划 gate。后续实现应先更新 DIP-FX spec 的 surface/profile 表，再决定 M3 是否需要具体背景 profile 代码。

**2026-07-10 gate 通过**：17 个 DIP-FX 效果已标注 surface profile（见 spec §3 表格 `surface profile` 列 + §0.6 标注结果）：

| profile | 数量 | 效果 |
|---|---|---|
| `text-only` | 4 | `threshold` / `posterize` / `sharpen` / `outline` |
| `profile-split` | 4 | `emboss` / `edge` / `duotone` / `underwater` |
| `background-ready` | 9 | `pixelate` / `gray` / `bloom` / `halftone` / `scanline` / `dissolve` / `displace` / `noise` / `vignette` |

标注依据：shader 信号模型——读 alpha/stroke/glyph coverage 的（单色字 RGB luma 恒定、alpha 有梯度）标 `text-only` 或 `profile-split`；读 RGB/luma/geometry 的（surface-agnostic）标 `background-ready`。`scanline`/`noise`/`vignette` 的 `future-frame` 升级路径不变。

## 2026-07-10 浏览器验证

在 production reader bundle 中用 Playwright Chromium 分别验证 `fx-bg.kmd` 的自然播放与定点 seek，并在每个落点等待 300–500ms 让 `bg(src)` 异步加载稳定后观察实际背景。`pnpm test:shaders` 同轮为 19/19 通过，因此以下现象不是 GLSL 语法失败，而是 surface 信号模型与路由/生命周期不匹配。

**自然播放路径（用户报告的“完全不起效”）**：在 4× timeScale 下连续播放，分别于 duotone、emboss、gray 段稳定后读取 live background sprite，三处均为 `filters: []`、`textureDestroyed:false`；三张 1280×720 截图 SHA-256 完全相同。这证明效果不是“太弱看不出”，而是没有留在最终 sprite 上。根因是同一时间点 `bg(src)` 先启动异步 `Assets.load`，`:bg` 的 `tl.call` 随即把 filter 挂到当前旧 sprite；load resolve 后 `setBackgroundSprite(newSprite)` 销毁/替换旧 sprite，新 sprite 没有 filter。自然播放的 apply 所有权必须转移到 load 后的 live sprite，而不能以“触发 `tl.call` 时存在 sprite”为就绪条件。

**定点 seek 路径**会暴露另一层问题：filter 可以暂时/在重放路径中挂到背景，但 profile 与历史 record 语义仍不正确：

- **`duotone:bg` 实际生效但退化为纯 highlight 色**：当前 `DuotoneFilter` 用 `c.a` 作为 `shadow → highlight` 插值因子。JPEG 全图 alpha≈1，故所有像素都落到 highlight，原图明暗细节完全丢失。这验证了 `duotone` 必须保持 `profile-split`；background profile 应读取 RGB luma（或等价的连续色调信号）。
- **`emboss:bg` 无法产生照片浮雕细节**：当前 `EmbossFilter` 对 alpha 做方向梯度。全不透明背景内部 alpha 恒定，梯度≈0，只得到平坦的中灰混色。这验证了 background profile 应从 RGB luma/颜色梯度构造 height field，不能复用文字 alpha profile。
- **`gray:bg` 的 shader 可用于图片，但当前路由不会应用它**：`gray` 同时注册为文字 style 与 filter；`classifyStyleWrite` 只按名称命中 style，`:bg` 随后走“style 不适用于 background sprite”的 skip 分支，未创建 `GrayFilter`。`background-ready` 表示 shader/profile 可复用，不代表现有兼容路由已接通。
- **顺序 seek 会重放更早的背景 instant filters**：`registerInstantEffects` 重放所有 `timePosition <= currentTime` 的 record，并以 `force=true` apply；颜色类 filter 又标为 `stackable:true`。因此后续段落可能先重放早先的 `duotone:bg`，再叠 emboss/gray。前置 duotone 已把背景压成纯色，后续效果无法恢复原图细节。background filter state 需要自己的 clear/replay boundary，不能直接继承“segment 内 instant record 永久累积”的文字模型。

实现结论：先修自然播放的异步 target 所有权，使 filter 应用于本次 `bg(src)` resolve 后的 live sprite；再实现 surface profile 与 replay boundary。作者仍使用稳定的 `duotone` / `emboss` / `gray` 语义；runtime 按 surface 选择 profile。内部优先使用独立的 `BackgroundDuotoneFilter` / `BackgroundEmbossFilter`（或等价的 profile 实现），避免把文字与照片信号模型塞进一个隐式分支。`gray` 复用现有 shader，只修 surface-aware 路由。`underwater:background` 内嵌 duotone，同样必须选择 background profile。

## 2026-07-10 实施结果

决策已落地为 runtime 能力，而不再只是 M3 gate：

- `EffectDefinition` 可为同一效果注册 `text` / `background` profile；`EffectManager.apply` 由调用路径携带 surface 并选择实现，作者语法不分裂。
- `duotone:background` 使用 RGB luma 做 shadow/highlight 映射；`emboss:background` 使用 RGB luma 方向梯度。文字版 alpha profile 保持不变，`gray` 复用现有 shader，`underwater` 的 duotone 随 surface 分派。
- `bg(src)` 先移除旧 sprite，再异步加载；同点 background effect 等待本次 resolve 后的 live sprite。seek replay 以最后一条有效 `bg` record 为 boundary，不继承更早背景的 filter 历史。
- `level === "bg"` 时 effect registry 优先于同名 style registry，解决 `gray:bg` 被 Graphics style 抢占的问题。

验证结果：playback 回归 315/315（含 SA-47），shader 编译 21/21（20 个 filter 文件），production Playwright e2e 2/2。e2e 同时覆盖定点 seek 与 4× 自然连续播放，并在 control / duotone / emboss / gray 稳定落点检查 live filter profile、纹理存活、截图差异与浏览器错误。

## 实现组织原则：effect-first, surface-second

surface profile 的代码按**效果语义聚合**，再在效果目录内区分 surface。例如 `duotone/` 同时拥有 `TextDuotoneFilter` 与 `BackgroundDuotoneFilter`；作者面对的稳定语义仍是 `duotone`。不建立顶层 `text/` 与 `background/` 两棵平行目录，因为那会把同一效果的参数、默认值、测试与演进拆散，也会迫使 `GrayFilter` 这类 surface-agnostic 实现选择一个并不真实的归属。

规则如下：

- 只有一个通用实现的效果继续以单文件存在，例如 `GrayFilter.ts`。
- 同一效果出现两个或更多 profile 时，建立以效果名命名的目录；profile 类显式使用 `Text*`、`Background*` 等前缀，并由该目录的 `index.ts` 导出。
- preset 只从效果目录的公开入口导入 profile，不依赖目录内部文件路径。
- profile 目录是内建 runtime 的组织约定，不是第三方插件必须复制的文件结构。插件边界应由类型化 contribution、capability metadata 与生命周期契约定义。
- 移动或改名不得顺带改变 shader、uniform、padding、默认参数、mutex/stackable 或 seek/cleanup 语义；行为变化必须单独立项。

采用该组织后，`duotone` / `emboss` 是 profile-split 效果，`gray` 是共享实现；`underwater` 作为组合 preset 按调用 surface 选择已有 duotone profile，不复制 shader。
