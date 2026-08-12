# Portable language / runtime boundaries

> 文档状态：方向决议 / 未实施
> 最近更新：2026-08-12
> 触发来源：PR #29 对 core、源码行跳转、anchor、speed 与复合特效的架构审查

## 1. 北极星：KMD 语言不等于 Pixi + GSAP runtime

KMD 的长期目标可以是通用的动态文字、排版与控制流语言；当前 `@kmd/core` 只是完成 editor
解耦后的 **Pixi + GSAP reference runtime 闭包**，仍不是稳定、可跨后端发布的 core API。

IR 是桥梁，但不应做成一个容纳所有阶段的万能对象。目标 lowering 管线是：

```text
source
  -> language AST / semantic IR
  -> layout constraint + glyph plan
  -> effect graph + execution plan + segment graph
  -> backend capability negotiation / lowering
  -> Pixi+GSAP | Canvas/WebGL | game engine | video/subtitle exporter
```

建议未来按职责形成 `language-core`、`layout-core`、`effect-graph`、`execution-plan` 与 backend
adapter；runtime host/session 另层管理时钟、资源与输入。物理拆包应跟随真实第二后端验证，不在本
PR 先制造空包。

## 2. 复合特效：从手写 preset 走向 Effect Graph

现有 `cyberpunk.ts` 已经由基础 filter 组合高级 preset，例如 glow、outline、scanline、RGB split、
noise 与 vignette；但高级特效不只是 `Filter[]`。它还拥有参数映射、共享 oscillator、时序、目标
粒度、资源所有权、cleanup、profile 与性能预算。

作者插件应采用受控的 declarative Effect Graph / Preset IR，而不是在作品里执行任意 JS：

```ts
interface EffectGraphPreset {
  manifest: { id: string; version: string; capabilities: string[] };
  parameters: Record<string, ParameterSchema>;
  nodes: Array<FilterNode | ModifierNode | OscillatorNode | EnvelopeNode>;
  bindings: ParameterBinding[];
  target: 'char' | 'token' | 'group' | 'block' | 'background';
  clock: 'work' | 'wall' | 'event';
  budget?: { maxFilters?: number; maxPasses?: number };
}
```

compiler 可以共享 oscillator、融合/缓存等价节点、拒绝超预算图，并为不同 backend lowering。
内建 `cyberpunk.ts` 最终应以同一图格式表达，成为标准库内建插件，而不是永久手写特例。

本 PR 保留已经验证过的手写组合预设；Effect Graph 先作为 Phase B 后的实现目标。

## 3. 源码导航与控制流

当前 `seekToSourceLine()` 的含义是“在**当前线性 execution projection** 中，定位该行或后继
可执行行的首个时刻”。它适合 editor 右键播放，但不是未来 `# anchor` / `-> #anchor` 的控制流。

Segment Graph 落地后，一行源码可能出现在多条 path、循环的多次 visit 中，因此：

- 索引输出应是 `source position -> node/path candidates/local time`；
- 当前播放上下文可选择同一路径的 candidate；
- 无上下文时 UI 必须明确选择 `defaultPath` 或让用户选分支；
- graph jump 仍按 `docs/planning/roadmap/phase-b/segment-graph-runtime-draft.md` 在 Segment 之间调度，
  不塞进 GSAP timeline。

这样源码行跳转可以扩展，但不会把“行号”误当成作品控制流的稳定身份。

## 4. Anchor 标准：统一索引，不混淆语义

当前存在三类同名事实：layout 的空间 marker、cue 的 lifecycle anchor、TextPlayer 的 source/time
anchor。它们不应被粗暴压成一个无类型 `Map`，而应由一个 typed `AnchorIndex` 统一查询：

```ts
type IndexedAnchor =
  | { kind: 'source'; revision: string; range: SourceRange; target: ExecutionTarget }
  | { kind: 'structural'; semanticId: string; target: GraphNodeId }
  | { kind: 'spatial'; name: string; point: { x: number; y: number } }
  | { kind: 'lifecycle'; event: LifecycleAnchor; target: ExecutionTarget };
```

稳定身份以 revision + source range / semantic id 为核心，不能只靠 line 或 time。token anchor 可在
lowering 时建立；char anchor 只在 consumer 请求时 materialize，避免所有作品默认常驻 O(chars)
索引。layout、editor navigation、LSP、graph jump、timeline 和未来 review/comment 系统消费同一
registry 的不同 typed view。

## 5. 三种 speed 都必要，但不能同名混用

| 概念 | 当前入口 | 含义 | 建议命名 |
| --- | --- | --- | --- |
| reveal cadence | frontmatter `speed`、`~` / `^` | glyph 何时出现，当前单位 ms/char | `revealInterval` / `cadence` |
| effect rate | preset 参数 `speed` | oscillator/局部行为频率，常为 Hz | `rate` / `frequency` |
| transport scale | runtime setting `timeScale` | host 对整个作品时钟的倍率 | `timeScale` |

effect 默认跟随作品时钟；确需不随暂停/倍速变化的行为必须显式声明 `clock: wall`，交互触发使用
`clock: event`。阅读辅助的 host `timeScale` 与作者写入的 cadence 是不同权限层，不能互相回写。

语言迁移时应按单位与职责改名；本 PR 不顺手改现有表面语法。`slow/fast` timing preset 在 chain
路径的接线缺口仍属 execution-plan 后续工作。

## 6. 本 PR 刻意不做

- 不把 `@kmd/core` 宣称为稳定跨后端公共包；
- 不提前实现 Segment Graph、AnchorIndex 或 Effect Graph；
- 不改变现有 speed 表面语法；
- 不扩 parser 诊断合同。LSP 对 `Unknown command: "x"` 的消息反解析保留到 parser 能直接返回
  `{ code, range, message }` 的 Phase B 迁移。
