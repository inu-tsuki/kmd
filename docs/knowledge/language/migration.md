# 历史形态与迁移

> 最近更新：2026-07-08
> 状态：随实现更新（本文对照"当前已实现语法"与"封盘规范"，实现推进时逐项勾销）

新规范落地前，现有 `.kmd` 语料（`apps/editor/public/`）按旧形态运行。本文是旧 → 新对照表与解析器工程债清单。

## 语法形态对照

| 旧形态 | 新形态 | 决议 | 兼容策略 |
| --- | --- | --- | --- |
| `f.red.wave` | `{}.red.wave` / `{文本}.red.wave` | D5 | `f.` 作兼容形保留一段时间，诊断提示 |
| `camZoom(+0.1)` | `.(cam.zoom(+=0.1)):char` | D10, D12 | 合成词降级为历史糖 |
| `+0.1` 相对值 | `+=0.1` | D7 | 裸 `+x` 回归正数字面量 |
| `f.hold(1s)` / `ease` | 连接符 `-1s->` / `~1s~>` | D8 | 单词形态过渡期兼容 |
| `@ up(100).mark(p)` 裸排版链 | `@ .up(100).mark(p)` | D18 | 弃用，诊断提示补裸点 |
| `markStart(p)` / `markEnd(p)` | 点/域访问器（`mark(p)` + `.start`/`.end`） | D14 | 待选区模型落地后收编 |
| `var.` 强制前缀 | 作用域链裸名；`var.` 为全限定/文档级声明 | D19 | 旧写法天然兼容（是新规范的子集） |
| `pause:char` 的"层级"读法 | 实例化粒度"逐字"读法 | D12 | 语义澄清，行为兼容 |
| `:bg`（`CommandLevel` 加 `"bg"`，DIP-FX M2 Task B，2026-07-09） | `bg.<effect>(...)`——`bg` 作内建对象主语（同 `cam`/`flow`/`var`），覆盖范围归主语，不归 `:` | D12 | **临时兼容保留**：`:bg` 在旧解析器下先用（`CompatProjector` 思路），Phase B 落地时改写为 `bg` 主语形态，非逐字迁移 |
| 链数失配 first/last 重分配 | 诊断错误 | D17 | **行为变更**：依赖旧行为的脚本需显式改写 |
| `[align=center .glitch]` 混装 | 段级选项 + 段首句子的两类定义 | D22 | 语义澄清，形态不变 |

## 解析器工程债

按新规范必须处理的实现问题（发现于 2026-07 审查）：

1. **`cam.` 占位符黑客** — `KMDCommandParser.ts`（`NAMESPACE_CAM_DOT_` 字符串替换）。从句语法根治；链拆分回归括号深度计数。
2. **成员解析正则** — `KMDCommandParser.ts` 的 `(?:\(([^)]*)\))?` 不支持嵌套括号；从句、`$()`、值域、量词要求重写为小型递归下降。
3. **失配静默重分配** — `ScopeRouter.applyLineCommands`（首链给首组、余链全给末组，零诊断）。按 D17 改诊断。
4. **裸点排版的 pre/post 复制** — `ScopeRouter.ts` 的 `lineScope` 代偿。点/域模型落地后改为域端点操作。
5. **跨注册表重名静默裁决** — `commandCatalog.getFamily` 的固定优先级。按 D21 改诊断。
6. **`autoConvert` 特判** — `var.` 字符串直通、量词退化为字符串。按 D19/D24 由作用域链与类型化量词取代。
7. **`parseInstruction` 只取链首** — 指令链其余成员被静默丢弃。
8. **`KMDParser.validate()` 已知名检查** — 升级为作用域链查找 + doesNotUnderstand 风格诊断。
9. **`CommandLevel` 混入主语概念（`"bg"`）** — DIP-FX M2 Task B（2026-07-09）在 `parser/types.ts` 给 `CommandLevel` 加了 `"bg"`，用冒号后缀（`:bg`）表达"目标是背景精灵"，与 D12"覆盖范围永远不归 `:` 管，归主语管"直接冲突（详见 `chain-model.md` §"实例化粒度"）。落地时漏看了两处已有决议：本文件的 D12，以及 `editor-dip-effect-library.md` §9.1 早已把第四作用域预留名为 `frame`（未曾用过 `bg`）。新解析器落地时，`:bg` 应收编为 `bg` 主语（`bg.<effect>(...)`），`CommandLevel` 应恢复为纯粒度枚举（`char/group/block`，`frame` 若要开放亦作独立主语或轻量挂点，不进此枚举）。

## 迁移步骤建议

1. 新链解析器（递归下降）+ 主语作用域链，旧形态全部走兼容投影（`CompatProjector` 的既有职责），行为不变。
2. 打开诊断：失配、重名、弃用形态提示。
3. 语料迁移：`apps/editor/public/` 与 `public/tests/` 逐个改写为新形态，作为新解析器的回归样本（沿 `final-parser-test.ts` 惯例加测试脚本）。
4. 兼容形态进入弃用期，最终移除并更新 `packages/language` 语法资产与 `kmd-writing-guide.md`。
