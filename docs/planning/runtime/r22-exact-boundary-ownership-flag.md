# R22 / SA-37：exact-boundary 双 apply — ownership-flag 修复

> 文档状态：已完成（2026-06-30）
> 触发原因：审查者报告 seek 落在 record.timePosition 上、随后 play 会双 apply（pixelate/blur 双 push filter；big ×1.5 两次=×2.25 几何错）。问"相似问题修过很多次，关键点在哪"。
> 结论先行：**关键点不在"加去重 guard"，而在 exact-boundary 上两个 apply 驱动谁拥有这一层架构约定被 seek+play 这条 seam 撕开**。R13-R21 的"构建期分工"模型（每时刻只有一个 apply 驱动，靠 construction 不靠运行时判重）在 exact-boundary 上**物理不可能**——seek 与 play 共享同一 GSAP tick 跨越事件，两驱动必然撞车。修复用有状态 ownership-flag（`state.lastSeekTime`）让位，是"构建期分工"约定在 GSAP deferred 语义下的**必要有状态例外**。

## 1. 探针验证的前提（先 verify-then-write）

approved plan 最初假设 `tl.play()` 同步触发 boundary `tl.call`（基于 `PlaybackController.ts:138` 旧注释），拟用 flip-the-guard（`isAutoPlaying=false→play()→=true`）抑制。**探针证伪**：

| 探针 | 结果 | 裁决 |
|---|---|---|
| R1: seek(1.0)+play() → calls? | play()=0, tick(1/60)=1 | tl.call 是 tick 跨越触发，**非** play() 同步 |
| D1: flip false→play()→true + tick | calls=1, log="CALL fired isAutoPlaying=true" | flip **FAILS**——guard 在 tick 时已恢复 true |
| M1: ownership-flag(lastSeekTime=1.0) + play + tick | "boundary tl.call SKIPPED", calls=0 | flag **WORKS**——在 play() 与 deferred tick 之间存活 |
| T1-T5: 浮点 === | seek clamped 与 record.timePosition 同源时 bit-identical；非 record 时间 gsap 量化无害 | 单值 `===` 安全 |

`PlaybackController.ts:138` 旧注释"tl.play() 同步触发的 0 秒 segmentTl.call"**不准确**——生产工作是因为 `isAutoPlaying` 在 play 前已置 true、call 在 play 后首个 tick 跨越时放行，非同步触发。R22 修正了这条注释。

## 2. 修复

- `PlaybackRuntimeState` 加 `lastSeekTime?: number`（有状态所有权 flag）。
- `seekToTime` 末设 `lastSeekTime = clamped`；`playSegment` 在 register* 前设 `lastSeekTime = tl.time()`（统一 t=0 fresh-build / t=0 ended-replay / t>0 resume 三路径）。
- 所有 boundary `tl.call` 加 guard：`if (state.lastSeekTime === record.timePosition) return;`——
  - style 3 处：SegmentBuilder.ts:311（post-hold block）、TextPlayer.ts:553（group-chain）、TextPlayer.ts:721（char-chain）。原"不加守卫——style 不创建资源"注释废止：双 apply 是 mutation 双（big ×1.5 两次），非资源泄漏。
  - stage modifier 4 处：SegmentBuilder.ts:735（global）、TextPlayer.ts:478（group-chain）、TextPlayer.ts:668（char-chain）、TextStageCueScheduler.ts:63（inline）。
  - behavior/instant 4 处：SegmentBuilder.ts:337/376/452/488（在原 isAutoPlaying guard 后加 lastSeekTime 检查）。
- `playSegment` 去掉 `tl.time()>0` gate，统一调 `register*` + `replayStyles` + `replayStageModifiers`——原 t=0/ended 路径靠 0s tl.call 驱动 behavior/instant/stage-modifier，现翻转：快照消费者驱动，0s tl.call 让位（否则抑制后 0s cam.shake/cam.drift 丢失）。这是 R22 的范围扩展——原 R21 只修 style seam，stage-modifier 的 t=0 路径一直靠 tl.call 驱动、未进 replayStageModifiers。
- `playbackState` 经 `TextTimelineBuildOptions` 传入 `TextPlayer.buildTimeline` → `unrollGroupChain`/`unrollCharChain`/`TextStageCueScheduler.schedule`（tl.call 闭包需读 lastSeekTime）。

## 3. 回归

- §21 `testR22LastSeekTimeLifecycle`（5 case，同步不需 ticker）：lastSeekTime 生命周期。
- §22 `testR22GsapPremise`（3 case，G.default 真实 ticker）：GSAP deferred-fire 前提探针，锁定 load-bearing 假设防 gsap 升级静默破坏。弱断言（套件 ticker stub 环境不稳）。
- §23 `testR22BoundaryGuardMechanism`（9 case，端到端真实管线）：A（blur seek(0) filter=1）/ C（big seek fontSize=54）/ D（seek 非 record 时间无 boundary）。
- test:playback 现 252 case（235 + R22 17）。
- **测试环境局限**：套件 stub gsap.ticker（add/remove no-op），tl.play() 不推进时间、deferred boundary tl.call 不在套件内触发——无法直接复现 seek+play 双 apply（需浏览器 rAF 驱动）。§23 用「seek 后验证 lastSeekTime===record.timePosition + guard 判定应 skip」锁定机制正确性。

## 4. 教训

1. **探针先于写代码**：approved plan 用 flip-the-guard（同步触发假设），探针证伪后才转 ownership-flag；若直接写 flip 会在浏览器环境暴露失败（套件 stub ticker 掩盖，生产 rAF 才暴露）。
2. **"构建期分工"约定在 GSAP deferred 语义下有必要的有状态例外**：R13-R21 把"靠 construction 不靠运行时判重"作为去重约定，但 seek 与 play 共享同一 tick 跨越事件，构建期无法分离两驱动——ownership-flag 是约定的必要补充，不是约定的失败。判别：若两驱动触发时机在构建期可分离（baseline vs record、不同时间线段）→ 靠 construction；若共享同一运行时事件（seek 与 play 共享 tick 跨越）→ 需有状态 flag 让位。
3. **注释中对底层库行为的断言须探针验证后写**：PlaybackController.ts:138 旧注释的"同步触发"误导了多轮修复方向。
4. **范围扩展需在 plan 中显式标出**：原 R22 报告只提 style seam（C），探针发现 stage-modifier 的 t=0 路径也靠 tl.call 驱动、抑制后会丢——plan 阶段就把这条标为"独立于抑制机制、必须做"，避免实现时遗漏导致 ended-replay 的 0s cam.shake 回归。

详见 `docs/knowledge/runtime/core/lifecycle-invariants.md` SA-37 + `timeline-and-easing.md` 检查清单 15 + `effect-pipeline.md` 一句话总结（R22 边界所有权补充）。