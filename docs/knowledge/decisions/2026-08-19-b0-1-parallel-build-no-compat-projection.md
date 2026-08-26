# ADR：B0.1 并行建造——typed syntax AST 为唯一事实源，不设兼容投影

- 日期：2026-08-19
- 状态：已采纳（决策者裁决，gate-8 回复见 PR #30 评论区）
- 取代：候选 ADR `2026-08-12-typed-chain-ast-legacy-projection.md`（位于 `codex/todo-integration`
  分支 / PR #30；其工艺骨架被本决策吸收，兼容投影框架作废）
- 关联：`docs/planning/roadmap/phase-b/frontend-architecture-design.md`（canonical，§0/§7）、
  `docs/planning/roadmap/phase-b/b0.1-detailed-design.md`（施工细则）

## 回应的力

B0.1 要求两件事同时成立：(1) D24 要求量词类型化（`1s`、`0.5line`、`+=0.1` 不再退化为
number/string）；(2) 现有 layout/effect/stage/playback 大量直接把 `EffectParams` 当
number/string 消费。候选 ADR 由此推出「typed AST + 单一 LegacyCommandAdapter 迁移期投影 +
旧 corpus compat view 零 diff」方案，并要求精确复刻旧怪癖（字符串不解 escape、
`parseFloat + suffix` 的偶然 coercion）。

但项目处于实验期（CLAUDE.md Working Stance）且交付模型已裁决为**并行建造 + 一次性切换**：
没有线上用户，没有兼容责任。候选方案的复刻职责（D3/D4/D7/D8）是在为不存在的用户
维护一副永远不会交付的兼容骨架——它把实验期明令摆脱的包袱重新装了回来。

## 方案对比

### 方案 A：typed quantity 直接塞入现有 EffectParams（候选 ADR 已否决，维持否决）

做法：`autoConvert()` 返回 quantity object，沿用现有 `ParsedCommand → ScopeRouter → EffectConfig` 路径。
代价：typed value 扩散到全部 consumer；B0.1 被迫同时改 runtime；多套 coercion 分叉；
natural playback 与 seek/replay 重复转换，违背「参数构建期一次消解」。

### 方案 B：typed AST + LegacyCommandAdapter 迁移期投影（候选 ADR 推荐，部分采纳）

做法：递归下降 parser 产 typed AST；单一 adapter 在边界把 typed value 降为 legacy command value；
compat golden 要求旧 corpus 零 diff。
代价：adapter 与 compat view 成为永久翻译税；复刻怪癖让该死的语义多活一个阶段；
「零 diff」与「语料重写 = 完备性审计」直接冲突——它要求新语言对旧行为逐字节负责，
而实验期姿态要求行为变更有意为之地发生。

### 方案 C：并行建造，无投影（采纳）

做法：typed syntax AST 是唯一语言事实源；新 parser 在自己的模块空间建造，只对自己的
fixture/golden 负责；**不接任何生产入口、不建 adapter、不做 compat view**；旧前端冻结服务
编辑器直至切换日；切换日（B0–B2 垂直切片完成）一次性切换 + 语料全量重写 + 旧前端 grep 级删除。
代价 / 局限：建造期新前端不接触生产流量（由设计探针脚本补偿，canonical §7.1）；
切换日一次完成的爆炸半径大于分批迁移（由按缝审计与 331 playback 线性子集守护，canonical §6/§7.3）。

为什么最简方案不够用：方案 A 把一次前端重构扩大为 parser + layout + effects + stage + playback
的同步迁移，失去一切行为证据。为什么方案 B 也不够：它的骨架是对的（typed AST 单源、
无双 parser、结构化诊断），但投影半区在实验期是纯负债——兼容投影存在的唯一理由是
「有用户要兼容」，而本项目没有。

## 决策

1. typed syntax AST 是链语法的唯一事实源；目标态下游是 DocumentSemanticIR + middleware（canonical Part IV）。
2. 生产路径不保留双 parser、无 runtime feature flag；回滚 = git revert。
   并行建造形态：旧前端持有旧入口直至切换日，新 parser 建造期不接入口。
3. 不设 LegacyCommandAdapter，不建 compat view，不要求旧 corpus 零 diff。
   characterization 基线保留为「旧行为参照系证据」，不作保险丝。
4. 新 parser 自建 golden（证据库）；切换日语料全量重写，重写即完备性审计（canonical §7.3）。
5. 字面量有意变更明文标注：字符串消费 decoded value（不复刻不解 escape）、
   NUMBER 词法放宽（`+1/.5/1e3` 合法）、malformed quantity 诊断收紧（`1ss` 不再偶然容忍）。
6. B0.1 施工细节（文法、节点形状、诊断码、切片）归 `b0.1-detailed-design.md`；
   其实施切片无「入口切换」片——integration owner 作用于切换日。

## 触碰的不变量

- **参数构建期一次消解**：本决策是它在前端层的投影——解析一次、结构单源，
  两条 apply 路径（自然播放 / seek 重放）未来消费同一份 IR 产物（canonical §5.1）。
- **parser / runtime 分层**：syntax parser 不查 registry、不 import runtime manager；
  family 归语义层（canonical 附录 A）。守护：`pnpm core:check` + import 方向静态检查（canonical §6.3 纪律二）。
- **core / UI 边界**：新模块属 `packages/core`，不 import Vue/Pinia/Monaco/TextMate/Pixi/editor panels。
- **record/replay + seek 幂等**：不触碰（canonical §0 不可蔓延边界）。
- **golden 语料哲学**：golden 是证据库不是保险丝（test-net-design-2026-07）；
  本决策把该哲学推进到底——旧 golden 守旧世界到切换日，新世界自建基线。

## 与 house style 的关系

- **Construction over runtime-dedup**：所有权在构建期确立（新 parser 独占目标语法解析），
  不在运行时做双表示去重/分流——与候选 ADR 同一立场，只是把「构建期」的边界从
  adapter 单点前移到整个交付模型。
- **单一实现纪律**：字面量语言一个 LiteralParser（链参数与正文 `|(...)` 共享），
  与「scene.clear 单路径」「诊断单总线」同族。
- **显式有序阶段先于魔法函数**：StyleWritePort 先例（处方 6 收口形态）在语义层的平行应用——
  前端各层契约一次设计完（canonical 附录 A），后建层不许倒逼先建层改接口。

## 可逆性

新 parser 完全可弃：删除 `packages/core/src/parser/chainSyntax/` 与其 fixture，旧前端分毫未动，
回滚成本 = 一次 revert。不修改 `.kmd` 持久化格式、不新增公开协议、不冻结公共 AST API
（`@kmd/core` 保持 private，2026-08-10 决策延续）。若建造证据表明目标文法本身有缺陷，
按重开政策带证据回到 D1–D27（canonical §0）——本 ADR 锁的是交付模型，不是文法。

## 结果（归档时补写）

已采纳（2026-08-19）。gate-8 裁决回复发布于 PR #30；贡献者复述确认后 gate 8 置绿，
B0.1 按 `b0.1-detailed-design.md` §11 切片开工。PR #30 合入时，候选 ADR 与候选 B0/B0.1
文档须加 banner 标注「已被本决策收编」。
