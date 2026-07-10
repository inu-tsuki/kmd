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
