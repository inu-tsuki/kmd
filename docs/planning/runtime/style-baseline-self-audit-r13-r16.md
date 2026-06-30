# 自审计：style baseline / record 重放矩阵（R13-R16 收束）

> 文档状态：自审计 / 已自审一次（2026-06-30）
> 触发原因：R13-R16 四轮修复集中在"style 资源的 reset/replay"同一主题，问"根本问题是否在同一模块、是否还有遗漏、要不要自审计后再审一次"。
> 结论先行：四轮触及的**不是同一模块**，而是同一条**数据流**（style 写入 → baseline 快照 → record 重放 → seek reset）在**多个模块**上的投影。根本问题是**这条数据流没有单一真相源**——style 资源的"初始态 vs 动态变更"语义在构建期/运行期/多条写入路径上散落，每轮修一个投影点，下一轮在另一个投影点复发。本自审计把所有写入路径列成矩阵，核对 R13-R16 是否覆盖，并标出残余风险。
>
> **自审复核结果（2026-06-30，本文件写成后立即复核）**：§4 R-A 的 P7 `applyInitialStyles` 与 P6 `applyCharEffects` 经全树 grep 复核——两者**均仅有定义、无调用者**（其余匹配均为注释/文档引用）。确认 P6/P7 是死代码，**不存在未修的第三条构建期写入路径**。R13-R16 覆盖 P1-P5 全部活跃写入路径。**本轮合并不被残余风险阻断**；R-A/R-D 转为"死代码清理"技术债（建议确认后删），R-B（单一真相源）为架构技术债。
>
> **后续清理（R18，2026-06-30）**：R-A/R-D 死代码已删除（`applyCharEffects` + `applyInitialStyles` 从 EffectProcessor.ts 移除），`isCharLevelEffect` 文档注释的 stale 引用已更新。全树 grep 复核确认无调用者；build + 162 case + invariants 全过，无回归。R-B 已由 R17 闭合（`classifyStyleWrite` 单一真相源）。本自审计的所有残余风险现已全部闭合。

## 1. 为什么四轮"看起来在同一个模块"

R13-R16 都在改"style 残留 / baseline 错位"，让人以为问题在 `PlaybackController.replayStyles`。实际上：

| 轮次 | 主修文件 | 真正修的"数据流投影点" |
|---|---|---|
| R13/SA-28 | `PlaybackController.ts`（replayStyles 的 reset 窗口） | 运行期 reset 的**窗口语义** |
| R14/SA-29 | `PlaybackController.ts`（playSegment ended 分支） | 运行期 reset 的**操作路径覆盖** |
| R15/SA-30 | `DisplayAssembler.ts` + `TextPlayer.ts` site1/site3 | 构建期 baseline 的**捕获时机** + record 集合的**职责边界** |
| R16/SA-31 | `SegmentBuilder.ts` + `KineticChar.ts` | 构建期 baseline 的**第二条写入路径** |

四轮触及 6 个文件（PlaybackController / DisplayAssembler / TextPlayer / SegmentBuilder / KineticChar / EffectProcessor 间接），跨"构建期 + 运行期"两层。**不是同一模块，是同一数据流的多个投影**。每轮修一个投影，下一轮在另一个投影复发——因为没有在数据流层面建立单一真相源，只在点上打补丁。

## 2. 根本问题（第一性）

style 资源的生命周期有一条隐式契约：

```
构建期：某样式被写入 char.style（"初始态" or "动态变更"？）
       → 若是初始态：应进 baseline 快照，不进 record、不 tl.call 重上
       → 若是动态变更：不进 baseline，进 record / tl.call，seek 时重放
运行期：seek 时 resetStyle() 回 baseline → 重放 timePosition<=now 的 record
```

**根本问题**：这条契约**没有单一真相源**。style 资源的"初始态 vs 动态变更"身份判定散落在：
- 构建期多个写入路径（LayoutPlanner 烘焙 / SegmentBuilder applyGroupEffects / TextPlayer site1-3），每条独立决定"写不写 char.style / 进不进 record / 进不进 baseline"；
- 运行期多个 reset 路径（seekToTime / playSegment-ended / stop / clearScreen），每条独立决定"清不清 / 调不调 replayStyles"。

判定的**边界条件**（什么是 pre-hold？什么是 blocking？）也散落——`applyInitialStylesToStyle` 用 `hold||blocking||level==="group"||"block"`，site 1 旧逻辑只用 `hold||blocking`（R15 顺带修了，但 site 1 整体已删），site 3 R15 后才对齐。**同一个"pre-hold 边界"在三处独立实现，R15 前不一致。**

> **R19 后续（2026-06-30，SA-33）**：R17 把边界收敛到 `classifyStyleWrite` 后，发现这个"对齐后的边界"本身对 **style** 是错的——`level==="group"||"block"` 是 v1.0.0 遗留、给**非 style 容器级特效**（filter/timing/stage）终止烘焙的规则，对 style（经 applyStyleRecursively 落到每个 char）不应终止。后果：显式 `f.red:group` / token 级 `f.red:block` 既不进 baseline（P1 break）也不进 record（site2 `if(isStyle) return false`），被吞。R19 在 helper 内解耦 style vs 非 style 边界。**教训**：收敛散落判定 ≠ 背书判定正确——R17 核对了"P1-P5 各点原判定 == helper 产出"，但漏核对了"边界表达式本身对 style 是否正确"（把遗留规则当不变量固化）。详见 `lifecycle-invariants.md` SA-33 + §E 检查清单第 13 条。

这是 INV-7（多路径单一真相源）在 style 资源上的**完整三形态展开**：
- SA-28：同一 reset 内两窗口耦合（reset 窗口 vs apply 窗口共用过滤）
- SA-29：同一资源清理责任散落多操作路径
- SA-30：baseline 与 record 职责重叠 + 语义身份多位置不一致
- SA-31：同一语义（"初始样式进 baseline"）散落多构建路径

**四轮都是在 INV-7 的不同形态上打补丁，没有消除 INV-7 本身**——没有把"style 资源是初始态还是动态变更"的判定收敛到一个单一真相源。

## 3. 全量写入路径矩阵（自审计核心）

我把所有写 `char.style`（直接或经 styleManager.apply / applyStyleRecursively）的路径列全，核对 R13-R16 覆盖状态。

| # | 写入路径 | 文件:行 | 时机 | 写谁 | 进 baseline? | 进 record? | tl.call? | R13-R16 覆盖 |
|---|---|---|---|---|---|---|---|---|
| P1 | `applyInitialStylesToStyle` | EffectProcessor:212 | 构建期（LayoutPlanner:88） | measurementStyle → glyphPlan.style → KineticChar 构造捕获 | ✅（R15：构造捕获=烘焙态） | ❌（R15 site1 删除） | ❌ | R15 修（change A+B）；**R19 扩展**：显式 group/block style（`f.red:group` / token `f.red:block`）现在也经 P1 烘焙（classifyStyleWrite 对 style 解耦 level 边界，见 R-E） |
| P2 | `applyGroupEffects` → `applyStyleRecursively` | SegmentBuilder:241-285（R21 重构） | 构建期（KineticChar 构造**后**） | char.style（block/global **pre-hold** 样式） | ✅（R16：recapture） | ❌ | ❌（同步） | R16 修；**R21 重构**：P2 现只处理 pre-hold style（hold 抽成 cursor 推进、post-hold style 路由进 P2b）——见 R-F |
| P2b | `segmentTl.call` + `styleRecords`（block post-hold） | SegmentBuilder:282-301（R21 新增） | 运行期 tl.call（block 链 post-hold） | char.style | ❌ | ✅（`allStyleRecords@chainCursor`） | ✅ | **R21 新增**（SA-36）：block/global post-hold style 此前整条经 P2 的 `applyGroupEffects`（不 await），`hold:block` 在内 await 导致墙钟副作用 + post-hold 不进 baseline/record。R21 与 site2/site3 同模型拆 pre/post-hold。 |
| P3 | `unrollGroupChain` site2 `applyStyleRecursively` | TextPlayer:548 | 运行期 tl.call（post-hold） | char.style | ❌ | ✅（TextPlayer:556） | ✅ | 本就正确（`if(isStyle) return false` 跳 pre-hold）；R15 未动 |
| P4 | `unrollCharChain` site3 `styleManager.apply` | TextPlayer:707 | 运行期 tl.call | char.style | ❌ | ✅（TextPlayer:711） | ✅ | R15 修（change C：pre-hold 跳过，post-hold 保留）；**R20 修**（SA-35：边界改为在原始 visualConfigs 含 hold:char 上算 firstBlockingOrigIdx，旧逻辑先滤 hold:char 再算边界 → post-hold style 被吞） |
| P5 | `replayStyles` seek 重放 | PlaybackController:447 | 运行期（seek） | char.style | —（reset 前置） | 读 record 重放 | ❌ | R13 修（reset 窗口）+ R14 修（ended 路径调它） |
| P6 | `applyCharEffects` | ~~EffectProcessor:357~~ | —（**死代码，已删 R18**） | char.style | — | — | — | 不需修（死代码已清理） |
| P7 | `applyInitialStyles`（非 ToStyle 变体） | ~~EffectProcessor:218~~ | 构建期 | KineticChar.style（force=false） | — | — | ❌ | 死代码已删（R18），非活跃路径 |

**P7 是本自审计新发现的未审计路径**：`applyInitialStyles(target: Container, ...)` 在 KineticChar 上 `styleManager.apply(target.style, ..., false)`，与 `applyInitialStylesToStyle`（写 measurementStyle）不同——它直接写已构造的 KineticChar.style。grep `applyInitialStyles(` 只找到定义（EffectProcessor:217），**无调用者**——疑似死代码，但未确认。若它被调用，则是在构造后写 char.style 但不 recapture，同 P2 病。

## 4. 残余风险（自审计发现）

### R-A（已闭合，R18 删除）：P7 `applyInitialStyles` + P6 `applyCharEffects` 死代码已清理
全树 grep 复核：两者**均仅有定义、无调用者**（其余匹配均为注释/文档引用）。确认不是未修的第三条构建期写入路径——R13-R16 覆盖了 P1-P5 全部活跃路径。**已删除**（R18，2026-06-30）：两个方法从 `EffectProcessor.ts` 移除，`isCharLevelEffect` 文档注释的 stale 调用点引用已更新。build + 162 case + invariants 全过，无回归。

### R-B（已闭合，R17）：style 资源身份判定单一真相源
四轮都是在 INV-7 形态上打补丁，"初始态 vs 动态变更"的判定 + pre-hold 边界仍散落在 P1-P5 各处。**R17 已根治**：扩 `shouldApplyAsInitialStyle` 为 `classifyStyleWrite(config) → {isStyle, isBlocking}` 单一真相源，P1-P5 全部改调它，pre-hold 边界统一固化。未来新增第六条 style 写入路径经 helper 分流即可，不再手工对齐（消除 SA-31 复发条件）。并补 §13 端到端真实管线回归（parser→SegmentBuilder→seek，headless shim），暴露两个 fake char 掩盖的测试假设错误（Pixi Fill 对象 vs 字符串、KineticText 默认 fontSize 36 vs 24）。test:playback 现 162 case，行为零变化已验证（现有 151 case 全过）。详见 `lifecycle-invariants.md` SA-32。

### R-C（测试覆盖债，已在 SA-31 文档诚实记录）：SegmentBuilder 接线未直接测
§12 测 `recaptureBaseStyleSnapshot` 契约（真实 KineticChar），不直接测 SegmentBuilder 的 tokens 遍历调用。接线是 3 行简单遍历，但按 SA-27 教训，"简单"不等于"零覆盖"。**建议**：若能低成本驱动 SegmentBuilder（最小段落 + block 样式），补一个端到端 case；否则在 SA-31 文档已标注的限制下接受。

### R-D（已闭合，R18 删除）：P6 `applyCharEffects` 死代码已清理
定义存在、无调用者。不造成 bug，但是认知噪音——读代码者会以为它是活跃路径。**已删除**（R18，2026-06-30）。

### R-E（已闭合，R19）：R17 收敛的边界表达式对 style 错误（显式 :group / token :block 被吞）
R17 把"初始态 vs 动态 + pre-hold 边界"收敛到 `classifyStyleWrite` 单一真相源（闭合 R-B），承诺"行为零变化"。但收敛时把**原始边界表达式**（`hold||blocking||level==="group"||"block"`）原样固化进 helper——该表达式是 v1.0.0 遗留、给**非 style 容器级特效**终止烘焙的规则，对 **style** 错误。后果（用户探针确认）：显式 `f.red:group` / token 级 `f.red:block`（注意段落广播 `[.red:block]` 走 P2 recapture 已正确）既不进 baseline（P1 break）、也不进 record（site2 `if(isStyle) return false`），被整条吞掉 → 自然播放 + seek 全失效。**R19 已修**（2026-06-30）：在 `classifyStyleWrite` 内解耦——`isStyleScoped = isStyle && (level group/block)`；`isBlocking = !isStyleScoped && (...)`。`shouldApplyAsInitialStyle` 复用 helper（同源防漂移）；site2 `unrollGroupChain` 的本地 `isBlocking`（R17 漏收敛）改走 helper。回归 §14 加 20 case（真实 parser→SegmentBuilder→seek 管线），test:playback 现 182 case。详见 `lifecycle-invariants.md` SA-33。**这是 R-B 闭合后的直接复发**——证明"收敛散落判定"必须在收敛时独立验证被收敛逻辑的正确性，不能把遗留表达式当不变量背书。

### R-F（已闭合，R21）：paragraph block 链整条经 applyGroupEffects 未按 pre/post-hold 拆分（post-hold style 被吞 + 墙钟副作用）
R13-R20 把 char / group / char-chain / token-block 四条 style 写入路径的 pre-hold/post-hold 边界逐条修对，但 **paragraph 级 `[....:block]` / global 这条路径**（P2）一直走"整条 `applyGroupEffects` 同步应用 + recapture"的特例，**没按 pre/post-hold 拆**。后果（用户探针确认）：`[.hold:block(0.05s).red:block]` 的 red 既不进 baseline 也不进 record，hold 到点后 `applyStyleRecursively` 作为**墙钟副作用**触发（不播不 seek 自己染红，seek/reset 管不住）；`[.red:block.hold:block(1s).bold:block]` 的 bold 同理被吞。根因：`SegmentBuilder.ts:242` 旧代码 `applyGroupEffects(paragraphText, [...blockRemaining])` **不 await**，而 `hold:block` 在 applyGroupEffects 内（EffectProcessor.ts:280）`await result`（gsap.delayedCall promise）→ 函数挂起 → 同步的 recapture 跑在 hold resolve 之前（post-hold 漏 baseline）+ applyGroupEffects 无 styleRecords 概念（post-hold 不进 record）→ hold 到点恢复后写 char.style 成为墙钟副作用。**R21 已修**（2026-06-30）：block 链按 pre-hold / post-hold 边界拆分（镜像 site2/site3），`classifyStyleWrite` 单一真相源判边界——pre-hold style → applyGroupEffects + recapture（R16 模型不变）；hold → 推进 chainCursor（不进 applyGroupEffects）；post-hold style → `segmentTl.call` + `allStyleRecords`（新增 P2b）。回归 §20 加 16 case（含墙钟副作用检测断言：setTimeout 120ms 后 style 仍非红），test:playback 现 235 case。详见 `lifecycle-invariants.md` SA-36。**教训**：收敛一条 style 写入路径后，必须全局 grep 确认同语义的其他路径也走了新模型——block 链藏在 `applyGroupEffects` 同步路径里（不是独立 site，不像 site2/site3 显式），R17 收敛 classifyStyleWrite 时它根本没调用 helper 做边界拆分，故 R19/R20 的修复都没触及它。

## 5. 自审结论

**根本问题不在同一模块**：四轮触及 6 文件、跨构建期+运行期两层，都是 INV-7（多路径单一真相源）在 style 资源数据流上的形态展开。R13-R16 修了**四个投影点**（窗口语义 / 操作路径覆盖 / baseline 捕获时机+record 职责 / 第二条构建路径），但**没消除 INV-7 本身**——"初始态 vs 动态变更"判定仍散落。

**是否需要自审计后再审**：需要，且本文件就是自审计。自审计新发现 **P7（`applyInitialStyles` 未审计路径）** 和 **R-B（根治方向：单一真相源）**，这两个是四轮逐点修复时看不到的、只有在数据流全量矩阵层面才暴露的残余风险。**建议下一步**：
1. 确认 P7/R-D 是否死代码（grep + 人工核对调用图），若死则清理；
2. R-B（单一真相源）作为技术债立项，不阻断本轮合并，但在引入第六条 style 写入路径前必须落地——否则 SA-31 会以第三形态复发。

**本轮合并判断**：R13-R16 已覆盖 P1-P5 全部活跃写入路径（P6/P7 已确认死代码，复核见文档头），回归 151 case 全过，门禁全绿。**本轮可合**——残余风险 R-A/R-D 转为死代码清理债，R-B（单一真相源）为架构技术债，均不阻断合并，但 R-B 应在引入第六条 style 写入路径前落地。

## 6. 相关文档
- `knowledge/runtime/core/lifecycle-invariants.md`：SA-28/29/30/31/32/33/34/35/36 单点记录 + §G 元方法论（八个机制 + 检查清单 16 条）
- `knowledge/runtime/core/timeline-and-easing.md`：seek-replay 检查清单第 9-14 条