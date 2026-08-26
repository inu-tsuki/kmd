# Phase B 落地设计讨论稿

> 状态：讨论中 / 未定稿
> 创建：2026-07-22
> 目的：Phase B 落地前的语言设计疑点审查、编译器架构决策、参考资料索引
> 上游：`phase-b-entry-checklist-2026-07.md` #6（落地设计定稿）
> **2026-08 进展**：落地设计已定稿，正典为 `frontend-architecture-design.md`。
> 第三部分疑点中 3.2/3.4/3.6/3.7/3.8 已裁决，3.1/3.3/3.5 留待解决且归属已定
> （均见该文件 §8）；§4.4（CompatProjector 角色）与第五部分（落地路径）已被
> "并行建造 + 一次性切换"模型作废。第一部分（现状盘点）与第二部分（参考书目）仍有效。

---

## 第一部分：现状分析

### 1.1 当前编译器架构

当前管线是**段落级**的，没有文档级 AST：

```
Source text
  → KMDParser.parse()          // 编排入口：frontmatter + 段落切分
  → KmdAstParser.parseParagraph()  // 语法结构化（逐行）
  → ParagraphAst               // AST：text/group/sugar/pause/command-chain
  → lowering.ts                // 语义路由：f./dot/bare 分发
  → ParagraphIR                // 过渡态 IR
  → CompatProjector            // 投影为 tokens/globalEffects
  → runtime (ScriptPlayer → SegmentBuilder → PlaybackController)
```

**关键特征与工程债**（`migration.md` 清单 1–9）：

| # | 问题 | 位置 | 严重度 |
|---|------|------|--------|
| 1 | `cam.` 占位符黑客（`NAMESPACE_CAM_DOT_`） | `KMDCommandParser.ts:53` | 高：阻塞从句 |
| 2 | 成员解析正则不支持嵌套括号 | `KMDCommandParser.ts:68` | 高：阻塞从句/`$()`/值域 |
| 3 | 失配静默重分配（first/last） | `ScopeRouter.ts:applyLineCommands` | 中：D17 要求改诊断 |
| 4 | 裸点排版 pre/post 复制代偿 | `ScopeRouter.ts:dotLineInstructions` | 低：点/域模型后根治 |
| 5 | 跨注册表重名静默裁决 | `commandCatalog.getFamily` | 中：D21 要求改诊断 |
| 6 | `autoConvert` 量词退化为字符串 | `KMDCommandParser.ts:autoConvert` | 高：D24 要求类型化 |
| 7 | `parseInstruction` 只取链首 | `KMDCommandParser.ts:parseInstruction` | 中 |
| 8 | `validate()` 已知名检查 | `Parser.ts:validate` | 低：升级为作用域链 |
| 9 | `CommandLevel` 混入 `"bg"` | `parser/types.ts:3` | 中：与 D12 冲突 |

**另一个已知问题**（`parser-pipeline.md` R-P1）：`braceIdCounter` 跨 `parse()` 累加不重置，破坏确定性。

### 1.2 目标管线（Phase B Plan §3）

```
Source
  → DocumentParser              // 文档级：围栏、#锚点、块选项、---
  → DocumentAST                 // 文档级 AST
  → AstNormalizer               // 续行、糖展开
  → DocumentDependencyResolver  // 跨 .kmd 依赖（首轮只声明）
  → SemanticLowerer             // 作用域链解析
  → ControlFlowLowerer          // 三高度 if → 结构化 control nodes
  → StateLowerer                // var/场景级声明 → StateStore 指令
  → DocumentSemanticIR          // 文档级语义 IR
  → EffectMiddleware / LayoutMiddleware / StageMiddleware
  → ParagraphExecutionPlan      // 段落执行计划
  → SegmentExecutionPlan        // 段执行计划
  → SegmentGraphPlan            // 图：nodes + edges + defaultPath
  → GraphPlaybackRuntime        // 运行时边求值
```

### 1.3 语言设计封盘状态

D1–D27 已封盘，五公理确立。分章文档齐备：

- `chain-model.md`：主谓、四词性、拍、从句、粒度、字面量、`$()`
- `selection-model.md`：点/域双类型、选择器家族、围栏、flow
- `scope-and-lifetime.md`：两级作用域、脚本区间生命周期、选项级联
- `control-flow.md`：三高度 if、`#` 锚点、`->` 导向、事件暂停
- `frontmatter-schema.md`：文档级选项 v1
- `migration.md`：旧→新对照、工程债清单

---

## 第二部分：语言设计与编译器设计参考

### 2.1 核心参考书目

#### 语言设计

| 书/资源 | 与 KMD 的关联 | 优先级 |
|---------|-------------|--------|
| **Martin Fowler,《Domain-Specific Languages》(2010)** | DSL 设计的圣经。内部/外部 DSL 分类、语义模型、代码生成模式。KMD 是外部 DSL，Fowler 的 "Semantic Model" 模式直接对应 DocumentSemanticIR | ★★★ |
| **Markus Völter,《DSL Engineering》(免费 PDF)** | 比 Fowler 更工程化。覆盖外部 DSL 的语法定义、解析、类型系统、IDE 集成。KMD 的 TextMate grammar → LSP 路径与此书直接相关 | ★★★ |
| **LilyPond 设计文档** (`lilypond.org/doc/.../essay/`) | "正文与标注混排"的哲学同源。LilyPond 的 `\` 命令前缀 ≈ KMD 的 `@`；音乐事件序列 ≈ 链的时间轴。其"输入是内容的抽象描述，不是排版指令"原则 = KMD 公理 1 | ★★☆ |
| **Ink (Inkle Studios) 语言文档** | 叙事分支控制流的直接参照。Ink 的 knot/stitch ≈ KMD 的 `#` 锚点；divert `->` 语法 KMD 直接借用；tunnel `-> sub ->` 是 brainstorm 中的"导向后返回" | ★★☆ |
| **CSS Selectors Level 4 规范** | 选择器类型系统的工业标准。KMD 的点/域双类型 ≈ CSS 的伪元素/伪类区分；特异性（specificity）概念可用于 KMD 选择器冲突裁决 | ★☆☆ |

#### 编译器/解析器

| 书/资源 | 与 KMD 的关联 | 优先级 |
|---------|-------------|--------|
| **Bob Nystrom,《Crafting Interpreters》(免费在线)** | 最佳现代编译器入门。递归下降 + Pratt 解析的完整实现。KMD B0.1 的"小型递归下降"直接对应此书 Part II 的解析器 | ★★★ |
| **Vaughan Pratt, "Top Down Operator Precedence" (1973)** | Pratt 解析原始论文。KMD 的表达式求值（`{=}` 内、参数位）需要处理运算符优先级，Pratt 是最优雅的方案 | ★★☆ |
| **Terence Parr,《The Definitive ANTLR 4 Reference》** | 如果考虑 parser generator 路线。但 KMD 的语法足够小，手写递归下降更可控 | ★☆☆ |
| **Alfred Aho et al.,《Compilers》(龙书)** | 经典参考。IR 设计、数据流分析、代码生成。KMD 的 lowering 层设计可参考其 IR 章节 | ★☆☆ |

#### 特定模式参照

| 资源 | 关联 |
|------|------|
| **GSAP 文档** | 时间轴模型。KMD 的 Segment 内部就是 GSAP timeline；拍（beat）模型需要理解 GSAP 的 position parameter |
| **Motion Canvas** | 代码驱动的动画 DSL。其 scene/generator 模型与 KMD 的 segment 有结构相似性 |
| **Ren'Py** | 视觉小说脚本。`say` 语句 + 控制流 + 变量系统。KMD 的"正文 + `@` 指令"是 Ren'Py 的"对话 + Python 块"的排版化变体 |
| **Pharo/Smalltalk** | 已在 brainstorm 中引用。消息统一性 = 主谓模型；doesNotUnderstand = 诊断建议 |

### 2.2 推荐阅读路径

为 Phase B 落地设计，建议按以下顺序阅读：

1. **Crafting Interpreters 第 5–7 章**（表达式解析、语句解析）→ 直接指导 B0.1 递归下降
2. **Fowler DSL 第 15–18 章**（语义模型、代码生成）→ 指导 DocumentSemanticIR 设计
3. **Ink 语言文档**（knot/divert/variable）→ 验证控制流设计的完备性
4. **Pratt 解析教程**（journal.stuffwithstuff.com/2011/03/19/）→ 指导表达式求值器
5. **LilyPond essay**（music-representation + flexible-architecture）→ 校准"正文优先"原则

---

## 第三部分：语言设计疑点清单

以下是我在调查中发现的、封盘决议未完全覆盖或存在张力的问题。按影响 Phase B 落地的紧迫度排序。

### 3.1 表达式语法未完全定义（影响 B1）

**现状**：`chain-model.md` 说"链内参数位天然是表达式语境"，`control-flow.md` 定义了 `{=}` 入口，但没有给出表达式的完整文法。

**疑点**：
- 表达式支持哪些运算符？优先级表是什么？
- `{=}` 内能否嵌套 `{=}`？（如 `{=var.x ? {=var.y ? a : b} : c}`）
- 参数位的表达式与 `{=}` 内的表达式是否完全同文法？
- 字符串字面量用什么引号？能否包含中文？
- 函数调用是否合法？（如 `shake(strength = max(var.x, 5))`）

**建议**：在 B1 之前产出一份**表达式文法片段**，至少覆盖：字面量（数字/字符串/布尔）、变量引用（`var.x`/裸名）、算术（`+ - * /`）、比较（`> < >= <= == !=`）、逻辑（`&& || !`）、条件（`?:`）。用 Pratt 解析实现，优先级表显式列出。

### 3.2 `$()` 展开的精确时机（影响 B0.4 / B1）

**现状**：D4 说"构建期求值"，`control-flow.md` 说"$() 为构建期求值；播放期动态改变走响应式对象通道"。

**疑点**：
- "构建期"具体是哪个阶段？`SemanticLowerer`？`SegmentGraphBuilder`？
- 如果 `$()` 引用的 `var` 在构建后被 `[if]` 条件改变，展开结果是否固定？
- 宏展开是纯文本替换还是 AST 替换？（卫生宏 D3 暗示是 AST 级）
- 展开后的链是否保留对原始宏定义的溯源信息（用于诊断）？

**建议**：明确 `$()` 在 `SemanticLowerer` 阶段展开（此时作用域链已建立但 segment 未烘焙）。展开是 AST 级替换（不是文本），展开后的节点携带 `origin: "macro-expansion"` 标记。构建期求值意味着读取的是**该脚本位置的静态作用域快照**，不读取播放期动态值。

### 3.3 拍与实例化粒度的交互（影响 B0.3）

**现状**：D9 定义拍为"连接符切分，同拍谓语同时起跑"；D12 定义粒度为"被修饰成员按 unit 实例化，每实例对齐该 unit 揭示时刻"。

**疑点**：
- `shake:char(3) ~1s~> wave:char(5)`：逐字 shake 和逐字 wave 的"揭示时刻"如何对齐？每个字的 shake 实例和 wave 实例是否独立配对？
- 从句挂粒度 `(cam.zoom(+=0.01)):char`：每次触发是"逐字触发一次从句"，但从句内的 `cam.zoom` 是全局效果——100 个字触发 100 次 zoom？还是叠加？
- 拍内多个 `:char` 成员：`shake:char(3).wave:char(5)` 同拍，每个字的两个实例是否同时起跑？

**建议**：在 B0.3 设计文档中补充"粒度 × 拍"的交互矩阵。核心规则建议：
- 粒度实例化是**空间维度**的展开（每个 unit 一个实例）
- 拍是**时间维度**的分组（同拍同时起跑）
- 两者正交：同拍内多个 `:char` 成员，每个字的所有实例同时起跑
- 全局主语（`cam`）的从句被 `:char` 修饰时，每次触发是独立的 tween 实例，后触发的覆盖先触发的（GSAP overwrite 语义）

### 3.4 并联句子 `+` 的约束（影响 B0.3）

**现状**：`chain-model.md` 说"`+` 连接表示并联（同时起跑的两个完整句子）"。

**疑点**：
- `+` 两侧的句子能否有不同的连接符？（`a.red ~1s~> blue + b.green -2s-> yellow`）
- `+` 能否连接超过两个句子？（`a + b + c`）
- `+` 句子内的 `!` 阻塞如何影响整体？（一侧阻塞，另一侧继续？）
- `+` 能否出现在从句内？

**建议**：`+` 是句子级并联，两侧各自独立时间轴，互不阻塞。可以链式 `a + b + c`。`!` 只阻塞所在句子的下一拍，不影响并联的另一侧。`+` 不出现在从句内（从句是打包工具，内部是单句子）。

### 3.5 围栏与段落的结构关系（影响 B0.4 / B2）

**现状**：D15 定义 `:::name` 围栏，`selection-model.md` 说围栏可嵌套。

**疑点**：
- 围栏能否跨越 `---`（场景分隔）？
- 围栏内的段落是否仍然参与正常的段落切分？
- 围栏能否包含 `#` 锚点？（即跳转目标能否在围栏内？）
- 嵌套围栏的关闭顺序是否必须 LIFO？

**建议**：
- 围栏**不可**跨 `---`（场景分隔清除场景级作用域，围栏名是场景级）
- 围栏内段落正常切分，围栏只是选区定界
- 围栏内**可以**包含 `#` 锚点（锚点是文档结构，不受选区约束）
- 嵌套必须 LIFO（否则诊断报错）

### 3.6 `[if]` 的段落归属（影响 B2）

**现状**：D23 定义 `[if cond]` 为"段落有无"。

**疑点**：
- `[if]` 是段落的第一行，还是独立于段落？
- 如果 `[if]` 后紧跟空行再接正文，算哪段？
- `[if]` 能否出现在围栏内？
- 多个 `[if]` 能否修饰同一段？

**建议**：`[if]` 是段落的前缀修饰（与 `[key=value]` 同族，D22 已定义 `[...]` = 段级选项 + 段首句子）。它必须紧邻所修饰段落的第一行（之前不能有空行）。可以出现在围栏内。多个 `[if]` 修饰同一段 = AND 语义。

### 3.7 `#` 锚点的唯一性与作用域（影响 B2）

**现状**：D23 说"`#` 标题即跳转锚点"。

**疑点**：
- 同名 `#` 锚点出现两次怎么办？（D21 禁 shadowing，但标题是 markdown 糖）
- `#` 锚点能否在 frontmatter 中声明？
- 跳转目标是否必须在同一 `.kmd` 内？

**建议**：
- 同名锚点 = 诊断错误（D21 全局命名冲突律）
- 锚点只在正文中声明（`# 标题` 行），不在 frontmatter 中
- Phase B 内跳转目标必须在同一 `.kmd` 内；跨文档跳转留 Phase C

### 3.8 事件量词 `click` 的语法位置（影响 B2）

**现状**：D27 定义 `pause(click)` 和正文糖 `|(click)`。

**疑点**：
- `click` 能否出现在连接符参数位？（`~click~>` = 等到点击再过渡？）
- `click` 能否出现在表达式中？（`{=click ? ...}`）
- 正文糖 `|(click)` 与 `pause(click)` 的运行时行为是否完全相同？

**建议**：
- `click` 一期只出现在 `pause()` 参数位和 `|()` 糖中
- 不出现在连接符或表达式中（连接符参数是时间量词，表达式是值运算）
- `|(click)` 是 `pause(click)` 的纯语法糖，运行时行为相同

### 3.9 兼容形态的弃用时间线（影响迁移策略）

**现状**：`migration.md` 列出了旧→新对照，但没有给出弃用时间线。

**疑点**：
- `f.` 兼容形保留多久？
- `hold`/`ease` 单词形态何时移除？
- `camZoom` 等合成词何时降级？
- 是否需要一个"严格模式"开关？

**建议**：Phase B 全程保留兼容投影（CompatProjector），不移除任何旧形态。Phase B 完成后的下一个版本（v1.7）开始弃用周期：先加诊断警告，再在 v2.0 移除。不引入"严格模式"——诊断警告足够。

---

## 第四部分：编译器架构决策点

### 4.1 递归下降 vs Parser Generator

**决策**：手写递归下降。

**理由**：
- KMD 语法足够小（链语法 + 表达式 + 文档结构），不需要 ANTLR/PEG 的重量级工具
- 手写解析器可以产出更好的诊断信息（doesNotUnderstand 风格）
- 与现有 `AstParser` 的代码风格一致
- Crafting Interpreters 的递归下降模式直接可用
- 表达式部分用 Pratt 解析（Top-Down Operator Precedence）

### 4.2 文档级 AST 的形状

**决策**：引入 `DocumentAST` 作为文档级结构节点，段落 parser 降级为子解析器。

**关键设计**：
```typescript
interface DocumentAST {
  type: "document";
  frontmatter: FrontmatterAST;
  children: DocumentNode[];  // 有序
  diagnostics: Diagnostic[];
}

type DocumentNode =
  | ParagraphNode        // 段落（含正文 + @ 指令）
  | FenceNode            // :::name ... :::
  | AnchorNode           // # 标题
  | StructuralJumpNode   // -> #标签（独占一行）
  | BlockIfNode          // [if cond -> #A | ...]
  | SceneBreakNode       // ---
  | BlockOptionNode;     // [key=value ...]
```

### 4.3 量词类型化方案

**决策**：量词在 lexer 层类型化，不退化为字符串。

```typescript
type QuantityLiteral =
  | { kind: "time"; value: number; unit: "s" | "ms" }
  | { kind: "space"; value: number; unit: "char" | "line" | "self" | "px" }
  | { kind: "angle"; value: number; unit: "deg" }
  | { kind: "rate"; value: number; unit: string }  // deg/char 等
  | { kind: "relative"; op: "+=" | "-="; value: number }
  | { kind: "range"; from: number; to: number; duration?: number; easing?: string }
  | { kind: "event"; event: "click" };
```

### 4.4 CompatProjector 的角色

**决策**：CompatProjector 是**单向投影**，从新 AST 投影到旧 tokens/globalEffects 形状。

- Phase B 期间，新语法产出新 AST 节点，旧语法先走兼容投影
- 运行时仍然消费旧形状（tokens/globalEffects），直到 B3/B4 切换到新 execution plan
- CompatProjector 不做反向转换

### 4.5 诊断总线集成

**决策**：所有新诊断走统一 `DiagnosticsCollector`，不新增 `console.log`。

诊断分级：
- `error`：阻断构建（未定义锚点、重名冲突、失配）
- `warning`：不阻断但提示（弃用形态、兼容投影）
- `info`：建议（doesNotUnderstand 风格的"你是不是想写……"）

---

## 第五部分：Phase B 落地路径探讨

### 5.1 B0.1 详细设计方向

B0.1 是"行为中立"的新链解析器，最关键的约束是**不改变任何现有行为**。

**建议架构**：

```
新链解析器（ChainParser）
  ├── Lexer：量词类型化、连接符识别、括号深度
  ├── MemberParser：递归下降解析谓语成员
  │   ├── 指令名[:粒度][(参数)][!]
  │   ├── 从句 .(句子)[!]
  │   ├── 引用 $name / $(expr)
  │   └── 值域 a~d~>b
  ├── BeatSplitter：按连接符切分拍
  └── ChainAST 输出
      └── CompatProjector 投影为旧 EffectConfig[]
```

**耐久/临时边界**：
- 耐久：Lexer、MemberParser、BeatSplitter、ChainAST 类型定义
- 临时：CompatProjector 的旧形状投影（B3 后逐步移除）

### 5.2 测试策略

- B0.1 的 parser fixture 覆盖所有新语法形态
- 现有 34 个 `.kmd` 测试脚本全部通过 compat 投影保持行为不变
- 新增 `b0-1-coverage.kmd`（已存在）扩展覆盖
- 黄金文件（`__golden__/parser/`）在 compat 投影下不应变化

### 5.3 风险与缓解

| 风险 | 缓解 |
|------|------|
| 递归下降解析器引入新的解析歧义 | 先用现有 34 个测试脚本做差分测试：新旧解析器输出必须一致 |
| 量词类型化改变 `autoConvert` 行为 | 类型化在 lexer 层，`autoConvert` 保持不动直到 B1 |
| CompatProjector 投影不忠实 | 黄金文件 + 差分测试双重保障 |
| 从句/`$()` 的括号深度计数与现有 `splitTopLevel` 冲突 | B0.1 只解析，不改变 `splitTopLevel`；从句在 MemberParser 内部处理 |

---

## 附录 A：KMD 语言在 DSL 谱系中的位置

```
                    通用编程语言
                         │
              ┌──────────┼──────────┐
              │          │          │
         脚本语言    标记语言    查询语言
         (Python)   (HTML)    (SQL)
              │          │
              │     ┌────┴────┐
              │     │         │
              │  文档DSL   样式DSL
              │  (LaTeX)  (CSS)
              │     │         │
              └─────┼─────────┘
                    │
              ┌─────┴─────┐
              │           │
         时间轴DSL    叙事DSL
         (LilyPond)  (Ink)
         (GSAP)     (Ren'Py)
              │           │
              └─────┬─────┘
                    │
                  KMD
            (时间轴 × 叙事 × 排版)
```

KMD 的独特性在于它是**三个 DSL 家族的交叉**：
- 时间轴 DSL（LilyPond/GSAP）：链即时间，拍即同时，连接符即时序
- 叙事 DSL（Ink/Ren'Py）：正文即内容，分支即跳转，变量即状态
- 样式 DSL（CSS）：选择器即作用域，声明即效果，级联即优先级

这个交叉决定了 KMD 的编译器不能照搬任何单一 DSL 的模式，而需要在每一层取各家之长：
- **解析层**取 LilyPond 的"正文与标注混排"（`@` 分隔符）
- **语义层**取 CSS 的选择器代数（点/域双类型）
- **执行层**取 GSAP 的确定性时间轴（Segment 内 timeline）
- **控制流层**取 Ink 的 divert 模型（`#` 锚点 + `->` 跳转）
- **作用域层**取 Smalltalk 的消息统一性（链头 = receiver）
