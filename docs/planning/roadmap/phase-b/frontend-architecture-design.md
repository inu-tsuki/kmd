# Phase B 前端架构设计（B0–B2：source → DocumentSemanticIR → 引擎接缝）

> 状态：设计完成 / 待实施评审（2026-08）
> 取代并吞并 `b0-chain-frontend-design.md`（2026-08-19 升级）
> 上游：`docs/knowledge/language/design.md`（五公理 + 封盘决议 D1–D27）及分章
> （`chain-model.md` / `selection-model.md` / `scope-and-lifetime.md` / `control-flow.md`）
> 平级：`1.6-phase-b-plan.md` 管"做什么/什么顺序"；**与本文冲突处以本文为准**（冲突点已在该文件标注）。
> B3/B4 运行时形态归 `segment-graph-runtime-draft.md`；本文只定义交给它们的契约。
> 引用决议用 D 编号；旧→新对照见 `migration.md`。

---

## 0. 设计姿态

本项目处于实验期（见 `CLAUDE.md` Working Stance）：**摆脱兼容包袱，保留工艺资产。**
本文按 **"并行建造 + 一次性切换"** 设计。推论四条：

1. 新 AST 面向 D1–D27 **全量**语法，不被旧 `EffectConfig[]` 形状反向约束。
2. **"迁移"概念作废**：没有用户就没有搬迁。旧前端冻结不改、继续服务编辑器；
   新前端在自己的模块空间建造；建成之日一次性切换，旧前端整体删除。
   不存在兼容投影、过渡桥、弃用期。
3. 旧语料不在建造期分批改写；**切换日一口气重写**，该重写本身是**新语言的完备性审计**（§7）。
4. golden 语料（40 parser + 1 layout 快照、331 playback 用例）是**证据库 / 参照系**，
   不是"不许裂的保险丝"；切换后由新语料重建基线。

一条政策：**实现摩擦与设计摩擦是重开封盘决议的合法证据。** D1–D27 是在实现证据缺席下作出的裁决；
落地中发现某条决议与实现结构持续冲突、或造成表达力缺口时，带具体证据重开审议。
重开日志（截至 2026-08-19，四实例）：

| # | 实例 | 证据 | 落点 |
| --- | --- | --- | --- |
| 1 | `+` 并联句缓发 | 唯一生态位（无公共宿主多主语零刻齐发）无使用证据 | §2.1，去留交叙事验证 |
| 2 | 贝塞尔参数去括号 | 四数唯一定位曲线，`cubicBezier(...)` 括号层冗余 | §2.5.1 |
| 3 | `bg` 移回主语 | 债 #9（`:bg` 混入粒度）与 D12 直接冲突 | §2.3 Granularity |
| 4 | `#` 纯结构化、不渲染 | 身份重载使"是否渲染"不可定义；违反公理 3 符号/单词不互串 | §4.4 |

两条不可蔓延的边界：record/replay + seek 幂等是运行时正确性地基，reader-runtime 边界是资产——
前端（source → AST → IR → 接缝）本就不碰它们；明确列出以防"大刀阔斧"误伤。

一条方法学记录：**整体设计先行，逐层下压修正。** B1 设计下压了 B0 的句类骨架（§2.3），
B2 下压出 ContentScanner 缺口（§2.4），IR/接缝设计下压了切换粒度（§7.2）。
这些修正全部发生在动工之前——它们是本策略有效的证据，不是设计不稳的证据。

## 1. 目标管线全景

```text
Source
  → DocumentParser              # 文档结构：行分类、段落切分、场景边界
      ├─ ContentScanner         # @ 左侧正文：marks / 括号组 / | 停顿 / ~ ^ 糖 / {=} 门禁
      └─ ChainParser            # @ 右侧句子：主语 . 谓语序列；递归下降
  → DocumentAST                 # 纯语法，逐节点 source range；不决定作用域、不求值
  → AstNormalizer               # 续行 \、空白归一、结构行归类
  → DocumentDependencyResolver  # 跨 .kmd 依赖（设计入口，首轮不 runtime 加载）
  → ScopeResolver / StateLowerer / ControlFlowLowerer / SemanticLowerer
  → DocumentSemanticIR          # resolved but not evaluated（§5.1）
  → EffectMiddleware / LayoutMiddleware / StageMiddleware（+ ChainTimingLowerer）
  → [lane 契约] → layout lane / effect lane / stage lane（既有引擎，入口按审计重建，§6）
  → ParagraphExecutionPlan → SegmentExecutionPlan
  → SegmentGraphPlan（B3）→ GraphPlaybackRuntime（B4）
```

- **B0–B2 的范围** = source → DocumentSemanticIR 的全部层，加 IR → 既有引擎的接缝。
  B3/B4 消费 IR 的场景边界与控制边种子，不在本设计范围内重建。
- `ScopeResolver` 取代现 `ScopeRouter` 的 `f|dot|bare` 三分法；`CompatProjector`、
  `RuntimeValueResolver`、`commandCatalog.getFamily` 的固定优先级不在目标管线内（死法见 §3.1/§3.2/§6.1）。
- **切片顺序**沿用 `1.6-phase-b-plan.md` §5（B0.1→B0.2→B0.3→B1→B0.4→B2）：
  `$()` 依赖求值器，故 B0.4 在 B1 之后。切片是建造节奏；切换是一次性的（§7）。

---

# Part I · B0 语法层

## 2.1 句子文法（落地基线）

```text
句子     := 主语 . 谓语序列
谓语序列 := 拍 (连接符 拍)*
拍       := 谓语成员+（同拍成员以 . 相连，拍首同时起跑）
谓语成员 := 指令名[:粒度][(参数)][!] | 从句 | 引用
从句     := .( 句子 )[:粒度][!]          # 递归回到"句子"
连接符   := -时长-> | ~时长[,曲线]~>      # 缓动曲线 = 命名预设名 | 贝塞尔四数（§2.5.1）
引用     := $名字 | $(表达式)             # 定界于 B0.1，求值于 B0.4/B1
量词字面量 := 时间 | 空间 | 角度 | 速率 | 相对(+=/-=) | 值域(~>) | 事件   # D24，类型化
```

多句子：B0 **只实现空白分隔**（各配各的选区槽位）。`+` 并联句暂不实现（重开实例 1）：
其唯一不可替代生态位是"无公共宿主的多主语零刻齐发"；先用从句 + 拍并发覆盖，
再由叙事验证 KMD 统计该场景实际频次，带证据决定升格为一等连接符或删除。

## 2.2 `@` 行的四种句类（B1/B0.4 下压的骨架修正）

`@` 行不只有主谓句。B0.4/B1 带来三种新句类，分类是纯语法的事（有无 `=`、左部形态、`+/-` 前缀），
耐久骨架一次留位，按切片实现：

| 句类 | 形态 | 语义落点 | 实现切片 |
| --- | --- | --- | --- |
| `Predicate` | 正文 @ 主语.谓语序列 | 本行正文怎么演 | B0.1 |
| `Definition` | `@ name = 链` | 场景级宏/对象（值/引用语义，D2） | B0.4 |
| `Assignment` | `@ var.x = 表达式`（裸名则场景级） | 状态写入（D19） | B1 |
| `MemberOp` | `@ effobj.+wave / -wave / +wave(params)` | 对象成员操作（D6） | B0.4 |

## 2.3 AST 节点家族（耐久资产）

> 设计纪律：每节点携带 `raw`（源面貌，供诊断/回显）与 `range`（供定位/折叠）；
> 语法层不越权做语义决定（family 分流、单位默认、求值都在其后）。

- `SentenceAst { kind, subject?, beats, range, raw }`（kind 见 §2.2；非 Predicate 句类的载荷形状随切片细化）
- `SubjectAst`：`SelectorSubject({}|{文本}|裸.|mark|prev|next)` | `BuiltinSubject(cam|flow|var|bg)` | `UserSubject(name)`
- `BeatAst { members[], connectorBefore?, range }`（首拍 `connectorBefore` 为空）
- `ConnectorAst { kind: "hold"|"ease", duration, easing?: EasingAst, range }`
- `EasingAst`：`Named(name)` | `Bezier(x1,y1,x2,y2)`（§2.5.1）
- `MemberAst`：`CommandMember` | `ClauseMember` | `ReferenceMember`
- `CommandMember { name, granularity?, args[], blocking, range }`（B0.1 无 `family` 字段——family 归语义层）
- `ClauseMember { sentence: SentenceAst, granularity?, blocking, range }` ← 递归
- `ReferenceMember { form: "name"|"expr", delimited: string, parsed?: <expr AST，B0.4 填>, range }`（§2.5.4）
- `Granularity { unit: "char"|"group"|"block", range }`（纯粒度，**不含 bg**——bg 是主语，债 #9 根除）
- `ArgAst { name?, value: LiteralAst, range }`
- `LiteralAst`：`Number` | `Time` | `Space` | `Angle` | `Rate` | `Relative(+=/-=)` | `Range(from,to,dur?,easing?)` | `Event` | `Bool` | `Str`
  - 裸数字产 `Number`（无单位），默认单位由语义层查 commandCatalog metadata 补（§5.3，已定）

## 2.4 解析器工艺：ChainParser + ContentScanner

**ChainParser（`@` 右侧）**

- **递归下降**：文法每个非终结符一个方法（`parseSentence / parsePredicateSeq / parseBeat /
  parseMember / parseClause / parseReference / parseArgs / parseLiteral`）。从句令
  `parseMember → parseClause → parseSentence` 递归，嵌套多深降多深，`[^)]*` 正则天花板自然消失，
  `NAMESPACE_CAM_DOT_` 占位符黑客当场删除。
- **Scannerless 游标**：`Cursor { pos, peek, next, expect, atEnd }`。KMD 词法语境敏感
  （`~` 在正文是 slow 糖、在参数是值域；`.` 在链头是裸主语、在链身是成员分隔、在 `.(...)` 是从句引导），
  故不做独立 tokenizer，由当前产生式决定如何读下一字符。
- **source range 逐节点记录**：D17 失配诊断、Monaco 折叠、inspector 的共同地基。
- **错误恢复（占位，B6 完善）**：出错时产 `ErrorNode` + diagnostic，跳过到下一 `.`/拍边界继续，
  不整链报废；doesNotUnderstand 风格建议留 B6。

**ContentScanner（`@` 左侧，B2 设计暴露的骨架缺口）**

B0 初版骨架只设计了链（`@` 右侧）；文档层设计展开后确认正文扫描是独立模块，与 ChainParser 平级：

- 扫描产物：`TextRun{content, marks}`、`BraceGroup`、`PauseCue(|)`、糖（`~`/`^`）、`ExprSpan({=})`。
- **`{=}` 门禁在扫描期执行**（D23）：正文裸括号组恒为文字（`{红绿灯}` 是字）；
  进入表达式必须写 `{=`，扫描器据 `{=` 前缀区分表达式括号与文字括号。
- Markdown 糖中 `**bold**`/`*italic*` 是行内 prose mark（文字恒渲染、mark 加样式，无身份重载），保留；
  `# heading` 糖的自动展开（heading→special）随旧前端死亡，`#` 的新身份见 §4.4。

## 2.5 已裁决的设计点

1. **缓动曲线（D8 落地）**：删去 `cubicBezier(...)` 括号层。连接符内 `~1s,x1,y1,x2,y2~>` 四数直连贝塞尔
   （x∈[0,1]，越界诊断；y 可越界以表达过冲/回弹）；`~1s,powerIn~>` 为命名预设，预设表 = "名字→四数"别名。
   解析分流：连接符岛内第一个 token 是数→Bezier，是名字→Named。
2. **值域 / 连接符同形**：非风险，结案。值域恒在参数括号内，连接符恒在拍间；视觉同形是
   "皆 tween 家族"的一致性体现（公理 3）。解析靠语境（括号内/外）区分，AST 固化为
   `Range` 字面量 vs `ConnectorAst` 两型。
3. **`+` 并联句**：B0 不实现（重开实例 1，见 §0 日志）。
4. **`$()` / 引用**：语义（求值器、展开、卫生时间轴）推迟 B0.4/B1；**定界不推迟**——B0.1 即须识别
   `$name` 与 `$(...)` 的平衡括号边界（否则 `foo.$(a?b:c).wave` 的 `.wave` 会错断），
   产 `ReferenceMember { delimited }`，内部表达式 B0.4 再结构化。
5. **裸 `+0.1` 相对义**：从未实现，无需"弃用"。B0.1 直接实现 `+=`/`-=`，裸 `+x` 恒为正数字面量。

## 2.6 B0.1 施工段（行为中立 = 不引入新语义，非"冻结旧行为"）

> 施工细则（文法 EBNF、节点形状、诊断码表、实施切片、打捞台账）见 `b0.1-detailed-design.md`；
> 交付模型裁决见 ADR `docs/knowledge/decisions/2026-08-19-b0-1-parallel-build-no-compat-projection.md`。

**做**：`ChainParser` 在自己的模块空间全量产出 §2.3 节点家族（含从句/连接符/值域/量词/引用定界）；
量词类型化（D24）。债 #1/#2/#7/#9 不是"修掉"而是**随旧 parser 在切换日整体死亡**——
新解析器结构上不需要占位符黑客与单正则，债自然消解。

**不做（划界）**：family 分流 / 主语作用域查找（→ B0.2）；失配·重名·弃用诊断开闸（→ B0.2）；
`StateStore` / 求值器（→ B1）；`$()` 求值与展开（→ B0.4）；控制流结构行解析（→ B2，
`ControlFlowLineAst` 的 `repeat/endrepeat` 陈旧关键词届时一并废止）。
**也不做与旧前端的任何接线**——建造期旧前端冻结服务编辑器，新前端只对自己的 fixture 负责。

**验收**：新语法（从句/连接符/值域/`+=`/引用定界）fixture 全绿；设计探针脚本（§7.1）能在新前端解析。
切换日验收统一见 §7.3。

---

# Part II · B1 语义层

## 3.1 作用域模块：作用域不是查找表，是区间索引

D20：场景级名字的生存域是**脚本文本上的一段区间**（定义处到所属场景 `---`）。
名字可见性是"脚本位置"的函数，不是嵌套深度的函数。推论：
**作用域系统的核心数据结构是构建期的区间索引，不是运行时哈希表。**

```text
DefinitionIndex（构建期收集，全静态）
  ScopeDefinition {
    name
    kind:  "macro" | "object" | "var"
    level: "scene" | "document"
    visibleFrom:  ScriptPosition      # 定义处（D20 区间起点）
    visibleUntil: ScriptPosition      # 场景级 = 所属 ---；文档级 = 文档末尾
    payload:  宏体 AST | 对象绑定 | 初始值表达式
  }
```

收集来源三处：围栏名（`:::name`）、`@ name = ...` 定义行、frontmatter `var:` 表（文档级初值声明糖，D19）。

```text
ScopeResolver.resolve(name, at):
  1. DefinitionIndex 中 level=scene 且 visibleFrom ≤ at < visibleUntil 的定义   ← 位置过滤
  2. DefinitionIndex 中 level=document 的定义（含 var.* 全限定访问）
  3. 内建主语固定集（cam / flow / var / bg）
  4. 四注册表查询（style / effect / layout / stage）
  任一级命中多个，或跨级撞名 → 诊断（D21 全局命名冲突律）
  链尾查无 → doesNotUnderstand 风格建议（B6）
```

两个自然产物：

- **悬空引用诊断是区间模型的免费赠品**：场景外引用场景级名字 = "名字存在但区间不覆盖使用点"的特例。
- **债 #5 在此死亡**：`commandCatalog.getFamily` 的 style→effect→layout→stage 固定优先级
  是对跨注册表重名的静默裁决；新模型第 4 级查到两个注册表 = 诊断错误。注册表本体（四个 manager）
  是引擎资产保留；固定优先级随旧前端死亡。

**与 B0.2 的关系**：B0.2 的主语解析是本模块的第一个消费者。切片上 B0.2 先建 DefinitionIndex + 链查找，
B1 在其上长 StateStore 与求值器——但**契约一次设计完**：后建的层不许倒逼先建层改接口。

## 3.2 StateStore：状态是折叠出来的，快照只是缓存

**现状收口**：变量目前住在 `layout.globalMarkers` 里伪装成 marker 坐标
（`RuntimeValueResolver` 正则匹配 `"var.x"` 后读 `marker.x`）——作用域与 marker 双真相、字符串类型化。
B1 无任何兼容装置：StateStore 成为变量唯一真相，marker 退回纯空间锚点，`RuntimeValueResolver` 整体退役。

**承重墙——两级作用域的不对称**：

| | 文档级 `var` | 场景级名字（围栏、`@ name = ...`） |
| --- | --- | --- |
| 本质 | **状态**：随播放累加变化 | **结构**：脚本位置的纯函数 |
| 回翻时 | 需要恢复值 → 要 snapshot | 不需要 snapshot → 区间重建（D20） |
| 住在 | StateStore（运行时载体） | DefinitionIndex（构建期产物） |

StateStore 不是"纯函数哲学"的例外，而是它的运行时执行器：值的真相是
"位置 p 处的值 = 从文档开头到 p 的所有赋值按序折叠"；StateStore 是折叠的当前累加器，
snapshot/restore 是折叠结果在段边界的缓存——与 stage/layout 状态的 Checkpoint 哲学完全同构。
因此 `Checkpoint` 加一个字段即完成接入：`Checkpoint { stage, layout, activeParagraphs, inFlightAnimations?, state? }`。

**值域决定（已定）**：标量（number / string / boolean）+ 点/域空间值（D14 访问器第一批）。
拒绝容器（list/dict）：Checkpoint.state 必须可序列化；叙事验证在望的场景（计数器/路线/好感度）标量全覆盖。
将来脚本真的需要容器，按重开政策带证据回来。

**赋值的执行**：`@ var.gold = var.gold + 5` 编译为
`AssignmentRecord { timePosition, sequence, target, expr（构建期编译绑定） }`——
与 `stageModifierRecords` 同模式，不入 timeline。原因写在 `Segment.ts` 注释里：
*tl.call seek 跨过不补触发*——GSAP 回调在 seek 跳过后不补执行，舞台 modifier 已经付过这笔学费。
seek = restore(entryCheckpoint.state) → 按 sequence 折叠 timePosition ≤ 目标的所有 record。

**确定性不变量（精确表述）**：**给定一条路径，状态是脚本位置的纯函数；路径本身是运行时数据。**
当前路径恰好也由条件决定（无用户交互分支；`click` 只决定 pause 何时结束，不决定值与分支），
但这是数据性质，不是架构可依赖的性质——Phase C 的 `signal:name` 会引入外部事件驱动值。
record/checkpoint 机制是路径无关的机器，走哪条路都对。
由此拒绝"构建期全量预折叠"方案：它用丢弃路径结构换确定性，而路径结构恰恰是 B2 的建造物
（编辑器需要全部未走过的分支作为结构：graph 可视化、折叠、边诊断），且构建期解释用户文档
要为无限循环设燃料上限。全量预折叠保留为未来**静态分析**入口（构建期预报"循环永不终止"类诊断），不是求值路径。

## 3.3 表达式求值器：一个求值器，五种宿主，三个求值时机

求值集合（极简）：字面量、变量、算术、比较、逻辑、`?:`。

```text
ExprAst = Literal | VarRef(path) | Binary(op,l,r) | Unary(op,e)
        | Cond { branches: {label?, payload}[], fallback? }
```

`Cond` 多态：**叶子 payload 的类型由宿主决定**（参数位 = 量词值，`{=}` = 文字，`$()` = 链片段，
`[if ->]` = 跳转目标）。求值器只决定"哪个分支/什么值"，宿主决定"值意味着什么"。

五个宿主的求值时机（B1 契约核心表）：

| 宿主 | 求值时机 | 产物 | 原因 |
| --- | --- | --- | --- |
| `$()` | 构建期（场景烘焙吻合） | 链片段原位拼接 | D4 明文 |
| `{=}` 正文变体 | 烘焙期（layout 之前） | 定死的正文文字 | 正文是 layout 输入 |
| `[if cond]` 段落有无 | 烘焙期 | 段落进不进时间轴 | 段落集合影响 layout |
| `[if cond ->]` / `->` | 播放到达边时（B3/B4） | 下一个 segment | 流向是运行时事件 |
| 链内参数位 | 构建期编译绑定 + 触发时刻取值入 record | 两条 apply 路径共享的值 | 见下 |

**参数位 = baseStrength 模式的一般化**：`Segment.ts` 的 `StageModifierRecord.baseStrength`
已验证"build 期解析变量进 record、seek 不重解析"（F-3）。B1 把它推广到一切引用状态的参数：
构建期解析"引用谁"（名字绑定、默认单位填充、类型检查），首次触发取得"值多少"并进 record，
seek 重放 record——**绝不拿已经变过的状态重算**。这是铁律"参数构建期一次消解，两条 apply 路径共享"
在状态世界的精确读法。

**`{=}` 必须烘焙期**：正文文字参与排版，排版是烘焙期一次性产物。场景内 `var.mood` 变化不改正文；
想要播放中变化的显示，走响应式对象通道（D6 成员操作）。**结构归烘焙，变化归链**——双钟分立在文本维度的延伸。

**烘焙的精确含义（接 §4.5）**：烘焙期求值 = **每次进入场景时求值**（循环重入时文档级 var 可能已变）。

## 3.4 B1 层契约产物

- **ScopeModule**：DefinitionIndex + ScopeResolver。消费者：B0.2 主语解析、`$name` 引用、表达式 VarRef。
- **StateStore**（+ Checkpoint.state、AssignmentRecord 折叠）。消费者：求值器各时机、graph runtime（B4 checkpoint）、inspector（B6 快照）。
- **ExprEvaluator**（+ 构建期 ArgumentResolver）。消费者：参数位、`{=}`、`[if]`、`$()`、赋值、B2 条件。
- 偿债随切换日死亡：`RuntimeValueResolver`、frontmatter variables → `layout.globalMarkers` 路径、
  `autoConvert` 的 `var.` 字符串直通特判。

---

# Part III · B2 结构层

## 4.1 为什么控制流必须住在文档层

**跳转的目标和它的条件住在不同的段落里，甚至不同的场景里。**`[if var.trust > 3 -> #真相]` 的条件在此处、
锚点在彼处；`-> #第二幕` 跨 `---`；循环回边跳到脚本序更早位置。任何小于文档的单位持有不了锚点索引和边集。

分层反转：旧世界 `parseParagraph` 是中心（`scene.clear` 至今是段落内的一种 inline token）；
新世界文档是中心，段落是文档的内容。DocumentParser 行分类 + 段落切分 + 场景边界，
ContentScanner 与 ChainParser 是它调用的内容解析器（§2.4）。

## 4.2 结构行归类契约

D26 结构行家族：`---`、`# name`、`:::name`、`[...]`、`-> #锚点`——"独占一行、管文档骨架"。契约三条：

1. **每行至多一种结构身份。**行分类前缀判定、优先级明确；一行要么是恰好一种结构行，要么是正文内容。
2. **结构层管识别与归位，内容层管内部解析。**`[...]` 载荷最重，内部拆三槽：
   段级选项（`key=value`，可多个）、段首句子（任意主谓句含省略主语的 `.glitch`）、
   条件路由（`if cond -> #a | else -> #b`）。DocumentParser 认行拆槽，槽内交给各自解析器。
3. **纯路由行排斥其他槽位。**`[if cond -> #a | ...]` 独占一行时不修饰段落，编译为 graph 条件边；
   路由行混段级选项 = 诊断。理由：每个语法位置只承载一种语义强度——路由管"去哪"，选项管"怎么演"。

## 4.3 三高度 if：一个词汇，三个宿主层

三高度不只是三种语义，它们天然落在前端三个不同层上：

| 高度 | 形态 | 宿主层 | 求值时机 |
| --- | --- | --- | --- |
| 行内 | `{=cond ? A \| B}` | ContentScanner（扫描期区分表达式/文字括号） | 烘焙期 |
| 段落 | `[if cond]` | 结构层：段落修饰（块选项通道） | 烘焙期 |
| 结构 | `[if cond -> #标签]` | 结构层 → ControlFlowLowerer → graph 边 | 播放到达边时 |

**这不是一个机制实现三遍，而是同一个求值器 + 三个宿主层**——与 §3.3 同构。
KMD 前端的反复母题：*共享内核 + 多宿主*，而不是*每种形态一个特例*
（旧 parser 的病根恰是反着来：`f|dot|bare` 三分法、scene-clear 伪装 token、赋值伪装 marker）。

旧世界死亡通知：`ControlFlowLineAst` 的 `endif`/`endrepeat` 关键词随旧前端废止——
新表面没有语句块控制流，分支即"命名段落 + 跳转"（Ink 判据），不存在需要配对的块界。

## 4.4 `#` 纯结构锚点（重开实例 4，D23 条款修订）

原 D23"`#` 标题即跳转锚点"让 `#` 同时是内容（渲染的标题）与结构（锚点），身份重载：
"是否渲染"无法被干净定义，渲染出的标题又只是同名结构的一部分。公理 3 读法：
`#` 是符号，让它同时背跳转与视觉两样东西是一次互串。**修订：`#` 唯一职责是在该行的脚本位置声明锚点；
行是否渲染由行自己的形态决定，与 `#` 无关。**

```kmd
# 真相                    ← 结构行：纯锚点，零渲染，与 --- / ::: / -> 同族
她终于说出了一切……

# 真相 @ .powerIn         ← 内容行 + 锚点前缀："真相"作为正文渲染并演出
                          ←    锚点名 = 该文本；@ 之后空 = 默认揭示
```

原则：**锚点名是地址，不是话语；没有说出口的话不参与正文。**裸 `# name` 的 name 是标识符而非 prose，
默认不渲染不是例外而是应当；`@` 是"此行参与演出"的标记，渲染由它引入。
锚点名 ≠ 渲染文本的场合两行各司其职：`# act-2`（隐形锚点）+ 任意正文行，不需要新形态。
跳转语义随之干净：跳到 `# X` = 落到纯位置，从下一条内容开始演，无"跳转后标题怎么渲染"特判。

配套裁决：

- **标题层级（`##`–`######`）废除。**锚点扁平，唯一性照 AnchorIndex 诊断走。
  B6 大纲/折叠 = 锚点顺序 + 场景结构；若叙事验证真想念层级大纲，它以编辑器元数据回来，不是语言字形。
- **Markdown 糖一致性检查**：`**bold**`/`*italic*` 不受牵连（行内 prose mark，文字恒渲染、无身份重载）；
  `#` 是家族里唯一同时当结构又当视觉的。旧 `# heading → special 糖` 自动展开随旧前端死亡；
  新语料的标题观感用显式链表达（宏场景：`@ heading = ...` 定义一次、`$heading` 复用，B0.4 设计探针压测）。
- **Phase B 只放行首 `#`。**行中锚点不实现（行中 `#` 撞正文扫描歧义），叙事验证有需求再开。
- **名字论裁决**：锚点**不进作用域链，但进唯一性纪律**。作用域链解析"可作主语、可取值的东西"，
  锚点两者皆非。AnchorIndex 是平行于 DefinitionIndex 的独立索引。一般化判据：
  **冲突只可能在查找点发生；两个名字没有共同查找点，就不构成冲突**——故围栏名与锚点名亦不互斥。
- 诊断三件（构建期）：未定义跳转目标、重复锚点；不可达分支留 B3 图分析。

## 4.5 场景与烘焙重入契约

`---` 从"段落内的 token"升格为**文档层结构**：DocumentParser 把文档切成 `SceneAst[]`；
场景是烘焙单位、场景级作用域的边界（接 §3.1 区间模型）。

**重入契约（D20+D25 联合推论，非取舍）**：循环 = 后向跳转 = 场景重入，重入时文档级 var 可能已变
（计数器靠此存活）。因此 `[if]`、`{=}`、`$()` 的"烘焙期求值"精确含义是**每次进入场景时求值**。
烘焙机制必须重入安全；重入时 checkpoint 如何建、warp replay 如何跑，归 B3/B4（`segment-graph-runtime-draft.md`）。

## 4.6 B2 层契约产物

```text
DocumentAST { frontmatter, scenes: SceneAst[] }
SceneAst    { paragraphs, 结构行归位 }
StructuralLine = SceneClear | Anchor{name} | Fence{name}
               | BracketLine{options[], opener?, routing?} | GotoLine{target}
AnchorIndex { name → position }（构建期收集，诊断见 §4.4）
ControlFlowLowerer → ControlNode = If(cond, branches) | Goto(target)
                   → 边集 + 锚点解析结果，移交 B3 SegmentGraphBuilder
```

旧 `ControlFlowLineAst`（陈旧关键词）、scene-clear token 形态随切换日死亡。
旧 `@ tag` / `@ jump` / `@ loop` / `@ wait` 的新形态：`#` 锚点、`->` 导向、后向导向即循环（D25）、
`pause(click)` / `|(click)`（D27，事件量词 B0.1 已类型化）。

---

# Part IV · DocumentSemanticIR

## 5.1 契约：resolved but not evaluated

**前端承诺**：IR 里所有名字已解析成实体、所有字面量已类型化并绑定、所有结构已归类、所有诊断已收集。
**后端承诺**：不重新解释源码、不做名字查找、不求值表达式（时机性求值除外，见 §3.3 表）。

"解析"（引用谁、什么类型、哪个 family）全部构建期完成；"求值"（值多少、哪个分支）按宿主时机发生。
这是铁律"参数构建期一次消解"在前端层的整体投影。

## 5.2 IR 形状

```text
DocumentSemanticIR {
  options: OptionTable                # 引擎默认 ← frontmatter 级联后的文档级选项
  scope: { definitions: DefinitionIndex, storeInitials }
  assignments: AssignmentSeed[]       # 按脚本位置排序，烘焙入场景时转 record（§3.2）
  scenes: SceneIR[]
  control: { anchors: AnchorIndex, edges: EdgeSeed[], conditions: BoundCondition[] }
  diagnostics: Diagnostic[]           # 全部携带 source range
}

SceneIR { index, range, paragraphs: ParagraphIR[] }

ParagraphIR {
  presence?: BoundCondition           # [if] —— 烘焙期求值
  options?: OptionPatch               # [...] 段级选项（消费时按级联应用，不粘滞）
  inline: InlineNode[]                # TextRun{marks} | BraceGroup | PauseCue | ExprSpan{=}
  sentences: ResolvedSentence[]
}

ResolvedSentence  { subject: ResolvedSubject, beats: ResolvedBeat[], range }
ResolvedBeat      { connector?: ResolvedConnector{kind, duration, easing?}, members[] }
ResolvedMember    = ResolvedCommand { family, name, args: BoundArg[], granularity?, blocking }
                  | ResolvedClause  { sentence, granularity?, blocking }

BoundValue = TypedLiteral             # 量词已按 commandCatalog metadata 补全默认单位
           | StateRef { storeKey, compiledExpr }   # 触发时刻取值入 record（§3.3）
           | SpatialRef { target, accessor }       # 两段绑定（§5.3）
```

三个设计点：

1. **IR 里没有 ReferenceMember。**`$()` 构建期求值（D4），宏展开是前端职责——引用进 IR 前已原位拼接。
   执行层永远不知道"宏"的存在。
2. **`family` 是 IR 的字段，不是后端的猜测。**跨注册表重名在构建期就是诊断（债 #5 死法），
   到达 IR 的指令必有唯一 family。
3. **`SpatialRef` 两段绑定**：构建期绑定"哪个目标 + 哪个访问器"（D14 `.line`/`.start`/`.end`），
   值的物化在 layout 之后、timeline 之前——空间坐标在排版完成前不存在。物化结果入 record，
   两条 apply 路径共享。现行 `RuntimeValueResolver` 在 apply 时解析坐标，正是败在"两条路径各自解析"。

## 5.3 契约的负空间（五条"不"）

- **不携带引用/宏节点**（已展开）；
- **不携带 family 歧义**（已解析或已诊断）；
- **不携带 segment / graph 节点**——切分是 B3 职责，IR 只交出切分原料（场景边界 + 控制边种子）;
- **不携带引擎指令**（gsap / Pixi 对象是 middleware 以下的产物）；
- **不携带任何旧形状**——`EffectConfig.level`（含 `bg`）、KMDToken、sugar 标志位不得出现在 IR 里。

**Number 默认单位表归属（已定）**：归 commandCatalog metadata——默认单位是命令自身的知识，
注册表已是 metadata 单源（"stage/effect/layout 行为优先读 metadata"原则），SemanticLowerer 消费之。
不另立 schema。

## 5.4 Middleware 层与管线顺序

`EffectMiddleware / LayoutMiddleware / StageMiddleware` 各管一个家族：把 `ResolvedMember` 按 family
降到对应 lane 的输入。跨家族的**拍 → 时间映射**（连接符切拍、拍内同时起跑、粒度实例化的揭示时刻对齐）
不属于任何家族，由 `ChainTimingLowerer` 承担（对应现行 `chainPlanning.ts` 的位置）产出 cue。
现行 `ChainExecutionMode` 枚举（`group_sync / char_stagger / char_tween / container_only / graph_gate`）
已是新模型词汇的雏形——该层**演化**，不是重建。

**管线顺序硬约束：layout 先于执行计划。**实例化粒度（D12）按 unit 揭示时刻对齐，
unit 的空间边界（哪些字属于哪个组）是 layout 产物。垂直顺序：
IR → layout lane 物化显示对象 → Effect/Stage middleware 生成 char/target 级 cue → 执行计划 → SegmentBuilder。
这是语义依赖，不是历史惯性。

---

# Part V · 消费接缝

## 6.1 污染审计

判别问题只有一个：**"新 IR 能不能不虚构已废除概念地表达进这个输入形状？"**

| 接缝 | 现有输入面 | 埋着已废除概念？ | 判定 |
| --- | --- | --- | --- |
| stage lane | command + params（`StageModifierRecord { command, params, timePosition }`） | 无 | **薄 middleware** |
| record / checkpoint 机器 | `Checkpoint { stage, layout, activeParagraphs }` | 无（纯位置+快照哲学） | **薄 middleware**（加 `state` 即 B1 全部接入点） |
| cue / 执行计划抽象 | `BaseCue` / `ChainExecutionPlan` | mode 枚举与目标模型同构 | **演化** |
| effect 路由面 | `EffectConfig.level: char\|group\|block\|bg` + family 字段 | 有：`bg`（债 #9）、旧 family 路由 | **重建输入面** |
| layout 输入 | `KMDParagraphData.tokens`（KMDToken 混装 effects/commands/sugar/isSceneClear——`lowering.ts` 注释自认 layout 与 playback cues 混装） | 有：整个 legacy token 模型 | **重建输入面** |
| 执行项 | `ParagraphExecutionItem { char: KineticChar, visualEffects: EffectConfig[] }` | 有：显示对象纠缠 + EffectConfig | **重建输入面**（与处方 6 后续 KineticChar 收口同一场仗） |

## 6.2 策略：按缝审计（两个全局选项的拒绝理由）

- **全局薄 adapter**：切换爆炸半径最小。但对三个被污染接缝，adapter 必须把新 IR 翻译回含 `bg` 的 level、
  含糖标志的 token——等于亲手重建刚删掉的 CompatProjector，§0"不存在兼容投影"变成空话；
  翻译税永久存在，废除的概念在 adapter 里永生。
- **全局深改造**：哲学一致，但 layout/effect/执行项入口同时重建 = 把 331 playback 和 layout golden
  坐着的地板一次性全换，切换风险最大化；且对三个干净接缝动刀毫无收益。
- **采用：按缝审计，各自判定。**干净接缝的 middleware 是平凡映射（`command + params` 不是旧形状，
  是那条 lane 天然的正确形状）；被污染接缝重建输入面——middleware 产出新输入类型，引擎入口接受它。
  **"重建输入面" ≠ 重写引擎算法**：排版算法、effect preset 内部、stage tween 逻辑不动，动的是入口契约。

## 6.3 两条纪律 + 混合世界风险结案

**纪律一：每接缝严格两形状。**middleware 之上是 IR，之下是 lane 契约，不允许第三种中间形状
（旧世界的病是七种中间形状互相渗透：KMDToken / KMDInlineIR / ParagraphAst / ParagraphIR /
KMDParagraphData / EffectConfig / deprecated mirror）。

**纪律二：依赖单向。**引擎不得 import IR 类型，IR 不得 import lane 类型——可用 import 方向静态检查钉死，
写入验收。推论：跨 lane 新特性（D14 空间值传播、粒度实例化横跨 layout/时间轴）必须走 middleware，
不得抄近路直连引擎——旧世界每条捷径最后都变成债（`var` 借道 marker 就是下场）。

**混合世界风险结案**："一些地方适配 IR、另一些地方还要翻译"的担忧属于绞杀榕模型的共存期病症，
在本项目结构性不成立：(a) 时间上——并行建造 + 原子切换，建造期新前端只接 fixture，
三个污染接缝的入口重建包含在同一次切换里，不存在新旧共存的一天；
(b) 机制上——不存在"adapter"与"middleware"两种东西，薄 adapter 就是 middleware 本身，
终态每条 lane 统一遵循"IR → 自己的 middleware → 自己的 lane 契约"一个模式；
(c) 形状上——干净 = 方向一致，不是形状一致，三条 lane 输入需求本就不同，
强行单一输入形状只会造出上帝对象。reader-runtime 边界照旧：所有新输入形状是 core 侧资产，不引编辑器。

---

## 7. 交付与切换

### 7.1 建造模型

- 新前端在自己的模块空间并行建造，验证靠新语法 fixture（树形 / source range / 诊断占位），不借道旧管线。
  旧前端冻结不改，继续服务编辑器。
- **接触现实不等切换日**：每个切片完成，立即用新语法写脚本压它——叙事验证 KMD 兼作设计探针
  （`design.md`："不是使用者的话，不可能察觉到痛点所在"）。旧语料不是探针，新写的脚本才是。

### 7.2 切换粒度（修正：B0–B2 垂直切片）

原"B0.1+B0.2 最小原子"修正为 **B0–B2 垂直切片完成**。理由：语料重写要求用**目标语言**表达，
而旧语料的存量特征——`hold/ease` 时序、`:char` 粒度、`@ tag`/`@ jump`/`@ loop`/`@ wait`、
frontmatter 变量——分别要 B0.3、B2、B1 才表达得了。切换内容 = 完整目标前端（B0.1–B0.4 + B1 + B2）
+ 按 §6.1 审计判定的接缝，一次完成。

### 7.3 验收

**建造期**：各切片 fixture 全绿；设计探针脚本能解析。

**切换日**：

1. **语料重写 = 完备性审计**：对每个旧行为问"新语言表达得了吗？还要它吗？"——
   表达得了且要 → 改写；要不了 → 归档；**表达不了 → 设计缺口，按重开政策上报**。
2. **331 playback 在线性子集保持绿**——它守的是运行时正确性资产（seek 幂等 / record / replay），
   不是旧语言行为；同时构成新语言表达力的运行时级审计。
   用到跳转/循环的脚本重写后作为 **B3/B4 的验收 fixture**，播放验证等 graph runtime。
3. **诚实诊断**：切换后编辑器对未建成能力（控制流运行时等）给诊断，不给静默行为。
4. **grep 级删除验收**：仓库不再存在旧解析路径（旧 parser / CompatProjector / ScopeRouter /
   RuntimeValueResolver / `layout.globalMarkers` 的 var 写入路径）。
5. golden 由新语料重建基线，人工审 diff（`pnpm test:golden:write` 纪律不变）。
6. `packages/language` 语法资产与 `kmd-writing-guide.md` 随切换更新（`pnpm language:check`）。

**切片顺序**（建造节奏，非切换批次）：B0.1 → B0.2 → B0.3 → B1 → B0.4 → B2 → 切换。
切换后 B3/B4 是新前端上的正常功能开发，不再有迁移问题。

## 8. 已定 / 待解

**已定（2026-08 全程讨论）**

- 交付模型：并行建造 + 一次性切换；无桥、无兼容投影、无分批迁移、无弃用期。
- 切换粒度：B0–B2 垂直切片（§7.2）。
- 接缝策略：按缝审计 + 两条纪律（§6）；混合世界风险结案。
- 语法/语义切面：主语"槽位"归 B0.1，主语"解析"与 family 分流归 B0.2；CommandMember 在 B0.1 无 family 字段。
- `@` 行四句类骨架（§2.2）；ContentScanner 独立模块（§2.4）。
- 作用域 = 区间索引（§3.1）；StateStore 值域 = 标量 + 点/域（§3.2）；拒绝构建期全量预折叠（§3.2）。
- 求值器五宿主三时机（§3.3）；`{=}` 烘焙期；参数位 = baseStrength 模式一般化。
- `#` 纯结构锚点、标题层级废除、锚点不进作用域链但进唯一性纪律（§4.4）。
- 路由行排斥其他槽位；烘焙 = 每次进入场景时求值（§4.2/§4.5）。
- IR 负空间五条；Number 默认单位表归 commandCatalog metadata（§5.3）。

**待解（有归属）**

| 问题 | 归属 |
| --- | --- |
| 粒度 × 拍交互矩阵（逐字实例配对、全局主语从句的触发叠加） | B0.3 切片细化（`phase-b-landing-discussion.md` 3.3） |
| 围栏与场景的结构关系（跨 `---`、LIFO 关闭） | B0.4 切片细化（讨论稿 3.5） |
| 表达式文法细节（字符串引号、`{=}` 嵌套、函数调用合法性） | B1 切片细化（讨论稿 3.1；运算符集合已定：字面量/变量/算术/比较/逻辑/`?:`） |
| `ErrorNode` 恢复粒度与 diagnostic 结构 | 与 B6 inspector / Monaco 对齐 |
| Segment 切分粒度（场景/分支点/wait gate 如何切） | B3 设计（`segment-graph-runtime-draft.md`） |
| graph seek 对非 default path 的 UI 契约 | B4 设计（`1.6-phase-b-plan.md` §8） |

---

## 附录 A · 层契约一览

| 层 | 输入 | 输出 | 承诺 | 禁止 |
| --- | --- | --- | --- | --- |
| DocumentParser | source 行 | DocumentAST + 行归类 | 每行至多一种结构身份 | 不解析 `@` 右侧内部 |
| ContentScanner | 正文行（`@` 左侧） | InlineNode[] | `{=}` 门禁、逐节点 range | 不求值、不选区解析 |
| ChainParser | `@` 右侧 | SentenceAst[] | 全量节点家族、range/raw | 不定 family、不补单位 |
| AstNormalizer | DocumentAST | 归一后 AST | 续行/空白/结构行归类 | 不改语义 |
| ScopeResolver | name + ScriptPosition | 实体 \| 诊断 | D19 链序、D21 冲突律 | 不静默裁决 |
| StateLowerer | Definition/Assignment 句 | DefinitionIndex + AssignmentSeed | 区间与位置完整 | 不执行赋值 |
| ControlFlowLowerer | 条件/锚点/`->` | ControlNode + EdgeSeed | 未定义/重复锚点诊断 | 不做图可达性（B3） |
| SemanticLowerer | SentenceAst | ResolvedSentence | family 唯一或诊断、量词类型化、引用已展开 | 不留 ReferenceMember |
| Middlewares | DocumentSemanticIR 分族切片 | lane 契约 | 每接缝两形状、单向依赖 | 不产第三种中间形状 |
