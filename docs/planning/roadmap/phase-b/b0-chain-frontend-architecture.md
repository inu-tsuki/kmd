# B0 链前端架构

> 状态：候选定稿 / 待决策者评审
> 最近更新：2026-08-13
> 范围：B0.1–B0.4 共用的链语法前端边界；不定义 execution/runtime 行为
> 语言规范：[`../../../knowledge/language/design.md`](../../../knowledge/language/design.md) 与分章 D1–D27
> B0.1 细化：[`b0.1-chain-parser-design.md`](b0.1-chain-parser-design.md)
> 架构决策：[`../../../knowledge/decisions/2026-08-12-typed-chain-ast-legacy-projection.md`](../../../knowledge/decisions/2026-08-12-typed-chain-ast-legacy-projection.md)

## 1. 目标与边界

B0 要把当前“字符串拆分后立即生成 runtime 形状命令”的入口改成一个可持续演进的编译器前端：

```text
source slice
  -> chain syntax parser
  -> typed chain syntax AST
     | B0.1 compatibility branch
     -> LegacyCommandAdapter (typed value -> legacy command value)
     -> existing registry attachment / ScopeRouter / lowering
     -> legacy ParagraphIR / EffectConfig / LayoutInstruction
     -> existing CompatProjector (ParagraphIR -> runtime-shaped data)
     -> existing layout and playback runtime

     | B0.2+ durable branch (progressively replaces the compatibility branch)
     -> B0.x semantic lowerers
     -> document / paragraph semantic IR
```

核心边界：

- syntax AST 只回答“作者写了什么”，不查询 effect/layout/stage registry，不决定链头身份，也不决定命令作用域；
- semantic lowerer 回答“这段语法是什么意思”，按 B0.2–B0.4 分批启用 receiver、选择器、拍、从句、宏与对象；
- `LegacyCommandAdapter` 是 typed value 降为旧 command number/string/boolean 的唯一边界；
- 现有 `CompatProjector` 只把 `ParagraphIR` 投影为 runtime-shaped `tokens/globalEffects`，不得解析或降级 typed value；
- 现有 `EffectParams = Record<string, any>`、`f | dot | bare` 路由和 `ScopeRouter` 都是迁移目标，不得反向塑造耐久 AST。

B0.1 只替换链成员和字面量解析，保持已实现脚本的 runtime 行为；后续子包才开启新语义。

## 2. 前端分层

### 2.1 文档/段落结构层

现有 `KMDParser` / `KmdAstParser` 继续拥有 frontmatter、段落、正文、`@` 边界、block option 外壳、source line 与 inline marks。B0.1 不把 document control flow、围栏或选择器语义塞进链 parser。

`KmdAstParser.parseCommandChains()` 改为把 `@` 后的完整 command expression 切片和绝对 source range 交给链前端，不再预先按顶层空白拆链，也不再调用正则式 `parseEffectChain()`。slot/parallel separator 必须由同一个 root parser 产生，否则 root union 与长度不变量不可验证。

段落层还有三条必须与生产切换一起处理的入口：

- **block option command**：段落层只负责识别 `[...]`、按 quote/depth-aware 规则区分顶层 `key=value` 与 command expression；command 分支把完整 expression 和相对于原始行（含前导缩进）的 base offset 交给同一个链前端，不能继续先用 `splitTopLevel()` 拆成多个 `BlockOptionCommandAst.chain`；
- **inline pause**：正文 `|(value)` 不属于 chain root，但其参数属于 D24/D27 的同一 literal 语言。它必须调用同一个 `LiteralParser`，再由 `LegacyCommandAdapter` 的 value 适配入口生成现有 `PauseNodeAst.params`；不得保留 `parseParams()` 旁路；
- **comment boundary**：段落层可以拥有注释识别，但必须 quote-aware、escape-aware、depth-aware。`"a // b"` / `'a // b'` 中的 `//` 不能在链 parser 收到 source slice 前被截断；LSP 不得复制另一套 comment scanner。

段落层计算 range 时始终以 `originalLine` 为坐标系。`trim()` 只能用于判别，不得成为 source slice 或 offset 的来源；block option、命令正文和 inline pause 都必须保留绝对列偏移。

### 2.2 链语法层

链前端由三类职责组成：

1. `ChainSyntaxParser`：游标驱动的小型递归下降 parser，处理成员、括号、参数、后缀、连接符、从句和引用；
2. `LiteralParser`：产生 scalar 与 quantity 的 discriminated union，保留 `raw` 与 source range；
3. syntax diagnostics：只报告可由字符序列确定的错误，不查询 command registry。

首轮不引入 parser generator 或第三方依赖。语法规模小，递归下降与仓库现有 AST/source-range 工艺一致，错误恢复也能保持局部。

### 2.3 语义层

B0 的语义开闸顺序与 Phase B plan 对齐：

| 工作包 | 消费 syntax AST 后新增的语义 |
| --- | --- |
| B0.1 | 旧形态兼容投影；quantity 类型化；新结构只可观察、不可执行 |
| B0.2 | 链头 receiver 查找、`{}`/`{文本}` 选择器、点/域类型、失配与重名诊断 |
| B0.3 | 连接符/拍、从句、实例化粒度、并联句子、续行 |
| B1 | 表达式求值与两级作用域；为 B0.4 的 `$(expr)` 提供求值器 |
| B0.4 | 引用、宏、对象操作与围栏对象 |

parser 可以提前结构化尚未启用的语法，但不得猜测其执行语义。未启用结构进入 lowering 时产生明确的 `phase-b-feature-not-enabled` 诊断，并且不生成半成品 runtime 命令。

### 2.4 两级兼容边界

`LegacyCommandAdapter` 接收 typed syntax AST，只对当前已实现的语法子集输出 legacy command chain。它负责：

- 将 `f.`、裸 `.`、bare 形态投影为现有 prefix；
- 在 B0.2 接管 receiver 前，保持 `cam.move` 等历史复合命令名；
- 把 typed literal 降为现有 runtime 所期待的 number/string/boolean；
- 保留 `:bg`、`hold/ease` 单词形态等现阶段兼容形，不在 B0.1 偷渡迁移；
- 将 source range 与 syntax diagnostic 保留到统一 diagnostics collector。

兼容值合同不是“按 typed kind 直接转 JS 类型”，而是显式保留旧输入行为：

- `StringLiteralAst` 同时保存 decoded `value` 与含引号的 `raw`。B0.1 compatibility branch 用 `raw.slice(1, -1)` 产生 legacy string，逐字复刻当前只去首尾引号、不解码 escape 的行为；B0.2+ semantic branch 才消费 decoded `value`；
- `NumberLiteralAst` 可以按新 grammar 识别 `+1`、`.5`、`1e3`，但节点还必须保留 raw/provenance。无单位 number 只有 raw 满足旧 `^-?\d+(\.\d+)?$` 时才投影为 number；其余仍投影原始字符串。time quantity 的 legacy 分支按当前 `parseFloat(raw)` + `s/ms` suffix 顺序复刻指数数值：`1e3s → 1000`、`1e3ms → 1`、`1E-2s → 0.01`、`1E-2ms → 0.00001`；typed node 仍保留规范 number/unit/raw 供后续 semantic branch；
- `1ss`、`1mss` 等形似 quantity 的 malformed 输入不复刻当前 `parseFloat` + suffix 偶然吞入的结果。它们产生 `chain-invalid-quantity`，不投影 runtime；这是 B0.1 明文允许的非法输入收紧，不属于“已实现合法脚本零变化”。

`LegacyCommandAdapter` 的 `adaptValue()`（名字可等价调整）是 typed value → legacy runtime value 的唯一实现，chain argument 与 inline pause 共用它。frontmatter 和 block-option `key=value` 尚不产生 typed syntax node；它们迁到一个明确命名的 legacy scalar coercion helper，保持当前读取语义，但该 helper 不得被 chain/inline typed 路径调用，也不得被 B1/B0.3 当作 quantity semantic parser。

之后，现有 `CompatProjector` 接收 `ParagraphAst + ParagraphIR`，只复制/整理 runtime 所需的 `KMDParagraphData.tokens/globalEffects`。它不接触 typed AST，不做单位转换，也不是 typed value 降级点。

adapter 与 projector 都不得修改输入，也不得形成第二套解析器。旧 `KMDCommandParser` 在过渡期只能是调用新 parser + adapter 的 façade，不能保留正则分支作为 fallback。

### 2.5 结构化诊断与公开兼容面

syntax parser 返回的 code/severity/range 必须一路保留到 parser 与 LSP，不能在 `KMDParser.validate()` 降成 `{ message, line }` 后再由 LSP 扫消息文本和源码猜位置。B0.1 增加结构化 validation 入口（名称可为 `validateDetailed()` 或等价 API），直接返回 `ParserDiagnostic`；旧 `validate()` 保留为 compatibility façade，只做 1-based `{ message, line }` 投影。

诊断收集与 runtime payload 是否为空解耦。command-only、block-option-only、恢复节点或 `phase-b-feature-not-enabled` 即使没有生成 token/globalEffect，其 diagnostics 仍进入 `KMDParseResult.diagnostics`；不得因 paragraph 未进入 runtime-shaped `paragraphs` 数组而丢失。LSP 直接消费结构化入口，不再维护 unknown-command/message/comment/range 的影子 parser。

typed AST 仍可保存在 `KMDParagraphData.ast`，但读取边界如下：

- `ParserAstTransform`、formatter、diagnostics、golden/tooling 可以读取完整 typed syntax；
- lowering 只能通过 `LegacyCommandAdapter` 获得 legacy command value；
- `SegmentBuilder` 等现有 runtime 代码若为 source-line anchor 读取 `ast`，只允许读取 line/kind/range 等定位字段，不得从 typed argument/value 重新构建 runtime 参数；
- compatibility serializer 只用于测试比较，不回流 production parser/lowering，也不成为第二事实源。

## 3. 耐久 AST 骨架

下列形状描述边界，不要求最终 TypeScript 名字逐字一致；discriminant、raw 与 range 是承重字段。

```ts
interface ChainExpressionSyntaxAst extends SourceNode {
  type: 'chain-expression';
  elements: ChainExpressionElementSyntaxAst[];
  separators: ChainExpressionSeparatorSyntaxAst[];
}

type ChainExpressionElementSyntaxAst =
  | ChainSentenceSyntaxAst
  | LegacyCommandChainSyntaxAst;

type ChainExpressionSeparatorSyntaxAst =
  | SlotSeparatorSyntaxAst
  | ParallelSeparatorSyntaxAst;

interface SlotSeparatorSyntaxAst extends SourceNode {
  type: 'chain-expression-separator';
  kind: 'slot';
}

interface ParallelSeparatorSyntaxAst extends SourceNode {
  type: 'chain-expression-separator';
  kind: 'parallel';
}

// Transitional B0.1 element for production slices without the normative
// subject + '.' + predicate shape. It is adapted, never lowered as a new-
// language sentence.
interface LegacyCommandChainSyntaxAst extends SourceNode {
  type: 'legacy-command-chain';
  sourceForm: 'bare';
  members: CommandMemberSyntaxAst[];
}

interface ChainSentenceSyntaxAst extends SourceNode {
  type: 'chain-sentence';
  subject: SubjectSyntaxAst;
  predicate: ChainPredicateSyntaxAst;
  compatSourceForm?: 'legacy-bare-dot-chain';
}

type SubjectSyntaxAst =
  | IdentifierSubjectSyntaxAst
  | SelectorSubjectSyntaxAst
  | LegacySubjectSyntaxAst;

interface IdentifierSubjectSyntaxAst extends SourceNode {
  type: 'subject';
  form: 'identifier';
  identifier: IdentifierSyntaxAst;
}

interface SelectorSubjectSyntaxAst extends SourceNode {
  type: 'subject';
  form: 'selector';
  selector: 'sequential' | 'content';
  content?: string;
}

interface LegacySubjectSyntaxAst extends SourceNode {
  type: 'subject';
  form: 'legacy-f' | 'implicit-dot';
}

interface ChainPredicateSyntaxAst extends SourceNode {
  type: 'chain-predicate';
  beats: ChainBeatSyntaxAst[];
  connectors: ChainConnectorSyntaxAst[];
}

interface ChainBeatSyntaxAst extends SourceNode {
  type: 'chain-beat';
  members: ChainMemberSyntaxAst[];
}

type ChainMemberSyntaxAst =
  | CommandMemberSyntaxAst
  | SubclauseSyntaxAst
  | ReferenceSyntaxAst;

interface CommandMemberSyntaxAst extends SourceNode {
  type: 'command-member';
  name: IdentifierSyntaxAst;
  operation?: 'append' | 'remove';
  granularity?: GranularitySyntaxAst;
  legacySuffix?: LegacyCompatibilitySuffixAst;
  arguments: ArgumentSyntaxAst[];
  blocking: boolean;
}

interface GranularitySyntaxAst extends SourceNode {
  type: 'granularity';
  unit: 'char' | 'group' | 'block';
}

interface LegacyCompatibilitySuffixAst extends SourceNode {
  type: 'legacy-compatibility-suffix';
  name: 'bg';
}

interface ArgumentSyntaxAst extends SourceNode {
  type: 'argument';
  name?: IdentifierSyntaxAst;
  value: ValueSyntaxAst;
}

interface SourceNode {
  raw: string;
  range: SourceRange;
}
```

约束：

- range 使用半开区间 `[start, end)`，相对其所属源码行；line 继续由父行节点承载，避免每个子节点重复绝对行号；
- `raw` 必须逐字保留，用于诊断、格式化和 compat 投影，不能由解析后的数值反推；
- `elements.length === separators.length + 1`；separator range 精确覆盖顶层空白或 `+`，`slot` / `parallel` 不得只靠 raw 反推；
- `predicate.beats.length === predicate.connectors.length + 1`；错误恢复节点不进入正常成员数组；
- `SubjectSyntaxAst` 只保留句法位置与源码形态，不代表名字已通过作用域链解析。identifier 是用户对象、内建主语还是未知名，由 B0.2 裁决；
- `legacy-f` / `implicit-dot` 是兼容源码形态，不是新语言的内建 receiver；
- 规范 granularity 只有 `char/group/block`。`:bg` 单列为 transitional suffix，B0.2 迁成 `bg` 主语后删除。

## 4. 语法总览

EBNF 中空白和注释由段落层处理；`IDENT`、数字、字符串和 source escape 的精确定义在 B0.1 设计中给出。

```ebnf
chain-expression = chain-element, { sentence-separator, chain-element } ;
chain-element    = sentence | legacy-command-chain ;
sentence         = subject, ".", predicate ;
subject          = IDENT | selector | legacy-subject ;
selector         = "{", [ selector-content ], "}" ;
legacy-subject   = "f" | implicit-subject ;
implicit-subject = /* zero-width subject before leading dot */ ;
predicate        = beat, { connector, beat } ;
beat             = member, { ".", member } ;
member           = command-member | subclause | reference ;
command-member   = [ member-operation ], IDENT,
                   [ granularity | legacy-bg-suffix ], [ arguments ], [ "!" ] ;
member-operation = "+" | "-" ;
granularity      = ":", ( "char" | "group" | "block" ) ;
legacy-bg-suffix = ":bg" ;
arguments        = "(", [ argument, { ",", argument } ], ")" ;
argument         = [ IDENT, "=" ], value ;
subclause        = "(", sentence, ")", [ granularity ], [ "!" ] ;
reference        = "$", ( IDENT | "(", expression-slice, ")" ) ;
connector        = "-", duration, "->"
                 | "~", duration, [ ",", IDENT ], "~>" ;
sentence-separator = top-level-whitespace | "+" ;
legacy-command-chain = legacy-command-member,
                       { ".", legacy-command-member } ;
legacy-command-member = command-member ;
```

这是耐久主谓句语法。syntax parser 不查 registry，但可以按形状识别 subject：元素以不带参数/粒度/阻塞/操作符的纯 `IDENT` 后接 `.` 开头时，产生 `ChainSentenceSyntaxAst`。因此 `cam.zoom(1)`、`red.bold` 进入耐久 sentence，并附 `compatSourceForm: 'legacy-bare-dot-chain'`，让 `LegacyCommandAdapter` 在 B0.1 保持旧 namespace fold 或多命令投影。`goto(p).rainbow` 的首 member 带参数，不满足 subject delimiter；它与 `left(1self)` 进入可容纳一到多个 member 的 transitional `LegacyCommandChainSyntaxAst`。B0.2 语义开闸后删除兼容 provenance，不重写 sentence 形状。

`top-level-whitespace` 与 `+` 分别产生 `SlotSeparatorSyntaxAst` 和 `ParallelSeparatorSyntaxAst`。二者在 root 上可达，必须满足 `elements.length === separators.length + 1`；并联 execution 留到 B0.3。connector 周围空白是 trivia，不切 element。

## 5. Quantity 与值节点

`ValueSyntaxAst` 至少覆盖：

```ts
type ValueSyntaxAst =
  | NumberLiteralAst
  | BooleanLiteralAst
  | StringLiteralAst
  | IdentifierValueAst
  | QuantityLiteralAst
  | OpaqueExpressionAst;

type QuantityLiteralAst =
  | TimeQuantityAst
  | SpaceQuantityAst
  | AngleQuantityAst
  | RateQuantityAst
  | RelativeQuantityAst
  | RangeQuantityAst
  | EventQuantityAst;
```

Quantity 分类与兼容映射由 B0.1 设计的表格约束。AST 保留单位，不能像当前 `autoConvert()` 一样把 `500ms` 直接折成 `0.5` 后丢失来源。

## 6. 诊断 ownership

| 层 | 拥有的诊断 | 明确不拥有 |
| --- | --- | --- |
| 段落 parser | `@`/正文边界、block option、inline group、行范围 | command 名是否合法、quantity 含义 |
| 链 syntax parser | 未闭合括号/字符串、空成员、非法后缀、非法 quantity、尾随字符 | unknown command、receiver 身份、跨 registry 重名 |
| B0.1 `LegacyCommandAdapter` | 新结构尚未启用、旧形态无法无损适配 | D17 选择器失配、D21 命名冲突 |
| B0.2 semantic lowerer | receiver/selector 查找、点域类型、失配、重名、弃用形态 | 连接符 runtime 时序 |
| B0.3/B0.4 lowerer | 拍/从句/并联、引用/宏/对象的语义错误 | parser 字符级错误 |
| registry adapter | unknown command 与 command metadata | 字符串解析 |

所有诊断进入现有 collector；不得新增 `console.log` 或第二条错误总线。syntax parser 使用稳定 code 和精确 range，消息文本可迭代，code 作为测试锚点。

## 7. 耐久边界与过渡边界

### 7.1 耐久资产

- 递归下降 parser 与 depth/quote-aware cursor；
- typed syntax AST、quantity discriminated union、source range 与 raw spelling；
- B0.1 的 syntax → `LegacyCommandAdapter` → 旧 lowering → ParagraphIR → `CompatProjector` 单向兼容支路；
- B0.2+ 的 syntax → semantic lowerer → durable semantic IR 单向耐久支路；后者按工作包逐步替换前者，不与前者形成两个 production 真相源；
- syntax diagnostics code 与 recovery 规则；
- 无 registry、UI、Pinia、Pixi、GSAP 依赖的 parser 核心。

### 7.2 过渡资产与偿还点

| 过渡资产 | 最晚偿还点 |
| --- | --- |
| `legacy-f` / `implicit-dot` / `bare` 投影 | B0.2 接管 receiver 与 selector 后，缩成只处理弃用形态的 compat adapter |
| `cam.*` 历史复合名折叠 | B0.3 从句语义启用并完成语料迁移时 |
| `LegacyCompatibilitySuffixAst(:bg)` | B0.2 引入 `bg` 主语时；不得进入规范 granularity union |
| `EffectParams = Record<string, any>` | B1 参数表达式与 semantic value resolver 接管时开始收紧；B5 前不得继续扩张 |
| `LegacyCommandChain` / `ScopeRouter` | B0.2 起逐步由 semantic IR 取代；B0 完成后不再接收新语法节点 |
| `KMDCommandParser` façade | B0.1 完成时不得含旧正则；B0 完成后删除或移入 compat module |
| 兼容 AST golden 视图 | B0 完成且新 syntax/semantic golden 覆盖齐全后复核移除 |

### 7.3 B0.1 production entry inventory

| 入口/消费者 | B0.1 责任 | 生产切换验收 |
| --- | --- | --- |
| `AstParser.parseCommandChains()` | 完整 source slice → root syntax expression | 不再预拆顶层空白，不调用旧 regex |
| `AstParser.parseBlockOptions()` | 外层 value/command 判别、原始行 offset；command 交同一 root parser | command root 可保 slot/parallel；缩进 range 正确 |
| `AstParser.parseInline()` | `|(...)` 调同一 literal + value adapter | `|(click)` 有 event AST/diagnostic，legacy pause 行为保持 |
| comment/`@` boundary | quote/escape/depth-aware source slicing | 引号内 `//` 与 `@` 不误切，core/LSP 不复制 scanner |
| `types.ts` / AST transforms | paragraph line/block option 改存 typed root；transform 消费 typed AST | typed node 不塞进 legacy `EffectParams` |
| `lowering.ts` / `ScopeRouter.ts` | 只接 adapter 输出的 legacy chain | ScopeRouter 不读 typed value |
| `KMDCommandParser.ts` / non-chain scalar helper | 删除 regex/独立参数 split；保留或抽出 frontmatter/value legacy coercion | `parseInstruction()` 零调用则删除；无旧 parser fallback |
| `Parser.ts` / LSP | 结构化 validation、空 payload 诊断保留 | LSP 直接使用 code/severity/range |
| `CompatProjector.ts` / `SegmentBuilder.ts` | projector 不降级 typed value；runtime 只读 AST 定位字段 | runtime 不反读 typed params |
| parser golden/test scripts | compat view 与 typed evidence 分流，并接入门禁 | 新 suite 纳入 `test:parser`，旧 golden 非预期零 diff |

这些边界不承诺对外 API。`@kmd/core` 在 Phase B 仍是 private workspace package。

## 8. 与 B0.2 的硬边界

B0.1 不得：

- 让 `{}` / `{文本}` 选择器产生 runtime 目标；
- 用统一作用域链替换 `ScopeRouter` 的 `f | dot | bare` 分流；
- 改变链数与正文括号组数失配时的 first/last 现状；
- 开启 D17/D21 诊断、内容选择器模糊匹配或跨 registry 重名检查；
- 将裸排版链改写为裸点；
- 把 `:bg` 改写成 `bg` 主语；
- 执行连接符、拍、从句、引用或并联句子；
- 修改 layout/playback/stage 的参数消费约定。

B0.1 只保证 B0.2 能消费清晰的 member/value/source 节点，而无需再次重写字符级 parser。

## 9. 架构验收

进入 B0.1 编码前，决策者需确认：

1. typed syntax AST 是唯一语法事实源；
2. legacy command value 只能从 `LegacyCommandAdapter` 生成；现有 `CompatProjector` 不得承担 typed value 降级；
3. 旧语料的 compat golden 零变化，新 typed AST 用独立聚焦测试证明；
4. 未启用的新语法不获得半成品 runtime 行为；
5. B0.2 边界和过渡资产偿还点明确；
6. 不新增依赖、全局状态、第二 parser 或 runtime feature flag。
7. string 同时保存 decoded/raw，B0.1 compatibility 明确使用 `raw.slice(1,-1)`；NUMBER/time quantity 依据 raw/provenance 复刻旧 coercion；
8. `1ss` 等 malformed 偶然容忍被明确作为非法输入收紧，不冒充合法 corpus 行为中立；
9. top-level、block option、inline pause、quote-aware comment/`@` 和未 trim range 在同一 production switch 闭合；
10. structured diagnostics 直接到达 LSP，无 runtime payload 的 command-only/recovery 诊断仍保留；
11. frontmatter/block-option value 的 legacy scalar helper 与 typed command/inline value adapter 分离；
12. typed `paragraph.ast` 供 frontend/tooling，runtime 只读取定位字段，不反建参数；
13. S1–S3 的依赖/并行边界、S4 单一 integration owner、S5 evidence owner 与完整门禁已确认；
14. 三个新增 parser suites 明文接入 `pnpm test:parser`。
