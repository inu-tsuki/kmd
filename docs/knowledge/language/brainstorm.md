# Language Brainstorm

> 最近更新：2026-07-08
> 状态：Brainstorm / Not Implemented

这里收纳尚未收敛、但可能影响 Phase B 语言形状的想法。本文不是当前 runtime 契约，也不是 parser 已支持语法。

## Pharo / Smalltalk 作为参照系而非依赖

> 来源：2026-07 语言设计收敛讨论。结论：**不接 headless Pharo 进运行时**——镜像式 VM 与"自足 JS bundle 跑在浏览器/WebView"的宿主形态冲突（离线 reader、`RuntimeAssetPolicy`），PharoJS/WASM 均不成熟。持续偷师的三件事：

- **消息统一性**：主谓模型（链头 = receiver）本身就是 Smalltalk 的看法，已进封盘规范（D1）。
- **doesNotUnderstand → 诊断**：链头查找失败不是 parse error，走诊断总线给建议。已写进 `scope-and-lifetime.md`。
- **Inspector 活性愿景**：选中任何正在播放的 char / obj / flow，看到完整状态并现场改参数回写脚本——把 Pharo 的镜像式 liveness 转写成编辑器原生需求（编辑器路线图项，非语言项）。

## 裸文本匹配（内容选择器二期）

一期内容选择器只匹配括号组（`{真相}`，D16）。二期愿景：允许选中**未加括号**的正文子串，正文完全零污染。代价是"哪些字被特效罩住"失去正文侧视觉痕迹，与"正文里应该看得出哪里有戏"（公理 1）冲突——需要真实创作语料再裁决。与前缀模糊匹配目标不同（表达力扩张 vs 书写便利），互不许诺。

## 期望 Demo（新语法的验收样例）

封盘规范落地后，以下 demo 应能按字面写法运行，作为验收锚点（完整写法见 `selection-model.md`）：

1. **回转文字**（流游标低阶词汇）：`flow.turn(15deg/char).scale(0.98/char)`。
2. **文字树**（多流共享锚点）：`flow.dir(up).mark(fork)` + 两个 `[flow.from(fork).dir(...)]` 围栏。
3. **斩断文字流**（围栏对象 + 并联句子）：两个 `:::` 围栏 + `upobj.powerIn(0.5s).left(0.5line).up(1char) + downobj....`。

## 控制流特性缺口清单

> 来源：2026-07 语言收敛二轮讨论（loop/wait 除名后对 Ink/Ren'Py/Twine 特性谱的盘点）。
> 按"演出价值 ÷ 设计成本"排序，未封盘。

1. **选择肢**（头号缺口，值得单独一轮设计讨论）：交互作品的心脏。KMD 的天然优势是**文字本身就是按钮**——
   动态排版的选项不需要 UI 控件。直觉形态（未定）：括号组挂导向谓语 + 事件停表：
   `{留下} {离开} @ {留下}.choice(-> #stay)  {离开}.choice(-> #leave)` 配 `pause(choice)`。
2. **回访计数**：Ink 的 knot 读取计数。给 `#` 锚点挂内建计数进文档作用域，
   `{=seen(#真相) > 0 ? 你又来了 : 你好}`。叙事刚需，实现便宜。
3. **导向后返回**（Ink tunnel `-> sub ->`）：副歌/重复段落复用后回原处。中等价值，可后置。
4. **种子化随机变体**：`{=}` 里的 shuffle/cycle。与"状态是脚本位置纯函数"（D20）有张力——
   随机种子必须存进 `var` 才能 seek 安全，设计时须小心。
5. **内建 `#end` 锚点**：`-> #end` 显式收束。一行决议的事，攒到下轮一起封。

## 游戏化 TS Segment 宿主契约（草图）

> 来源：2026-07 讨论"用 TS 写游戏脚本、留出与 KMD 播放器/segment 宿主接口"的可行性评估。
> 结论：**可行**，架构座位已留好（`InteractiveRuntimePlan`、`SegmentGraphEdge.moduleId`、wait-gate）。Phase C 实施。

**核心形态**：游戏 segment = 一个**不透明的 graph 节点**。

```
KMD 侧（形态待定）：  [game(./pong.ts) -> #win | lose -> #lose]
宿主给游戏的最小 API：
  read/write 文档级 var    // 游戏结局写 var，出边照常按条件求值——复用全部现有 graph 机制
  受控显示层               // 自己的 canvas layer 或受限的文字对象生成，不给 Pixi 场景树直接访问
  complete(outcome)        // 通知 GraphRuntimeCoordinator 求值出边
```

三个要扛的风险（按重量排）：

1. **沙箱**（最重）：社区平台上跑不可信 TS = reader WebView 内执行任意代码。iframe/worker 隔离 +
   能力制 API（`RuntimeAssetPolicy` 同一哲学），游戏模块走 assetManifest 加载。工程量大头在此，不在接口设计。
2. **seek 语义**：游戏非确定性 → 定为**原子节点**，seek 到它即停在入口快照；已通关的重放用记录的结局
   （var diff）沿出边走。graph 草案的 static 快照哲学直接覆盖。
3. **接口纪律**：v1 只给"var 读写 + 独立显示层 + complete"。API 给小了好加，给大了收不回；
   深度整合（游戏操纵正文排版、镜头）留给真实需求证明。

语言侧成本最小：只需要"外部模块节点 + 结局边"一个形态，连新词性都不用。

## Cross-KMD References

当前 runtime 仍以宿主传入的单个入口 `.kmd` 为播放源。未来如果 `.kmd` 可以引用另一个 `.kmd`，它不应该只是“把文本拼进去”的 include。更健康的语义是：入口 `.kmd` 声明文档依赖，resolver 在 parser/lowering 前形成受控的 document dependency graph。

可能存在三类引用：

- 特效宏库：只导入宏、特效对象和命名空间，不产生可播放段落。
- 片段/章节引用：允许 `@ jump` 或未来 `@ call` 跳到外部文档中的 tag / segment。
- 资源脚本：作为 shader、layout preset、game segment config 等数据源，由 manifest 控制加载。

占位语法可以长这样，具体关键字未定：

```kmd
@ use "./effects/weather.kmd" as weather
雨夜。 @ f.weather.rain

@ link chapter2 from "./chapter-2.kmd#start"
@ jump chapter2
```

## Link To Phase B

这条想法应归入 Phase B 的三个系统，而不是当前 Community API 或 reader runtime：

- B0 syntax frontend：定义宏、特效对象、命名空间引用和 dependency declaration 的 AST 形状。
- B2 control flow：让 `@ jump` / future `@ call` 能表达跨文档 tag 或 segment target。
- B3 SegmentGraphPlan：允许 graph edge 持有 `documentId` / `moduleId`，但不让播放器热路径自由加载文件。

## Constraints

- 引用必须通过 Work revision、`assetManifest` 或未来 import map 解析。
- runtime 不应在播放热路径里自由 fetch 任意相对 `.kmd` 路径。
- 外部 `.kmd` 不应自动成为另一个 `Work`；它首先是当前 Work revision 的受控脚本依赖。
- 循环引用、命名空间遮蔽、跨文档 state 作用域都需要 diagnostics。

## Open Questions

- `.kmd` 引用另一个 `.kmd` 时，是导入宏/对象、跳到外部 segment，还是二者都允许？
- 跨文档引用的 state 是否共享，还是每个 document/module 有独立 state scope？
- effect object 是否按 namespace 隔离，还是允许显式 re-export？
- dependency graph 应属于 Work revision manifest，还是成为语言级 import map？
- Android 离线缓存应缓存展开后的单文件 bundle，还是缓存入口 `.kmd` 加依赖图？

## Runtime Viewport Switching During Playback

> 来源：Android Reader 全屏 runtime 原型讨论。

移动端阅读可能需要在同一个 `.kmd` 播放会话中切换 viewport：例如竖屏阅读流进入横屏舞台段落，或用户在播放中把手机旋转为横屏。这个能力暂时不应被设计成创作者直接调用的语言语法，而应先作为 host/runtime 协议能力脑暴。

核心目标：

- 切换 viewport 不应等价于重新加载作品。
- 播放进度、timeline 状态、变量状态和当前 segment 应尽量保持。
- `stage` / `interactive` 模式应优先保持设计坐标系，只重算 letterbox、baseScale 和交互命中映射。
- 横屏舞台不应长期作为竖屏 letterbox 内容阅读；它应被视为需要横屏观看的作品形态，竖屏 letterbox 只是过渡或兼容态。
- `scroll` / `paged` 模式可以触发 reflow，但必须明确哪些 marker、段落布局和滚动位置可被稳定恢复。
- `designWidth` / `designHeight` 属于 stage design space；普通阅读文档不应把固定设计画布作为布局事实。

可能的协议草案：

```ts
type RuntimeViewportMode = 'portrait' | 'landscape' | 'adaptive';

interface ReaderRuntimeViewport {
  width: number;
  height: number;
  devicePixelRatio?: number;
  orientation?: RuntimeViewportMode;
  backgroundColor?: string;
}

interface SetViewportCommand {
  type: 'setViewport';
  viewport: ReaderRuntimeViewport;
  preservePlayback: true;
  transition?: 'instant' | 'fade' | 'letterbox';
}
```

推荐流程：

1. Host 感知窗口变化、系统旋转或用户选择。
2. Host 根据 Work presentation、设备尺寸和安全区域生成新 viewport。
3. Runtime Bridge 发送 `setViewport`，不要销毁 WebView / player session。
4. Runtime 暂停或标记当前 tick，应用新 viewport。
5. Stage 模式更新 world transform；scroll/page 模式执行可恢复 reflow。
6. Runtime 返回 `viewportChanged`，附带恢复后的 progress / time / layout diagnostics。
7. 失败时保持旧 viewport，并返回 recoverable error。

开放问题：

- `.kmd` 是否需要声明某些段落只能横屏、只能竖屏，还是完全由 Work metadata 负责？
- 如果播放中的特效正依赖屏幕边界、marker 或相机参数，viewport 切换时应立即重算还是等待当前 cue 结束？
- scroll/page 模式的 reflow 会不会破坏“同一时间点看到同一行”的阅读预期？
- 互动作品中，用户手势、系统返回手势和桌面切换手势的优先级如何统一？
- Android / Web / Editor Preview 是否共享同一套 `setViewport` 协议，还是 Android 先实验？

## Community Overlay Around Runtime

> 来源：横屏舞台在手机竖屏中 letterbox 的体验讨论。

横屏舞台如果在竖屏中播放，上下两侧会出现大量空白。普通阅读内容不应该放进这些空白里，因为舞台本体仍然太小；但未来社区体验可以把这些区域用作非阻塞浮层。

可能形态：

- 横屏视频式浏览：舞台内容居中，上下信息带显示标题、作者、评论摘要、审核提示、相关推荐和轻量操作。
- 竖屏阅读式浏览：正文自适应容器，社区信息以左/右侧栏、抽屉或半透明 companion 形式出现。
- 审核视角：横屏舞台旁边或上下区域展示脚本问题、性能提示、资源缺失和一键定位，但不遮挡舞台主体。

约束：

- 社区浮层不是 runtime viewport 的一部分，不改变 `.kmd` 的设计坐标系。
- 浮层不得成为横屏舞台在竖屏中“可读”的借口；舞台作品仍应提供横屏观看路径。
- 这属于社区体验层和审核工具层，不属于当前 Android Reader runtime UI MVP。

## Future Mobile Editor

> 来源：Android Reader 审阅源码查看器边界讨论。

移动端 editor 的方向暂时只作为脑暴，不进入当前 Android Reader runtime UI 任务。原因是未来 KMD script editor 很可能是高度 UI 化的：它不只是一个文本框，而是源码、时间线、舞台预览、特效参数和社区 revision 的组合工作台。现在如果在 Reader 里做一个半成品编辑器，很可能会在真正 editor 启动时重做。

### 可能形态

移动端 editor 可以分成几层，而不是直接复制桌面 Monaco：

- 快速修正模式：改错字、调参数、增删少量行。
- 片段编辑模式：围绕当前播放行或 issue source range 编辑一个小片段。
- 视觉参数模式：把常用特效参数做成滑块、颜色、时间和 easing 控件。
- 时间线模式：围绕 marker / line / cue 调整节奏。
- 审阅回放模式：从 Reader issue 或 discussion 进入，对照播放表现修改。
- Revision 模式：保存本地 snapshot，提交 community revision。

### Reader 到 Editor 的交接

Reader 不直接编辑源码，而是生成上下文：

```text
Reader playback line / source range / issue
  -> review note / discussion / edit intent
  -> Mobile Editor opens same Work revision
  -> author edits working draft
  -> save local snapshot
  -> submit community revision
```

这意味着当前 Reader 只需要稳定这些基础对象：

- `KmdSourceSnapshot`
- source range / source anchor
- playback position
- issue anchor
- review draft / edit intent

这些对象未来可以被移动端 editor 复用，但 Reader 不需要提前实现 editor 行为。

### 编辑能力分级

```text
Level 0: Read-only source context
  - 行号、播放行、issue 定位、discussion anchor
  - 当前 Android Reader 应做到这里

Level 1: Patch suggestion
  - 对某几行提出替换建议
  - 不直接覆盖源码

Level 2: Light text edit
  - 改少量文字、增删几行
  - 需要 undo、dirty state、本地 snapshot

Level 3: Structured effect edit
  - 特效参数 UI、时间线 marker、颜色/速度/位置调节
  - 需要 parser/diagnostics 与 runtime preview 紧密配合

Level 4: Full mobile editor
  - 多文件、版本、社区提交、协作讨论、完整 preview
```

当前 Android Reader 只承诺 Level 0；Level 1 可以作为 review suggestion 出现；Level 2 之后应由独立 mobile editor 计划承接。

### 开放问题

- 移动端 editor 是 Android Reader 的一个模式，还是独立 app / 独立 workspace？
- 轻量编辑是否允许离线保存本地 snapshot？
- 视觉化编辑如何避免和文本源码产生两个事实来源？
- 高级特效参数 UI 应从 command catalog 自动生成，还是人工设计常用面板？
- Reader 中的 issue/discussion anchor 是否能无损跳转到 editor 的对应片段？
