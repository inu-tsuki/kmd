# 提案：以 typed chain syntax AST 和 LegacyCommandAdapter 双表示实施 B0.1

- 日期：2026-08-12
- 状态：提案中
- 关联计划：[`../../planning/roadmap/phase-b/b0-chain-frontend-architecture.md`](../../planning/roadmap/phase-b/b0-chain-frontend-architecture.md)、[`../../planning/roadmap/phase-b/b0.1-chain-parser-design.md`](../../planning/roadmap/phase-b/b0.1-chain-parser-design.md)

## 回应的力

B0.1 同时要求两件表面上冲突的事：

1. D24 要求 `1s`、`0.5line`、`15deg`、`+=0.1`、值域等成为类型化 quantity，不能继续退化为 number/string；
2. B0.1 又是行为中立包，现有 layout/effect/stage/playback 仍大量直接把 `EffectParams` 当 number/string 消费，parser corpus golden 也要求旧行为零变化。

若把 quantity object 直接写进现有 `EffectConfig.params`，`Number(params.x)`、`params.duration || 0.5`、GSAP 参数和 RuntimeValueResolver 会立刻看到不同类型；若继续只保存旧 number/string，B1/B0.3 又必须重新解析字符串，D24 形同未落实。

因此必须在 parser 与 runtime 之间明确区分“作者写下的类型化语法”与“迁移期 runtime 需要的旧值”。

## 方案对比

### 方案 A：直接把 typed quantity 塞入现有 EffectParams（最简可行）

做法：修改 `autoConvert()`，让它返回 quantity object；沿用当前 `ParsedCommand -> ScopeRouter -> EffectConfig` 路径。

代价 / 局限：

- typed value 会扩散到所有 effect/layout/stage/player consumer；
- B0.1 被迫同时修改 runtime，无法再证明行为中立；
- 各 consumer 很可能各写一份 coercion，形成多套单位语义；
- natural playback 与 seek/replay 可能在不同路径重复转换，违背参数构建期一次消解原则。

### 方案 B：typed syntax AST + 单一 LegacyCommandAdapter（推荐）

做法：递归下降 parser 产出带 raw/range 的 typed syntax AST；`LegacyCommandAdapter` 在唯一边界把 typed value 降为当前 legacy command 所需的 number/string/boolean。后续 semantic lowerer 直接消费 typed AST，逐步替代 adapter。现有 `CompatProjector` 仍只做 ParagraphIR → runtime-shaped data。

代价 / 局限：

- Phase B 期间会同时存在耐久 syntax 表示与过渡 runtime 表示；
- 测试必须区分 syntax 正确性与 compatibility 行为，不能只看一套 golden；
- adapter 的偿还点必须跟 B0.2/B0.3/B1/B5 绑定，不能永久化。

为什么最简方案不够用：方案 A 把一次 frontend 重构扩大为 parser + layout + effects + stage + playback 的同步迁移，既失去行为中立证据，也会让 runtime consumer 反向定义语言字面量。单一 command adapter 是隔离迁移浪潮、保留 typed 工艺资产的必要边界，不是为旧脚本建立永久兼容包袱。

## 决策

采用方案 B，并增加以下约束：

1. typed syntax AST 是链语法的唯一事实源；旧 `ParsedCommand` / `EffectParams` 只能由 `LegacyCommandAdapter` 生成；
2. 生产路径不得同时保留正则 parser 与递归下降 parser，不引入 runtime feature flag；
3. `LegacyCommandAdapter` 只覆盖当前已实现的旧语法；尚未启用的新结构保留 AST、给出诊断，不产生半成品 runtime 行为；
4. 现有 parser golden 比较 adapter 生成的 compatibility view，要求旧文件零 diff；typed AST 另由聚焦测试/golden 覆盖；
5. B1/B0.3 的 semantic lowerer 直接消费 typed node，禁止重新解析 adapter 输出的字符串；
6. `@kmd/core` 仍为 private，此决定不构成公共 AST API 或文件格式稳定承诺。

采纳方案 B 还必须同时采纳下列兼容与入口裁决；否则 gate #8 不应置绿：

7. string syntax node 同时保存 decoded `value` 与含引号 `raw`；B0.1 adapter 用 `raw.slice(1, -1)` 精确复刻当前只去引号、不解码 escape 的 legacy 行为，后续 semantic lowerer 才消费 decoded value；
8. NUMBER syntax 可以识别规范合法的 `+1`、`.5`、`1e3`，但 B0.1 adapter 依据 raw/provenance 复刻旧 coercion：无单位的 `1/-1/0.5/-0.5` 投影 number，前述宽语法写法仍投影 raw string；time quantity 复刻当前 `parseFloat(raw)` + suffix 数值，例如 `1e3s → 1000`、`1e3ms → 1`、`1E-2s → 0.01`、`1E-2ms → 0.00001`；
9. `1ss` 等形似 quantity 的 malformed 输入产生稳定 diagnostic 且不投影 runtime。这是对旧 `parseFloat`/substring 偶然容忍的明文收紧，不计入合法旧 corpus 的“行为中立”；其他合法输入变化仍需单独批准；
10. top-level command、block-option command、inline `|(...)`、quote-aware comment/`@` boundary 与未 trim 原始行 range 必须在同一次 production switch 闭合；inline pause 与 command argument 共用同一个 `LiteralParser`/value adapter；
11. parser 提供保留 code/severity/range 的结构化 validation；LSP 直接消费它。command-only、block-option-only、recovery 或未启用语法即使没有 runtime payload，diagnostics 也不得被丢弃；
12. frontmatter 与 block-option `key=value` 暂时使用独立的 legacy scalar coercion helper；该 helper 不得成为 typed chain/inline pause 的第二条降级路径；
13. typed AST 可以保存在 `KMDParagraphData.ast` 供 transforms/diagnostics/formatter/golden/source-anchor tooling 使用；lowering/runtime 不得从 typed value 反建参数，compatibility serializer 不得回流 production；
14. 新增 literal/chain/adapter suites 必须显式接入 `pnpm test:parser`，不能只依赖完整 `pnpm test` 偶然发现。

耐久 sentence AST 必须显式分成 `SubjectSyntaxAst + ChainPredicateSyntaxAst`：subject 只保句法位置和 identifier/selector/legacy-f/implicit-dot 源码形态，B0.2 才通过作用域链赋予 receiver 语义。syntax parser 可以按形状识别“不带参数/后缀/操作符的纯 `IDENT` + `.`”主语，因此 `cam.zoom`、`red.bold` 直接产生耐久 sentence，并附 compatibility provenance 维持 B0.1 旧投影；`goto(p).rainbow` 的首 member 带参数，与无点的 `left(1self)` 一样进入可容纳多 member 的 transitional `LegacyCommandChainSyntaxAst`。root 是 `ChainSentenceSyntaxAst | LegacyCommandChainSyntaxAst` element union，并显式保存 `slot | parallel` separator，满足 `elements.length === separators.length + 1`。规范 granularity 只含 `char/group/block`；`:bg` 只能是 legacy compatibility suffix，并在 B0.2 迁为 `bg` 主语。Quantity AST 保留带符号单位值，range endpoint 允许 identifier/expression slice，避免前端类型提前封死后续语义。

## 触碰的不变量

- **参数构建期一次消解**：typed value 到 legacy command value 只有一个 `LegacyCommandAdapter`；natural playback 和 seek/replay 继续消费同一 adapted record。
- **parser / runtime 分层**：syntax parser 不查询 registry、不导入 runtime manager；semantic/compat adapter 才接 registry 与 ScopeRouter。
- **core / UI 边界**：新增 parser 模块不得导入 Vue、Pinia、Monaco、TextMate、Pixi 或 editor panels；由 `pnpm core:check` 守护。
- **已有 runtime 行为**：旧 corpus 的 ParagraphIR、tokens、effects、layout instructions 与 playback 不变；由 parser golden、完整 `pnpm test` 和关键 fixture 人工回归守护。
- **diagnostics 单总线**：syntax diagnostics 进入现有 collector，不增加 `console.log` 或旁路 sink。
- **source 可追溯性**：所有 syntax node 保留 raw 与半开 source range；聚焦 range/property tests 守护。
- **诊断可达性**：diagnostics 的聚合不以 runtime paragraph 是否有 token/globalEffect 为条件；结构化 code/range 直接到达 LSP。
- **AST 暴露不等于 runtime 合同**：`paragraph.ast` 的 typed value 面向 frontend/tooling；runtime 仅可读取 line/kind/range 等定位信息。

若现有测试无法证明 typed node 没有泄漏到 runtime，B0.1 必须补 adapter contract tests，不能以类型断言代替运行证据。

## 与 house style 的关系

本决定沿用仓库已有模式：

- `AstParser -> LegacyCommandAdapter -> lowering -> ParagraphIR -> CompatProjector` 的单向编译管线；
- reader/runtime host adapter 所采用的“耐久核心 + 边界适配器”；
- private `@kmd/core` 内部 API 可变，但物理依赖边界受门禁守护；
- construction over runtime-dedup：转换所有权在构建期确立，不在各 runtime consumer 处重复猜测。

不新增依赖、全局状态或第二条执行路径。所谓“双表示”是前后相邻的编译阶段，不是两个可独立修改的真相源。

## 可逆性

本决定不修改 `.kmd` 持久化格式、不新增公开协议、不发布公共 AST API。实现按 types/cursor/literal parser、chain parser、adapter、生产入口切换、证据收口分片：前三片可在不触碰现有入口时独立撤销；chain parser 与 adapter 只在共享 types 冻结后并行。production switch 由单一 integration owner 同时处理 top-level、block option、inline pause、comment/range、structured diagnostics/LSP 和 legacy helper 边界；若出现非预期合法 corpus golden/runtime diff，整体 revert 即恢复旧 parser。

不允许用长期 feature flag 在生产中保留双 parser。回滚是 Git revert，不是运行时分流。`LegacyCommandAdapter` 的移除按 B0.2/B0.3/B1/B5 的偿还表执行；现有 `CompatProjector` 不属于这项偿还。若 Phase B 设计改变，可替换 semantic lowerer，而 typed raw/range AST 仍可复用。

## 结果（归档时补写）

待决策者评审。采纳后记录评审日期、B0.1 PR/commit、compat golden 结果、typed AST suite 与 `LegacyCommandAdapter` 实际偿还进度。
