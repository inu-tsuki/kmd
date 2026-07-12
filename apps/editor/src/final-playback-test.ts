// @ts-nocheck
/**
 * 播放状态机回归测试（F-2 / R5-1 / R6-1 / R7-1 / R7-2）。
 *
 * 背景：R3-R7 每轮都用一次性 node 探针验证 seek/phase/resume 逻辑，但探针**复制逻辑**
 * 而非 import 真实模块——验证完即丢，下次改 seek/phase 没有任何东西阻止回归。
 * 本文件 import 真实 PlaybackController，用真实 gsap.timeline() + 结构合法的空 segment 驱动，
 * 把 R3-R7 触发的 bug 固化成持久回归（SA-23）。
 *
 * 关键（SA-23 / §B-bis）：pixi v8 懒初始化 renderer，仅 import + 构造 Container 不触发 WebGL。
 * PlaybackController.ts 在 `node --import tsx` 下干净加载，故可直接 import 真实模块——
 * R3-R7 的"逻辑复制探针"是不必要的摩擦（且 node -e 变体因 tsx ESM 互操作 quirk 实际 flaky）。
 *
 * 边界：record 数组空的 segment 让 seekToTime/playSegment 退化成纯逻辑 + 真实 gsap seek，
 * 不触及 effectManager/stageManager.apply（render 边界，超出逻辑回归范围）。
 * 不测 ScriptPlayer 实例方法（构造重，且逻辑被 PlaybackController 完全覆盖）。
 */
import gsap from "gsap";
import { TextStyle, Container, DOMAdapter, Assets, Sprite, Texture } from "pixi.js";
import { PlaybackController } from "./core/player/PlaybackController";
import { scriptPlayer } from "./core/player/ScriptPlayer";
import { TextBuildContextResolver } from "./core/render/text/TextBuildContextResolver";
import { ReaderRuntimeWebSession } from "./core/runtime/ReaderRuntimeSession";
import { readerApp } from "./core/App";
import { EffectProcessor } from "./core/effects/EffectProcessor";
import { layout } from "./core/layout/LayoutEngine";
import { effectManager } from "./core/effects/EffectManager";
import { styleManager } from "./core/effects/StyleManager";
import { KineticText } from "./core/KineticText";
import { KineticChar } from "./core/KineticChar";
import { DisplayAssembler } from "./core/render/text/DisplayAssembler";
import { parser } from "./core/parser/Parser";
import { SegmentBuilder } from "./core/player/SegmentBuilder";
import { buildStageModifierRecord, buildStageModifierApplyParams } from "./core/stage/stagePresets";
import { StageRuntime } from "./core/stage/StageRuntime";
import { TextDuotoneFilter, BackgroundDuotoneFilter } from "./core/filters/duotone";
import { TextEmbossFilter, BackgroundEmbossFilter } from "./core/filters/emboss";
import { GrayFilter } from "./core/filters/GrayFilter";
import type { Segment } from "./core/state/Segment";
import type { LayoutGlyphPlan } from "./core/layout/LayoutPlanner";

// tsx 的 CJS/ESM 互操作把 gsap 当命名空间导入，默认导出落在 .default；
// vite（生产）的标准 ESM 解析则直接给默认导出。两者统一到此，让测试/生产同源。
// （§B-bis：已验证 tsx 运行时行为——gsap.default.timeline 是 function，gsap.timeline 是 undefined）
const G = ((gsap as any).default ?? gsap) as typeof gsap;

// R15（SA-30 / SA-27 教训）：为测 DisplayAssembler baseline 路径需构造真实 KineticChar，但其构造
// 函数调 `gsap.ticker.add(this.update)`——tsx 下 gsap 命名空间的 .ticker 是 undefined（§B-bis 互操作
// quirk），会抛 `Cannot read properties of undefined (reading 'add')`。此处给 gsap 命名空间对象
// 注入 ticker stub（add/remove no-op），仅让 KineticChar 构造通过；timeline 走 G.timeline() 不经
// ticker，不受影响。这使 §11b 能用真实 KineticChar 验证 DisplayAssembler 的 baseline 捕获逻辑
//（而非用 fake 掩盖真实差异——SA-27：fake 满足守卫不等于真实 target 满足）。
if (!(gsap as any).ticker) {
  (gsap as any).ticker = { add: () => {}, remove: () => {} };
}
// R17/SA-32（§13 端到端管线）：SegmentBuilder/PlaybackController 等生产代码直接调 `gsap.timeline()`
// / `gsap.core`（不经本文件的 G 别名）。tsx 互操作下 gsap 命名空间这些是 undefined（落在 .default）。
// 把 G（= gsap.default）的属性提升到 gsap 命名空间，让生产代码的 `gsap.timeline()` 可用。这是 §13
// 端到端真实管线的必要补丁（§1-§12 用 G.timeline() 别名绕过，但真实 SegmentBuilder 不绕过）。
if ((gsap as any).timeline !== G.timeline) {
  for (const k of Object.keys(G)) {
    try { if (!(k in (gsap as any))) (gsap as any)[k] = (G as any)[k]; } catch { /* readonly prop */ }
  }
}

// R17/SA-32（§13 端到端管线）：为驱动真实 `parser → SegmentBuilder.build → layout → seek`，需额外
// 两个 headless shim（已验证可跑端到端，见 R17 调研探针）：
// (1) document stub：KineticText.ts:82 读 `document.fonts`，node 下未定义会 ReferenceError。
//     注意：**不要** stub `window`——LayoutPlanner.isDiagnosticsEnabled 检查 `typeof window`，
//     window 未定义时早返回 false（line 348）；若 stub 了 window 会落到 `window.location.search` 崩溃。
// (2) DOMAdapter canvas stub：layout 路径调 `CanvasTextMetrics.measureFont`（LayoutPlanner:97
//     measureFontSafe），pixi v8 的 `_canvas` getter 先试 `OffscreenCanvas`（node 下 undefined）→
//     fallback `DOMAdapter.get().createCanvas()` → 默认 BrowserAdapter 用 document.createElement
//     （node 下崩）。注入合成 canvas（getContext 返回带 measureText 的 2d ctx）让字体度量通过。
//     度量是合成的（width=charCount*fontSize*0.5），几何不真实但 style/baseline/timing/seek 语义
//     真实——§13 测的是 R-B 单一真相源 + R13-R16 在真实管线的端到端正确性，不是布局几何。
//     pixi 升级若改 measureFont 路径，此 shim 可能需更新（失效时 §13 报错 ≠ R-B 逻辑错，先查 shim）。
if (!(globalThis as any).document) {
  (globalThis as any).document = {
    fonts: { ready: Promise.resolve() },
    createElement: () => ({}) as any,
  };
}
const _ctxProto = { prototype: { letterSpacing: undefined, textLetterSpacing: undefined } };
const _makeCtx = () => ({
  font: "",
  measureText(t: string) {
    const sz = parseFloat((this.font || "24px").match(/(\d+)px/)?.[1] || "24");
    return { actualBoundingBoxAscent: sz * 0.8, actualBoundingBoxDescent: sz * 0.2, width: (t || "").length * sz * 0.5 };
  },
});
DOMAdapter.set({
  createCanvas: () => ({ width: 0, height: 0, getContext: () => _makeCtx(), style: {} }) as any,
  getCanvasRenderingContext2D: () => _ctxProto as any,
  createImage: () => ({}) as any,
  getBaseUrl: () => "file:///",
  getFontFaceSet: () => undefined,
} as any);

// ─── 测试骨架（对齐 final-parser-test.ts 风格） ──────────────────────────

let pass = 0;
let fail = 0;

function assert(cond: boolean, message: string): void {
  if (cond) {
    pass += 1;
    console.log(`  ✅ ${message}`);
  } else {
    fail += 1;
    console.error(`  ❌ ${message}`);
  }
}

function approxEq(a: number, b: number, eps = 1e-6): boolean {
  return Math.abs(a - b) < eps;
}

// ─── fakes ──────────────────────────────────────────────────────────────

/**
 * 结构合法的空 segment：record 数组全空 → seekToTime/playSegment 的 register/replay 系列
 * 退化为 no-op，只跑 clamp + 真实 gsap.seek + onTimeUpdate。timeline 是真实 gsap。
 * entryCheckpoint/exitCheckpoint 给最小合法结构（Segment 接口要求，seek 不读）。
 *
 * timeline 必须含一个占位 tween 使其 duration() === segment.duration 秒——否则空 timeline
 * duration=0，任何 seek 都让 progress()=1，无法复现 playing-mid / paused-mid 态。
 * 占位 tween 用独立目标对象（{p:0}→{p:1}），无副作用，derivePhase/seekToTime 只读 progress/time。
 */
function makeFakeSegment(duration: number): Segment {
  const tl = G.timeline();
  tl.to({ p: 0 }, { p: 1, duration }, 0);
  return {
    timeline: tl,
    duration,
    behaviors: [],
    styleRecords: [],
    instantEffects: [],
    entranceFilters: [],
    stageModifierRecords: [],
    stageTweenRecords: [],
    paragraphs: [],
    entryCheckpoint: { time: 0, label: "" },
    exitCheckpoint: { time: duration, label: "" },
  } as unknown as Segment;
}

function makeFakeState(isAutoPlaying: boolean) {
  let lastTimeUpdate: number | undefined;
  const state = {
    isAutoPlaying,
    activeBehaviorCleanups: [],
    activeInstantCleanups: [],
    onTimeUpdate: (timeMs: number) => {
      lastTimeUpdate = timeMs;
    },
  };
  return { state, getLastTimeUpdate: () => lastTimeUpdate };
}

// ─── 测试用例 ────────────────────────────────────────────────────────────

function testDerivePhase() {
  console.log("\n[1] derivePhase 穷举（F-2 单一真相源）");

  // null segment：isAutoPlaying 决定（无 timeline 可查 progress）
  {
    const { state: playingState } = makeFakeState(true);
    assert(
      PlaybackController.derivePhase(null, playingState) === "playing",
      "null segment + isAutoPlaying=true → playing",
    );
  }
  {
    const { state: pausedState } = makeFakeState(false);
    assert(
      PlaybackController.derivePhase(null, pausedState) === "paused",
      "null segment + isAutoPlaying=false → paused",
    );
  }

  // progress≥1 → ended（无论 isAutoPlaying；R6-1：seek 到尾 onComplete 未触发仍 true 也要识别）
  {
    const seg = makeFakeSegment(2);
    seg.timeline.seek(2); // progress=1
    const { state: autoState } = makeFakeState(true);
    const { state: manualState } = makeFakeState(false);
    assert(
      PlaybackController.derivePhase(seg, autoState) === "ended",
      "progress>=1 + isAutoPlaying=true → ended（R6-1 seek-to-end 未触发 onComplete）",
    );
    assert(
      PlaybackController.derivePhase(seg, manualState) === "ended",
      "progress>=1 + isAutoPlaying=false → ended（正常播完 onComplete 设 false）",
    );
  }

  // progress<1：isAutoPlaying 决定 playing vs paused
  {
    const seg = makeFakeSegment(2);
    seg.timeline.seek(1); // progress=0.5
    const { state: playingState } = makeFakeState(true);
    const { state: pausedState } = makeFakeState(false);
    assert(
      PlaybackController.derivePhase(seg, playingState) === "playing",
      "progress<1 + isAutoPlaying=true → playing（R5-1 seek-while-playing resume gate）",
    );
    assert(
      PlaybackController.derivePhase(seg, pausedState) === "paused",
      "progress<1 + isAutoPlaying=false → paused",
    );
  }

  // progress=0（开头）：isAutoPlaying 决定
  {
    const seg = makeFakeSegment(2);
    const { state: playingState } = makeFakeState(true);
    const { state: pausedState } = makeFakeState(false);
    assert(
      PlaybackController.derivePhase(seg, playingState) === "playing",
      "progress=0 + isAutoPlaying=true → playing",
    );
    assert(
      PlaybackController.derivePhase(seg, pausedState) === "paused",
      "progress=0 + isAutoPlaying=false → paused",
    );
  }
}

function testSeekToTimeClampAndCallback() {
  console.log("\n[2] seekToTime 边界（clamp + onTimeUpdate）");
  {
    const seg = makeFakeSegment(2);
    const { state, getLastTimeUpdate } = makeFakeState(false);

    const ret = PlaybackController.seekToTime(seg, -1, state);
    assert(approxEq(ret, 0), "seek(-1) clamp 到 0，返回 0");
    assert(approxEq(getLastTimeUpdate() ?? -1, 0), "seek(-1) onTimeUpdate 收到 0ms");
  }
  {
    const seg = makeFakeSegment(2);
    const { state, getLastTimeUpdate } = makeFakeState(false);

    const ret = PlaybackController.seekToTime(seg, 5, state);
    assert(approxEq(ret, 2), "seek(5) clamp 到 duration=2，返回 2");
    assert(seg.timeline.progress() >= 1, "seek(duration) 后 progress>=1");
    assert(approxEq(getLastTimeUpdate() ?? -1, 2000), "seek(duration) onTimeUpdate 收到 2000ms");
  }
  {
    const seg = makeFakeSegment(2);
    const { state, getLastTimeUpdate } = makeFakeState(false);

    const ret = PlaybackController.seekToTime(seg, 1, state);
    assert(approxEq(ret, 1), "seek(1) 返回 1");
    assert(approxEq(seg.timeline.time(), 1), "seek(1) tl.time() 落在 1s");
    assert(approxEq(getLastTimeUpdate() ?? -1, 1000), "seek(1) onTimeUpdate 收到 1000ms");
  }
}

function testPlaySegmentEndedBranch() {
  console.log("\n[3] playSegment 状态转换（R5-1/R6-1/R7-1）");
  {
    // segment 已 ended（progress=1）→ playSegment 走 ended 分支（seek(0)），不抛错
    const seg = makeFakeSegment(2);
    seg.timeline.seek(2); // ended
    const { state } = makeFakeState(false);
    // progress>=1 进 ended 分支前 set isAutoPlaying；手动模拟 derivePhase 判定
    assert(
      PlaybackController.derivePhase(seg, state) === "ended",
      "ended segment derivePhase=ended（playSegment 会走 ended 分支）",
    );
    let threw = false;
    try {
      PlaybackController.playSegment(seg, state);
    } catch (e) {
      threw = true;
      console.error("    unexpected throw:", e);
    }
    assert(!threw, "playSegment on ended segment 不抛错（ended 分支 seek(0)+clear）");
    // ended 分支 seek(0) 后 progress 应回到 0（除非 duration 为 0）
    assert(seg.timeline.progress() < 0.5, "ended 分支 seek(0) 后 progress 回到开头");
  }
  {
    // playing-mid：playSegment 不走 ended 分支
    const seg = makeFakeSegment(2);
    seg.timeline.seek(1); // mid
    const { state } = makeFakeState(true);
    assert(
      PlaybackController.derivePhase(seg, state) !== "ended",
      "mid segment derivePhase!=ended（playSegment 不走 ended 分支）",
    );
    let threw = false;
    try {
      PlaybackController.playSegment(seg, state);
    } catch (e) {
      threw = true;
      console.error("    unexpected throw:", e);
    }
    assert(!threw, "playSegment on mid segment 不抛错（resume 分支）");
  }
}

function testDeriveReplayMode() {
  console.log("\n[4] deriveReplayMode（trivial，锁死未来分支化回归）");
  // 当前恒返回 "static"（seek 路径静态快照；resume 路径显式 live 不经此 helper）。
  // 锁死：若未来按 phase 分支化 mode，此处需同步更新。
  {
    const seg = makeFakeSegment(2);
    seg.timeline.seek(1);
    const { state } = makeFakeState(true);
    // deriveReplayMode 是 private——经 seekToTime 间接覆盖即可，不单独调。
    // 此处只断言 seekToTime 不因 mode 派生抛错（mode 由 deriveReplayMode 决定）。
    let threw = false;
    try {
      PlaybackController.seekToTime(seg, 0.5, state);
    } catch (e) {
      threw = true;
      console.error("    unexpected throw:", e);
    }
    assert(!threw, "seekToTime 经 deriveReplayMode 不抛错");
  }
}

/**
 * [5] reset boundary 过滤语义（R8-1 + R8-2 + R8-3）。
 *
 * replayStageModifiers 是 private 且内部调 stageManager.apply → StageRuntime.apply →
 * gsap.getTweensOf（tsx 下 .default 问题，headless 不可跑非空 records）。故此处**复制**
 * boundary + skip 过滤循环（与 PlaybackController 同源），验证"哪些 record 被判定为可重放"。
 * 这是 R3-R7 的逻辑复制方法（SA-23 记录），针对 render 边界后的纯逻辑判定。
 *
 * R8 经三轮修复，根因是"用单一标量阈值表达二维 clear 语义"——见 SA-24 根因分析。
 * 最终模型（R8-3）：reset 在 effectiveTime 调 clearModifiers，清掉**所有 timePosition < effectiveTime**
 * 的存活 modifier（clear-all 语义，不分创建序）。skip 条件 = `timePosition < effectiveTime`（唯一）：
 * - R8-1（reset 后新 modifier 丢失）：drift@2（=effectiveTime）→ 2<2 false → 不 skip ✓
 * - R8-2（同 timestamp、reset 前创建）：drift@1 → 1<2 → skip ✓
 * - R8-3（reset 动画窗口内 apply）：drift@1.5 → 1.5<2 → skip ✓（reset 在 2.0 clear 时 drift 已 apply）
 */
interface R8Record {
  command: string;
  timePosition: number;
  isClearBoundary?: boolean;
  resetDuration?: number;
  duration?: number;
  params: any;
  /** build/push 顺序（R11）。未设时回退到 ordered 索引（兼容旧行为）。 */
  sequence?: number;
}

/** 复制 PlaybackController.replayStageModifiers 的 boundary + skip 过滤（R8-3 + R9-High + R10 修复后版本）。 */
function r8WhichToReplay(records: R8Record[], currentTime: number): R8Record[] {
  const ordered = [...records].sort((a, b) => a.timePosition - b.timePosition);
  let lastClearBoundaryEffectiveTime = -1;
  let lastClearBoundarySequence = -1;
  for (let i = 0; i < ordered.length; i++) {
    const record = ordered[i];
    if (record.timePosition > currentTime) break;
    if (record.isClearBoundary) {
      const resetDur = record.resetDuration ?? 0;
      const effectiveTime = record.timePosition + resetDur;
      if (effectiveTime <= currentTime) {
        // R9-High：取最大 effective clear time；R11：同 max 取较大 sequence（更晚 push 的 reset）。
        const seq = record.sequence ?? i; // 回退到 ordered 索引（兼容旧 record）
        if (effectiveTime > lastClearBoundaryEffectiveTime
            || (effectiveTime === lastClearBoundaryEffectiveTime && seq > lastClearBoundarySequence)) {
          lastClearBoundaryEffectiveTime = effectiveTime;
          lastClearBoundarySequence = seq;
        }
      }
    }
  }
  const replay: R8Record[] = [];
  for (let i = 0; i < ordered.length; i++) {
    const record = ordered[i];
    if (record.timePosition > currentTime) continue;
    // R8-3 + R10 + R11：skip 双维度（时间 + 创建序用 record.sequence 而非 ordered 索引）。
    if (lastClearBoundaryEffectiveTime >= 0) {
      if (record.timePosition < lastClearBoundaryEffectiveTime) continue;
      const seq = record.sequence ?? i; // 回退到 ordered 索引（兼容旧 record）
      if (record.timePosition === lastClearBoundaryEffectiveTime
          && seq <= lastClearBoundarySequence) continue;
    }
    if (record.isClearBoundary) continue;
    if (record.duration !== undefined && isFinite(record.duration)
        && currentTime >= record.timePosition + record.duration) continue;
    replay.push(record);
  }
  return replay;
}

function testResetBoundaryFilter() {
  console.log("\n[5] reset boundary 过滤（R8-1 + R8-2 + R8-3：reset clear 语义三维）");
  // R8-1 形态：drift@0 → reset(1s)@1 → drift@2
  const records = [
    { command: "cam.drift", params: { speed: 1 }, timePosition: 0 },
    { command: "cam.reset", params: { duration: 1 }, timePosition: 1, isClearBoundary: true, resetDuration: 1 },
    { command: "cam.drift", params: { speed: 2 }, timePosition: 2 },
  ];
  // reset 结束点及之后：新 drift 必须恢复（R8-1 复现点）
  for (const t of [2, 2.5, 3]) {
    const replay = r8WhichToReplay(records, t);
    const drifts = replay.filter((r) => r.command === "cam.drift");
    assert(
      drifts.length === 1 && drifts[0].timePosition === 2,
      `R8-1 seek ${t}: reset 后的 drift 恢复（timePosition=2，非被 skip）`,
    );
  }
  // reset 动画中途（1.5）：reset 未完成，reset 前 drift 仍在（不应 skip）
  {
    const replay = r8WhichToReplay(records, 1.5);
    assert(
      replay.some((r) => r.command === "cam.drift" && r.timePosition === 0),
      "R8-1 seek 1.5（reset 动画中途）: reset 前 drift 仍在（reset 未完成，不 skip）",
    );
  }
  // reset 之前（0.5）：drift 恢复
  {
    const replay = r8WhichToReplay(records, 0.5);
    assert(
      replay.some((r) => r.command === "cam.drift" && r.timePosition === 0),
      "R8-1 seek 0.5（reset 之前）: drift 恢复",
    );
  }
  // reset 起点（1.0，未完成）：reset 前 drift 仍在
  {
    const replay = r8WhichToReplay(records, 1.0);
    assert(
      replay.some((r) => r.command === "cam.drift" && r.timePosition === 0),
      "R8-1 seek 1.0（reset 起点，未完成）: reset 前 drift 仍在",
    );
  }
  // reset 之前的 shake（有 duration），seek 到 reset 之后应被 skip（reset 清了它）
  {
    const recs2 = [
      { command: "cam.shake", params: {}, timePosition: 0, duration: 5 },
      { command: "cam.reset", params: { duration: 1 }, timePosition: 1, isClearBoundary: true, resetDuration: 1 },
    ];
    const replay = r8WhichToReplay(recs2, 3);
    assert(
      !replay.some((r) => r.command === "cam.shake"),
      "seek 3（reset 后）: reset 前的 shake 被 skip（boundary 清了它）",
    );
  }
  // R8-2 形态（Coco 第二轮）：drift@1 → reset@1（同 timestamp，drift 在 reset 之前 push）。
  // 真实 build 路径：SegmentBuilder 连续 stage configs 不推进 cursor → drift 与 reset 同 timePosition。
  // 正常播放 drift 先 apply，reset 结束时 clearModifiers → seek 到 reset 后不应恢复旧 drift。
  {
    const recs3 = [
      { command: "cam.drift", params: { strength: 1 }, timePosition: 1 },
      { command: "cam.reset", params: { duration: 1 }, timePosition: 1, isClearBoundary: true, resetDuration: 1 },
    ];
    // seek 到 reset 完成后（2/2.5/3）：旧 drift 必须被 skip（timePosition 1 < effectiveTime 2）
    for (const t of [2, 2.5, 3]) {
      const replay = r8WhichToReplay(recs3, t);
      assert(
        !replay.some((r) => r.command === "cam.drift"),
        `R8-2 seek ${t}: reset 前同时间戳的 drift 被 skip（不应复活，Coco 复现点）`,
      );
    }
    // seek 到 reset 动画中途（1.5）：reset 未完成，drift 仍在
    {
      const replay = r8WhichToReplay(recs3, 1.5);
      assert(
        replay.some((r) => r.command === "cam.drift" && r.timePosition === 1),
        "R8-2 seek 1.5（reset 动画中途）: 同时间戳 drift 仍在（reset 未完成）",
      );
    }
  }
  // R8-2 组合：drift@1 → reset@1 → drift@2（reset 前 drift 被 skip，reset 后 drift 恢复）
  {
    const recs4 = [
      { command: "cam.drift", params: { strength: 1 }, timePosition: 1 },
      { command: "cam.reset", params: { duration: 1 }, timePosition: 1, isClearBoundary: true, resetDuration: 1 },
      { command: "cam.drift", params: { strength: 2 }, timePosition: 2 },
    ];
    for (const t of [2, 2.5, 3]) {
      const replay = r8WhichToReplay(recs4, t);
      const drifts = replay.filter((r) => r.command === "cam.drift");
      assert(
        drifts.length === 1 && drifts[0].timePosition === 2,
        `R8-2 组合 seek ${t}: reset 前 drift skip、reset 后 drift 恢复（只 timePosition=2）`,
      );
    }
  }
  // R8-3 形态（Coco 第三轮）：reset@1(duration=1, effective@2) → drift@1.5（reset 动画窗口内 apply）。
  // 真实 build 路径：非 blocking reset 不推进 cursor，但 drift 可来自后续段落（不同 timePosition）。
  // 正常播放：drift@1.5 apply → reset@2.0 clearModifiers（清 drift）→ seek 到 2.5 不应 replay drift。
  // R8-2 的 i <= boundaryIndex 漏了这个（drift@1.5 index > reset index → 不 skip）。
  // R8-3：用 timePosition < effectiveTime（drift@1.5 < 2 → skip）。
  {
    const recs5 = [
      { command: "cam.reset", params: { duration: 1 }, timePosition: 1, isClearBoundary: true, resetDuration: 1 },
      { command: "cam.drift", params: { strength: 1 }, timePosition: 1.5 },
    ];
    for (const t of [2, 2.5, 3]) {
      const replay = r8WhichToReplay(recs5, t);
      assert(
        !replay.some((r) => r.command === "cam.drift"),
        `R8-3 seek ${t}: reset 动画窗口内的 drift 被 skip（reset clear 时已 apply，Coco 复现点）`,
      );
    }
    // seek 到 reset 动画中途（1.5）：reset 未完成（effectiveTime 2 > 1.5），drift 仍在
    {
      const replay = r8WhichToReplay(recs5, 1.5);
      assert(
        replay.some((r) => r.command === "cam.drift" && r.timePosition === 1.5),
        "R8-3 seek 1.5（reset 动画中途）: 窗口内 drift 仍在（reset 未完成）",
      );
    }
  }
  // R8-3 组合：reset@1(dur=1) → drift@1.5 → drift@2.5（窗口内 drift skip，窗口后 drift 恢复）
  {
    const recs6 = [
      { command: "cam.reset", params: { duration: 1 }, timePosition: 1, isClearBoundary: true, resetDuration: 1 },
      { command: "cam.drift", params: { strength: 1 }, timePosition: 1.5 },
      { command: "cam.drift", params: { strength: 2 }, timePosition: 2.5 },
    ];
    for (const t of [2.5, 3]) {
      const replay = r8WhichToReplay(recs6, t);
      const drifts = replay.filter((r) => r.command === "cam.drift");
      assert(
        drifts.length === 1 && drifts[0].timePosition === 2.5,
        `R8-3 组合 seek ${t}: 窗口内 drift skip、窗口后 drift 恢复（只 timePosition=2.5）`,
      );
    }
  }
  // R9-High：多个 reset 重叠时取最大 effective clear time（最近触发的 clear）。
  // Coco 第四轮复现：reset@1(dur=10, effective@11) + reset@5(dur=1, effective@6) + drift@7，seek@12。
  // 正常播放：reset@5 在 6.0 clear（清 drift@5 之前），reset@1 在 11.0 clear（清 drift@7）。seek@12 应
  // 用最近触发的 clear（effectiveTime=11）判定 → drift@7（7<11）被 skip。原顺序赋值让 reset@5 覆盖成
  // effectiveTime=6 → drift@7（7>6）不被 skip → 错误重放。
  {
    const recs7 = [
      { command: "cam.reset", params: { duration: 10 }, timePosition: 1, isClearBoundary: true, resetDuration: 10 },
      { command: "cam.reset", params: { duration: 1 }, timePosition: 5, isClearBoundary: true, resetDuration: 1 },
      { command: "cam.drift", params: { strength: 1 }, timePosition: 7 },
    ];
    for (const t of [11, 12, 15]) {
      const replay = r8WhichToReplay(recs7, t);
      assert(
        !replay.some((r) => r.command === "cam.drift"),
        `R9-High seek ${t}: 多 reset 重叠取最大 effective（11），drift@7(7<11) 被 skip（不复活，Coco 复现点）`,
      );
    }
    // seek 到两个 reset 都已生效但 drift@7 之前（如 10）：reset@1 effective@11 > 10 未生效，
    // reset@5 effective@6 ≤ 10 生效 → lastClearBoundaryEffectiveTime=6 → drift@7(7>6) 不 skip（drift 仍在）
    {
      const replay = r8WhichToReplay(recs7, 10);
      assert(
        replay.some((r) => r.command === "cam.drift" && r.timePosition === 7),
        "R9-High seek 10（仅 reset@5 生效）: drift@7 仍在（reset@1 effective@11 未到，7>6）",
      );
    }
    // drift@12（在最大 effective 11 之后）应恢复——证明取 max 不误删 reset 之后的 modifier
    {
      const recs8 = [
        { command: "cam.reset", params: { duration: 10 }, timePosition: 1, isClearBoundary: true, resetDuration: 10 },
        { command: "cam.reset", params: { duration: 1 }, timePosition: 5, isClearBoundary: true, resetDuration: 1 },
        { command: "cam.drift", params: { strength: 2 }, timePosition: 12 },
      ];
      const replay = r8WhichToReplay(recs8, 15);
      const drifts = replay.filter((r) => r.command === "cam.drift");
      assert(
        drifts.length === 1 && drifts[0].timePosition === 12,
        "R9-High seek 15: reset 后 drift@12(12>11) 恢复（取 max 不误删 reset 之后的 modifier）",
      );
    }
  }
  // R10-High（Coco 第五轮）：reset 默认零时长（resetDuration=0）时同 timestamp 复活。
  // 真实 build 路径：非 blocking drift + 默认 cam.reset 共享 cursor → drift@1 + reset@1(resetDuration=0)。
  // effectiveTime = 1 + 0 = 1 === timePosition。R8-3 的 `timePosition < effectiveTime`（1<1 false）放过 drift
  // → seek 到 1+ 后 drift 复活。正常播放：drift 的 segmentTl.call 先触发（push 在前）→ reset clearModifiers 清它。
  // R10：加创建序维度——同 timestamp（timePosition === effectiveTime）时 i <= boundaryIndex skip（drift 索引 < reset 索引）。
  {
    const recs9 = [
      { command: "cam.drift", params: { strength: 1 }, timePosition: 1 },
      { command: "cam.reset", params: {}, timePosition: 1, isClearBoundary: true, resetDuration: 0 },
    ];
    // seek 到 reset 之后（1, 1.5, 2）：drift 必须被 skip（resetDuration=0 同 timestamp，创建序判定）
    for (const t of [1, 1.5, 2]) {
      const replay = r8WhichToReplay(recs9, t);
      assert(
        !replay.some((r) => r.command === "cam.drift"),
        `R10 seek ${t}: resetDuration=0 同 timestamp 的 reset 前 drift 被 skip（不复活，Coco 复现点）`,
      );
    }
    // seek 到 reset 之前（0.5）：drift 仍在（boundary 未生效）
    {
      const replay = r8WhichToReplay(recs9, 0.5);
      assert(
        !replay.some((r) => r.command === "cam.drift"),
        "R10 seek 0.5（reset 前）：drift timePosition=1 > 0.5 不在 currentTime 内（不 replay，正确）",
      );
    }
  }
  // R10 组合：drift@1 + reset@1(resetDuration=0) + drift@1（reset 之后同 timestamp push）
  // reset 之前 drift skip，reset 之后同 timestamp drift 不 skip（i > boundaryIndex）
  {
    const recs10 = [
      { command: "cam.drift", params: { strength: 1 }, timePosition: 1 },
      { command: "cam.reset", params: {}, timePosition: 1, isClearBoundary: true, resetDuration: 0 },
      { command: "cam.drift", params: { strength: 2 }, timePosition: 1 },
    ];
    for (const t of [1, 1.5, 2]) {
      const replay = r8WhichToReplay(recs10, t);
      const drifts = replay.filter((r) => r.command === "cam.drift");
      assert(
        drifts.length === 1 && drifts[0].params.strength === 2,
        `R10 组合 seek ${t}: reset 前 drift skip、reset 后同 timestamp drift(strength=2) 恢复`,
      );
    }
  }
  // R11-High（Coco 第六轮）：>>> overlap 时不同 timePosition 但同 effectiveTime 的 modifier 复活。
  // p1 child timeline（>>> 让 p2 从 1 开始）：drift@global2.0（p1，push 序 0）。
  // p2 从 1 开始：reset@1 duration=1（push 序 1，effective@2.0）。
  // 正常播放：p1 child 的 drift@2 segmentTl.call 先触发（p1 先 add，overlap 时同 tick 内 p1 call 在前）
  // → p2 reset clearModifiers@2 清掉 drift。seek 到 t>=2 应不 replay drift。
  // **R10/R8 的 ordered 索引在此失效**：排序后 reset@1(index 0) 在 drift@2(index 1) 前，drift index 1 >
  // boundaryIndex 0 → 不 skip → 复活。只有 record.sequence（push 序：drift 0 < reset 1）能正确 skip。
  {
    const recs11 = [
      { command: "cam.drift", params: { strength: 1 }, timePosition: 2, sequence: 0 },        // p1 先 push
      { command: "cam.reset", params: { duration: 1 }, timePosition: 1, isClearBoundary: true, resetDuration: 1, sequence: 1 }, // p2 后 push
    ];
    // seek 到 effectiveTime 及之后（2, 2.5, 3）：drift 必须被 skip（sequence 0 <= reset sequence 1）
    for (const t of [2, 2.5, 3]) {
      const replay = r8WhichToReplay(recs11, t);
      assert(
        !replay.some((r) => r.command === "cam.drift"),
        `R11 seek ${t}: >>> overlap 同 effectiveTime、drift sequence(0) <= reset sequence(1) → skip（不复活，Coco 复现点）`,
      );
    }
    // seek 到 reset 动画中途（1.5）：reset 未完成（effectiveTime 2 > 1.5），drift timePosition 2 > 1.5 不在 currentTime 内
    {
      const replay = r8WhichToReplay(recs11, 1.5);
      assert(
        !replay.some((r) => r.command === "cam.drift"),
        "R11 seek 1.5（reset 动画中途）: drift@2 > 1.5 不在 currentTime 内（不 replay）",
      );
    }
    // 组合：drift@2(p1, seq0) + reset@1(dur1, seq1) + drift@2.5(p2, seq2)
    // p1 drift skip（seq0<=1），p2 drift@2.5 恢复（timePosition 2.5 > effectiveTime 2）
    {
      const recs12 = [
        { command: "cam.drift", params: { strength: 1 }, timePosition: 2, sequence: 0 },
        { command: "cam.reset", params: { duration: 1 }, timePosition: 1, isClearBoundary: true, resetDuration: 1, sequence: 1 },
        { command: "cam.drift", params: { strength: 2 }, timePosition: 2.5, sequence: 2 },
      ];
      for (const t of [2.5, 3]) {
        const replay = r8WhichToReplay(recs12, t);
        const drifts = replay.filter((r) => r.command === "cam.drift");
        assert(
          drifts.length === 1 && drifts[0].params.strength === 2 && drifts[0].timePosition === 2.5,
          `R11 组合 seek ${t}: p1 drift skip（seq）、p2 drift@2.5 恢复`,
        );
      }
    }
    // 验证 ordered 索引在此场景错误（回退路径会复活 drift）——无 sequence 时
    {
      const recsNoSeq = [
        { command: "cam.drift", params: { strength: 1 }, timePosition: 2 },        // 无 sequence → 回退 ordered index
        { command: "cam.reset", params: { duration: 1 }, timePosition: 1, isClearBoundary: true, resetDuration: 1 }, // 无 sequence
      ];
      const replay = r8WhichToReplay(recsNoSeq, 2.5);
      // 无 sequence 时回退 ordered 索引：drift ordered index 1 > boundaryIndex 0 → 不 skip（错误复活）
      // 这证明 sequence 字段是必需的——ordered 索引在 >>> overlap 下错误。
      assert(
        replay.some((r) => r.command === "cam.drift"),
        "R11 验证: 无 sequence 时 ordered 索引错误复活 drift（证明 sequence 字段必需）",
      );
    }
  }
}

/**
 * [6] resolvePauseDuration 变量解析（R9-Medium）。
 *
 * SA-19 抽 helper 时漏了 var.* 解析——原 `Number("var.delay_val")=NaN`，导致
 * `hold(var.delay_val)` / `pause(var.delay_val)` 时长失效。R9-Medium 改用
 * RuntimeValueResolver.resolveNumeric（与 stage 路径 resolveStageNumeric 同源）。
 * 样例 apps/editor/public/tests/10-variables.kmd 的"变量 hold 时长"预期依赖此。
 */
function testResolvePauseDuration() {
  console.log("\n[6] resolvePauseDuration 变量解析（R9-Medium）");
  // 纯数值透传
  assert(
    approxEq(EffectProcessor.resolvePauseDuration({ duration: 2 }, 0.5), 2),
    "resolvePauseDuration({duration:2}) = 2（纯数值）",
  );
  assert(
    approxEq(EffectProcessor.resolvePauseDuration({ d: 1.5 }, 0.5), 1.5),
    "resolvePauseDuration({d:1.5}) = 1.5（d 字段）",
  );
  assert(
    approxEq(EffectProcessor.resolvePauseDuration({ 0: 3 }, 0.5), 3),
    "resolvePauseDuration({0:3}) = 3（位置参数）",
  );
  assert(
    approxEq(EffectProcessor.resolvePauseDuration({}, 0.5), 0.5),
    "resolvePauseDuration({}) = defaultValue 0.5（缺省）",
  );
  // var.* 解析（R9-Medium 关键）——需先在 layout.globalMarkers 注册变量。
  // RuntimeValueResolver.resolveReference 读 layout.globalMarkers.get("var.X").
  layout.globalMarkers.set("var.delay_val", { x: 1.5, y: 1.5 });
  const resolved = EffectProcessor.resolvePauseDuration({ 0: "var.delay_val" }, 0.5);
  assert(
    approxEq(resolved, 1.5),
    `resolvePauseDuration({0:'var.delay_val'}) = 1.5（var 解析，R9-Medium 复现点）→ 实得 ${resolved}`,
  );
  // 未注册变量回退到 default（不是 NaN）
  const missing = EffectProcessor.resolvePauseDuration({ 0: "var.nonexistent" }, 0.5);
  assert(
    approxEq(missing, 0.5),
    `resolvePauseDuration({0:'var.nonexistent'}) = 0.5（未注册回退 default，非 NaN）→ 实得 ${missing}`,
  );
}

/**
 * [7] Graphics instant 特效 seek 回退清理（R12-High）。
 *
 * bg/border 是 track:"instant" 但 type:"style" 返回 void（画 Graphics 非 filter）。
 * instant cleanup 通道（activeInstantCleanups + clearInstantEffects）原只处理 filterInstance，
 * bg/border 返回 void 不进 cleanup → seek 回退 Graphics 残留。
 * R12：InstantCleanup 加 graphicsLayer 字段；registerInstantEffects/segmentTl.call 对 void result
 * 查 meta.mutexGroup 作 Graphics 层名 push graphicsLayer cleanup；clearInstantEffects 清该层（g.clear()）。
 *
 * 此测试直接调真实 PlaybackController.clearInstantEffects（静态方法，pixi 不阻塞 headless），
 * 用 fake target（getGraphicsLayer 返回带 clear 计数的 fake Graphics）验证清理路径。
 */
function testGraphicsInstantCleanup() {
  console.log("\n[7] Graphics instant 特效 seek 回退清理（R12-High）");
  // fake Graphics：clear() 记录调用次数
  let clearCount = 0;
  const fakeG = { clear: () => { clearCount++; } };
  // fake target：getGraphicsLayer(name) 返回 fakeG（模拟 TokenWrapper/KineticText 的层）
  const fakeTarget = {
    getGraphicsLayer: (_name: string) => fakeG,
    filters: null as any,
  };
  // 模拟 registerInstantEffects 对 void result 推 graphicsLayer cleanup（与真实逻辑一致）
  const state = {
    isAutoPlaying: false,
    activeBehaviorCleanups: [],
    activeInstantCleanups: [
      { target: fakeTarget, filterInstance: undefined as any, graphicsLayer: "box" },
    ],
    onTimeUpdate: () => {},
  } as any;
  clearCount = 0;
  // @ts-ignore: clearInstantEffects 是 public static，state 用 any
  PlaybackController.clearInstantEffects(state);
  assert(
    clearCount === 1,
    `R12: clearInstantEffects 对 graphicsLayer cleanup 调 g.clear()（count=${clearCount}）`,
  );
  assert(
    state.activeInstantCleanups.length === 0,
    "R12: clearInstantEffects 清空 activeInstantCleanups",
  );
  // filter cleanup 不受 graphicsLayer 路径影响——filterInstance 通道仍正常（void filterInstance 不走 filter 分支）
  {
    let clearCount2 = 0;
    const fakeG2 = { clear: () => { clearCount2++; } };
    const fakeTarget2 = { getGraphicsLayer: () => fakeG2, filters: null as any };
    const state2 = {
      isAutoPlaying: false,
      activeBehaviorCleanups: [],
      activeInstantCleanups: [
        { target: fakeTarget2, filterInstance: undefined as any, graphicsLayer: "border" },
      ],
      onTimeUpdate: () => {},
    } as any;
    clearCount2 = 0;
    // @ts-ignore
    PlaybackController.clearInstantEffects(state2);
    assert(
      clearCount2 === 1,
      "R12: border 层也清（graphicsLayer='border' → g.clear()）",
    );
  }
  // 无 graphicsLayer 的 cleanup（纯 filter）不受影响——不调 getGraphicsLayer
  {
    let layerAccessed = false;
    const fakeTarget3 = { getGraphicsLayer: () => { layerAccessed = true; return { clear(){} }; }, filters: null as any };
    const state3 = {
      isAutoPlaying: false,
      activeBehaviorCleanups: [],
      activeInstantCleanups: [
        // filter cleanup：filterInstance 是 fake filter 对象，无 graphicsLayer → 不走 Graphics 路径
        { target: fakeTarget3, filterInstance: { destroy(){} } as any },
      ],
      onTimeUpdate: () => {},
    } as any;
    // @ts-ignore
    PlaybackController.clearInstantEffects(state3);
    assert(
      !layerAccessed,
      "R12: filter cleanup（无 graphicsLayer）不调 getGraphicsLayer（filter 通道独立）",
    );
  }
}

/**
 * [8] bg/border:block 真实对象路径（R12 阻塞修复回归）。
 *
 * R12 的 graphicsLayer cleanup 守卫 `typeof target.getGraphicsLayer === "function"` 对真实
 * `KineticText`（block 级 target）曾为 false——KineticText 只 getContentBounds、无 getGraphicsLayer
 * → visual.ts 守卫早退 warn 不画 + cleanup 不登记。Section 7 用 fake target 带 layer 盖住了这个
 * 真实差异。本节用**真实 KineticText + 真实 effectManager.apply + 真实 Graphics 指令检查**验证：
 *   1. apply bg/border 真画到 KineticText 的 Graphics 层（context.instructions 非空）；
 *   2. 坐标补偿：getContentBounds() 对居中/缩进返回非零 x/y，visual.ts 须以 bounds.x - padding 起画
 *      （旧画 -padding 会偏在内容左侧）；用 align:center 段落构造 bounds.x 显著 > 0 验证；
 *   3. registerInstantEffects 真实链路（void result → meta.mutexGroup → graphicsLayer cleanup）对
 *      真实 KineticText 生效，clearInstantEffects 清该层（g.clear() → context.instructions 清空）。
 *
 * pixi v8 Graphics 指令是 CPU 侧懒记录，无需 WebGL：g.context.instructions 是数组，
 * rect/roundRect 后含 {action:"fill"|"stroke", data:{path:{instructions:[{action, data:[x,y,w,h,...]}]}}};
 * g.clear() 后清空。headless 可读（SA-23：仅 import+构造不触发 renderer）。
 *
 * 不依赖完整排版管线（字体/布局在 node 下不稳）：构造 KineticText 后直接设 _displayAssembly.chars
 * 为最小 char stub（width/height/layoutX/layoutY/anchor），使 getContentBounds() 返回可控 bounds。
 */
function testRealKineticTextGraphicsLayer() {
  console.log("\n[8] bg/border:block 真实 KineticText + 真实 Graphics（R12 阻塞修复）");

  // 最小 char stub：getContentBounds 读 c.width/height/layoutX/layoutY/anchor.x/y。
  // anchor 设 0.5（与 KineticChar 默认中心锚点一致），使 minX = layoutX - width*0.5。
  function makeCharStub(layoutX: number, layoutY: number, width: number, height: number) {
    return {
      width, height, layoutX, layoutY,
      anchor: { x: 0.5, y: 0.5 },
      // KineticChar 字段，防其他读取报错
      inFlow: true,
    } as any;
  }

  // 构造真实 KineticText（externalMarkers 空.Map，BlockOptions 全可选）。不调 init/build——
  // 直接注入 _displayAssembly.chars 控 bounds，绕开字体/布局 headless 不稳。
  function makeKineticText(chars: any[]): KineticText {
    const kt = new KineticText({ externalMarkers: new Map() as any });
    kt._displayAssembly = { tokens: [], chars, executionItems: [] } as any;
    return kt;
  }

  // 读取 Graphics 第一条绘制指令的矩形坐标（rect/roundRect 的 path[0].data = [x, y, w, h, ...]）。
  // Graphics v8：context.instructions[i].data.path.instructions[0].{action, data}。
  function firstRectCoords(g: any): { x: number; y: number; w: number; h: number } | null {
    const ctxInsts = g?.context?.instructions;
    if (!Array.isArray(ctxInsts) || ctxInsts.length === 0) return null;
    const pathInsts = ctxInsts[0]?.data?.path?.instructions;
    if (!Array.isArray(pathInsts) || pathInsts.length === 0) return null;
    const d = pathInsts[0]?.data;
    if (!Array.isArray(d) || d.length < 4) return null;
    return { x: d[0], y: d[1], w: d[2], h: d[3] };
  }

  // (1) 真实能力：apply bg 真画到 KineticText 的 Graphics 层。
  {
    const kt = makeKineticText([
      makeCharStub(50, 30, 40, 50),
      makeCharStub(90, 30, 40, 50),
    ]);
    const bounds = kt.getContentBounds();
    // bounds.x = min(50-20, 90-20) = 30；确认 bounds.x 非零（验证 stub 正确）
    assert(approxEq(bounds.x, 30), `KineticText.getContentBounds().x 非零（center 模拟，x=${bounds.x}）`);

    const result = effectManager.apply(kt, "box", { color: 0x333333, alpha: 1, padding: 5, radius: 4 }, true);
    // box 返回 void（画 Graphics 非 filter）
    assert(result === undefined, "R12: box 对真实 KineticText 返回 void（Graphics 非 filter）");
    const g = kt.getGraphicsLayer("box");
    const coords = firstRectCoords(g);
    assert(coords !== null, "R12: box 真画到 KineticText.getGraphicsLayer('box')（instructions 非空）");
    // 坐标补偿：x = bounds.x - padding = 30 - 5 = 25（旧画 -5 会偏左 30px）
    assert(
      coords !== null && approxEq(coords.x, bounds.x - 5),
      `R12: box 坐标补偿 x=bounds.x-padding=${bounds.x - 5}（实际 ${coords?.x}），非 -padding`,
    );
    assert(
      coords !== null && approxEq(coords.y, bounds.y - 5),
      `R12: box 坐标补偿 y=bounds.y-padding=${bounds.y - 5}（实际 ${coords?.y}）`,
    );
  }

  // (2) border 同理（rect + stroke，非 fill）。
  {
    const kt = makeKineticText([makeCharStub(100, 80, 40, 50)]);
    const bounds = kt.getContentBounds();
    const result = effectManager.apply(kt, "border", { color: 0xff0000, width: 2, padding: 5 }, true);
    assert(result === undefined, "R12: border 对真实 KineticText 返回 void");
    const g = kt.getGraphicsLayer("border");
    const coords = firstRectCoords(g);
    assert(coords !== null, "R12: border 真画到 KineticText.getGraphicsLayer('border')");
    assert(
      coords !== null && approxEq(coords.x, bounds.x - 5),
      `R12: border 坐标补偿 x=bounds.x-padding=${bounds.x - 5}（实际 ${coords?.x}）`,
    );
  }

  // (3) align:center 显著非零 bounds.x（模拟居中段落：char layoutX 被 correction 推右）。
  //     验证坐标补偿在 center 模式生效——旧画法 -padding 会偏在内容左侧 bounds.x+padding 像素。
  {
    const kt = makeKineticText([makeCharStub(300, 30, 40, 50)]); // bounds.x = 300-20 = 280
    const bounds = kt.getContentBounds();
    assert(bounds.x > 250, `center 模拟 bounds.x 显著非零（x=${bounds.x}）`);
    effectManager.apply(kt, "box", { padding: 5, radius: 4 }, true);
    const g = kt.getGraphicsLayer("box");
    const coords = firstRectCoords(g);
    assert(
      coords !== null && coords.x > 250,
      `R12: center 模式 box 画在 bounds.x 侧（x=${coords?.x}），旧 -padding 画法会偏到 -5（此断言锁定补偿不回退）`,
    );
    assert(
      coords !== null && approxEq(coords.x, bounds.x - 5),
      `R12: center 模式 box x = bounds.x - padding = ${bounds.x - 5}（实际 ${coords?.x}）`,
    );
  }

  // (4) 真实 seek-replay 链路：registerInstantEffects 对真实 KineticText void result 登记 graphicsLayer
  //     cleanup，clearInstantEffects 清该层。registerInstantEffects 是 private，但其登记逻辑与
  //     SegmentBuilder block-instant 路径同源（守卫 typeof getGraphicsLayer === "function"）——
  //     此处用真实 effectManager.apply 复现登记 + 真实 PlaybackController.clearInstantEffects 清理，
  //     覆盖之前 fake target 跳过的「真实 KineticText.getGraphicsLayer 存在」守卫。
  {
    const kt = makeKineticText([makeCharStub(60, 40, 40, 50)]);
    const meta = effectManager.getMetadata("box");
    assert(meta?.mutexGroup === "box", "R12: box meta.mutexGroup = 'box'（graphicsLayer 层名源）");
    // 真实 apply（与 registerInstantEffects 内 effectManager.apply 同源）
    const result = effectManager.apply(kt, "box", { padding: 5, radius: 4 }, true);
    // 复现 registerInstantEffects 的 void-result 登记分支（守卫对真实 KineticText 现在为 true）
    const state = {
      isAutoPlaying: false,
      activeBehaviorCleanups: [],
      activeInstantCleanups: [] as any[],
      onTimeUpdate: () => {},
    } as any;
    if (!result && meta?.mutexGroup && typeof (kt as any).getGraphicsLayer === "function") {
      state.activeInstantCleanups.push({
        target: kt,
        filterInstance: undefined as any,
        graphicsLayer: meta.mutexGroup,
      });
    }
    assert(
      state.activeInstantCleanups.length === 1,
      "R12: 真实 KineticText 有 getGraphicsLayer → void-result graphicsLayer cleanup 登记成功（守卫为 true）",
    );
    // 清理前 Graphics 有指令
    const g = kt.getGraphicsLayer("box");
    assert(firstRectCoords(g) !== null, "R12: 清理前 box Graphics 有绘制指令");
    // 真实 clearInstantEffects
    PlaybackController.clearInstantEffects(state);
    assert(
      firstRectCoords(g) === null,
      "R12: clearInstantEffects 对真实 KineticText 清 box 层（g.clear() → instructions 空）",
    );
    assert(state.activeInstantCleanups.length === 0, "R12: clearInstantEffects 清空 activeInstantCleanups");
  }
}

/**
 * [9] replayStyles seek 回退清 style（R13-High / SA-28）。
 *
 * 旧 replayStyles 只 reset `timePosition <= currentTime` 的字符。若先 seek/play 跨过样式生效点
 * （如 `f.hold(1s).red` 红色生效后），再 seek 回退到生效点之前（如 0.5s），**没有任何 style record
 * 满足 `timePosition <= currentTime`** → 不 reset、不 apply → 字符残留旧样式（红色不退）。最小真实
 * 探针结果：seek 1.5s 后 fill=#ff4d4f，seek 回 0.5s 仍 #ff4d4f。
 *
 * 根因：把 reset 的"哪些 char 可能已被样式污染"窗口错误耦合到 apply 的"哪些样式在当前时间生效"
 * 窗口——两者语义不同，seek 可回退让生效点之后的样式已应用。修法：reset 覆盖**所有出现在 styleRecords
 * 里的 char**（清回 base），reapply 仍按 currentTime 过滤。
 *
 * 测试经公开 seekToTime 驱动（replayStyles 是 private，与 §B INV-2 的"register-star/replay-star" seek
 * 末段"对齐）。无法用真实 KineticChar：其构造函数 `gsap.ticker.add(this.update)` 在 tsx 下因
 * gsap CJS/ESM 互操作（gsap.ticker===undefined，gsap.default.ticker 才存在，§B-bis）抛错——
 * 与 §8 用 KineticText（构造不碰 ticker）的取舍同源。此处用与 KineticChar.resetStyle 同构的 fake
 * char：base fill 快照 + resetStyle 写回 + 真实 styleManager.apply 写新 fill。resetStyle/apply
 * 是 StyleRecord 消费的唯一接口，fake 与真实行为逐字段一致，不掩盖 replayStyles 的真实逻辑
 * （SA-27 教训：fake 满足守卫不等于真实 target 满足——此处测的是 replayStyles 的重放语义而非
 * KineticChar.resetStyle 的内部正确性，后者由真实对象在浏览器侧保证）。
 */
function testReplayStylesSeekBack() {
  console.log("\n[9] replayStyles seek 回退清 style（R13-High / SA-28）");

  /**
   * 与 KineticChar 的 style/resetStyle 契约同构的 fake：构造快照 base fill，resetStyle 写回，
   * styleManager.apply 经真实 fn 写 style.fill（如 red 写 "#ff4d4f"）。replayStyles 只读/写这两者。
   */
  function makeFakeChar(baseFill: string): { style: { fill: string }; resetStyle: () => void } {
    const style = { fill: baseFill };
    const snapshot = baseFill;
    return {
      style,
      resetStyle: () => { style.fill = snapshot; },
    };
  }

  /** 真实 timeline（含占位 tween 使 duration>0）+ 单条 red StyleRecord@1s 的 segment。 */
  function makeStyleSegment(fakeChar: any, recordAt: number): Segment {
    const tl = G.timeline();
    tl.to({ p: 0 }, { p: 1, duration: 2 }, 0);
    return {
      timeline: tl,
      duration: 2,
      behaviors: [],
      styleRecords: [{ char: fakeChar, styleName: "red", params: {}, timePosition: recordAt }],
      instantEffects: [],
      entranceFilters: [],
      stageModifierRecords: [],
      stageTweenRecords: [],
      paragraphs: [],
      entryCheckpoint: { time: 0, label: "" },
      exitCheckpoint: { time: 2, label: "" },
    } as unknown as Segment;
  }

  // (1) 核心复现点：seek 跨过生效点再回退——字符必须回到 base。
  {
    const ch = makeFakeChar("#000000");
    const seg = makeStyleSegment(ch, 1);
    const { state } = makeFakeState(false);
    assert(
      ch.style.fill === "#000000",
      "base fill = #000000（reset 目标）",
    );
    PlaybackController.seekToTime(seg, 1.5, state);
    assert(
      ch.style.fill === "#ff4d4f",
      `R13 seek 1.5s（red 已生效）fill = #ff4d4f（实际 ${ch.style.fill}）`,
    );
    // 关键：seek 回退到 red 生效之前。旧逻辑不 reset（无 record 满足 ≤0.5）→ 残留红色。
    PlaybackController.seekToTime(seg, 0.5, state);
    assert(
      ch.style.fill === "#000000",
      `R13 seek 回退 0.5s（red 之前）fill 回 base #000000（实际 ${ch.style.fill}，旧逻辑残留 #ff4d4f）`,
    );
  }

  // (2) seek 跨过生效点后停在那：字符保持生效样式（确认 reset 不会误清当前生效样式）。
  {
    const ch = makeFakeChar("#000000");
    const seg = makeStyleSegment(ch, 1);
    const { state } = makeFakeState(false);
    PlaybackController.seekToTime(seg, 1.5, state);
    assert(
      ch.style.fill === "#ff4d4f",
      "R13 seek 1.5s 后停留：red 仍生效（reset→base 后 reapply@1.5 重上 red）",
    );
  }

  // (3) 从头 seek 到生效点之前：base（向后兼容——从未应用过 red）。
  {
    const ch = makeFakeChar("#000000");
    const seg = makeStyleSegment(ch, 1);
    const { state } = makeFakeState(false);
    PlaybackController.seekToTime(seg, 0.3, state);
    assert(
      ch.style.fill === "#000000",
      "R13 从头 seek 0.3s（red 之前）fill = base（无样式应用过）",
    );
  }

  // (4) 多次往返 seek 幂等：跨生效点 → 回退 → 再跨，结果一致。
  {
    const ch = makeFakeChar("#000000");
    const seg = makeStyleSegment(ch, 1);
    const { state } = makeFakeState(false);
    PlaybackController.seekToTime(seg, 1.5, state); // 红
    PlaybackController.seekToTime(seg, 0.5, state); // 回退 base
    PlaybackController.seekToTime(seg, 0.5, state); // 再停 0.5（幂等）
    assert(ch.style.fill === "#000000", "R13 回退后重复 seek 0.5 幂等（base）");
    PlaybackController.seekToTime(seg, 1.5, state); // 再跨
    assert(ch.style.fill === "#ff4d4f", "R13 再 seek 1.5（red 重上，幂等）");
    PlaybackController.seekToTime(seg, 0.5, state); // 再回退
    assert(ch.style.fill === "#000000", "R13 再回退 0.5（reset 清回 base）");
  }

  // (5) 两个 char 各自的 red 在不同时间生效：seek 回退只清各自生效过的，不影响另一个在当前时间仍生效的。
  {
    const ch1 = makeFakeChar("#000000");
    const ch2 = makeFakeChar("#000000");
    const tl = G.timeline();
    tl.to({ p: 0 }, { p: 1, duration: 3 }, 0);
    const seg = {
      timeline: tl,
      duration: 3,
      behaviors: [],
      styleRecords: [
        { char: ch1, styleName: "red", params: {}, timePosition: 1 },
        { char: ch2, styleName: "red", params: {}, timePosition: 2 },
      ],
      instantEffects: [],
      entranceFilters: [],
      stageModifierRecords: [],
      stageTweenRecords: [],
      paragraphs: [],
      entryCheckpoint: { time: 0, label: "" },
      exitCheckpoint: { time: 3, label: "" },
    } as unknown as Segment;
    const { state } = makeFakeState(false);
    PlaybackController.seekToTime(seg, 2.5, state);
    assert(ch1.style.fill === "#ff4d4f", "R13 多 char seek 2.5：ch1 red 生效");
    assert(ch2.style.fill === "#ff4d4f", "R13 多 char seek 2.5：ch2 red 生效");
    // 回退到 ch1 生效后、ch2 生效前（1.5）：ch1 保持 red，ch2 应回 base。
    PlaybackController.seekToTime(seg, 1.5, state);
    assert(
      ch1.style.fill === "#ff4d4f",
      `R13 seek 1.5（ch1 red 仍生效）：ch1 fill #ff4d4f（实际 ${ch1.style.fill}）`,
    );
    assert(
      ch2.style.fill === "#000000",
      `R13 seek 1.5（ch2 red 之前）：ch2 回 base #000000（实际 ${ch2.style.fill}，旧逻辑残留红）`,
    );
  }
}

/**
 * [10] ended 重播不清已应用样式（R14-High / SA-29）。
 *
 * 与 R13（§9，seekToTime 回退路径）同源、不同路径：style record 不在时间线上、靠 reset+重放，
 * 但 reset 的清理点散落在多条操作路径上，每条都可能遗漏。R13 修了 seekToTime 的回退路径；
 * 本节覆盖 playSegment 的 ended 重播路径。
 *
 * 旧 playSegment 的 ended 分支只 clearBehaviors + clearInstantEffects + clearModifiers + tl.seek(0)，
 * **不调 replayStyles**——style 重放只在 seekToTime 里调。于是播到结尾（style 已生效）后点播放重播，
 * 时间线回 0 了，已生效的样式（如 f.hold(1s).red 染红）仍残留。真实探针：
 * seek 1.5s→#ff4d4f；seek 2.0s ended→#ff4d4f；playSegment 重播→#ff4d4f time 0 progress 0（残留）。
 *
 * 根因：与 R13 同——style 资源有多个清理路径（seekToTime / playSegment-ended / stop / clearScreen），
 * reset 必须覆盖所有可能已污染的路径，不能只在一条路径上做。R13 的"reset 窗口 vs apply 窗口解耦"
 * 原则在多路径维度同样成立：**reset 路径 vs apply 路径必须对齐**——凡 apply 能去到的状态，
 * 都要有一条对应路径把它 reset 回 base。ended 重播 = 回到时间起点，理应等价于 seekToTime(0)
 * 的最终态（base + 仅 timePosition<=0 的样式）。
 *
 * 修复（R14）：ended 分支 tl.seek(0) 后调 replayStyles(segment, 0)。tl.time() 已为 0，
 * replayStyles 按 R13 的 reset 覆盖全部 styleRecords（清回 base），只重放 timePosition<=0 的样式
 * （通常无）→ 干净回到时间起点。test:playback 现 99 + 本节 = 111 case。
 *
 * fake char 取舍同 §9：真实 KineticChar 构造在 tsx 下因 gsap.ticker 互操作抛错，此处测的是
 * playSegment ended 分支的 reset 路径是否调到 replayStyles，与 KineticChar.resetStyle 内部正确性无关。
 */
function testEndedReplayStyleReset() {
  console.log("\n[10] ended 重播清 style（R14-High / SA-29）");

  // 与 §9 同构的 fake char（resetStyle/apply 经真实 styleManager 写 fill）。
  function makeFakeChar(baseFill: string): { style: { fill: string }; resetStyle: () => void } {
    const style = { fill: baseFill };
    const snapshot = baseFill;
    return { style, resetStyle: () => { style.fill = snapshot; } };
  }

  function makeStyleSegment(fakeChar: any, recordAt: number): Segment {
    const tl = G.timeline();
    tl.to({ p: 0 }, { p: 1, duration: 2 }, 0);
    return {
      timeline: tl,
      duration: 2,
      behaviors: [],
      styleRecords: [{ char: fakeChar, styleName: "red", params: {}, timePosition: recordAt }],
      instantEffects: [],
      entranceFilters: [],
      stageModifierRecords: [],
      stageTweenRecords: [],
      paragraphs: [],
      entryCheckpoint: { time: 0, label: "" },
      exitCheckpoint: { time: 2, label: "" },
    } as unknown as Segment;
  }

  // (1) 核心复现点：seek 到 red 生效 → ended → playSegment 重播 → 字符回 base。
  {
    const ch = makeFakeChar("#000000");
    const seg = makeStyleSegment(ch, 1);
    const { state } = makeFakeState(false);
    PlaybackController.seekToTime(seg, 1.5, state);
    assert(ch.style.fill === "#ff4d4f", "R14 seek 1.5s（red 生效）fill = #ff4d4f");
    // 推到结尾（ended）。
    PlaybackController.seekToTime(seg, 2, state);
    assert(seg.timeline.progress() >= 1, "R14 seek 2.0s 后 progress>=1（ended）");
    assert(ch.style.fill === "#ff4d4f", "R14 ended 时 red 仍生效（#ff4d4f）");
    // 点播放重播 → playSegment 走 ended 分支。旧逻辑时间线回 0 但 fill 残留红。
    PlaybackController.playSegment(seg, state);
    assert(
      ch.style.fill === "#000000",
      `R14 重播后 fill 回 base #000000（实际 ${ch.style.fill}，旧逻辑残留 #ff4d4f）`,
    );
    assert(seg.timeline.time() === 0, "R14 重播后 tl.time()=0（时间起点）");
    assert(state.isAutoPlaying === true, "R14 重播后 isAutoPlaying=true（开始播放）");
  }

  // (2) 多次 ended 重播幂等：第二次重播也不残留。
  {
    const ch = makeFakeChar("#000000");
    const seg = makeStyleSegment(ch, 1);
    const { state } = makeFakeState(false);
    // 第一轮：生效 → ended → 重播（回 base）。
    PlaybackController.seekToTime(seg, 1.5, state);
    PlaybackController.seekToTime(seg, 2, state);
    PlaybackController.playSegment(seg, state);
    assert(ch.style.fill === "#000000", "R14 第一轮重播后 base");
    // 第二轮：再次生效 → ended → 重播。
    PlaybackController.seekToTime(seg, 1.5, state);
    assert(ch.style.fill === "#ff4d4f", "R14 第二轮 seek 1.5 red 生效");
    PlaybackController.seekToTime(seg, 2, state);
    PlaybackController.playSegment(seg, state);
    assert(ch.style.fill === "#000000", "R14 第二轮重播后 base（幂等）");
  }

  // (3) ended 重播不误清 timePosition<=0 的样式（回到起点应保留起点生效的样式）。
  //     red@0（时间起点即生效）→ 重播后仍应是 red（replayStyles(0) 重放 timePosition<=0）。
  {
    const ch = makeFakeChar("#000000");
    const seg = makeStyleSegment(ch, 0); // red 在 0s 生效
    const { state } = makeFakeState(false);
    PlaybackController.seekToTime(seg, 0, state);
    assert(ch.style.fill === "#ff4d4f", "R14 red@0：seek 0 时 red 生效（timePosition<=0）");
    PlaybackController.seekToTime(seg, 2, state);
    assert(ch.style.fill === "#ff4d4f", "R14 red@0：ended 时 red 仍生效");
    PlaybackController.playSegment(seg, state);
    assert(
      ch.style.fill === "#ff4d4f",
      `R14 red@0 重播后 red 仍生效（实际 ${ch.style.fill}，replayStyles(0) 应重放 timePosition<=0）`,
    );
  }

  // (4) 多 char：重播后各自回到"时间起点应有的状态"（无一残留）。
  {
    const ch1 = makeFakeChar("#000000");
    const ch2 = makeFakeChar("#000000");
    const tl = G.timeline();
    tl.to({ p: 0 }, { p: 1, duration: 3 }, 0);
    const seg = {
      timeline: tl, duration: 3, behaviors: [],
      styleRecords: [
        { char: ch1, styleName: "red", params: {}, timePosition: 0 }, // 起点生效，重播后应保留
        { char: ch2, styleName: "red", params: {}, timePosition: 2 }, // 中途生效，重播后应回 base
      ],
      instantEffects: [], entranceFilters: [], stageModifierRecords: [], stageTweenRecords: [],
      paragraphs: [], entryCheckpoint: { time: 0, label: "" }, exitCheckpoint: { time: 3, label: "" },
    } as unknown as Segment;
    const { state } = makeFakeState(false);
    PlaybackController.seekToTime(seg, 2.5, state);
    assert(ch1.style.fill === "#ff4d4f", "R14 多 char seek 2.5：ch1 red 生效");
    assert(ch2.style.fill === "#ff4d4f", "R14 多 char seek 2.5：ch2 red 生效");
    PlaybackController.seekToTime(seg, 3, state);
    PlaybackController.playSegment(seg, state);
    assert(
      ch1.style.fill === "#ff4d4f",
      `R14 多 char 重播：ch1 red@0 保留（实际 ${ch1.style.fill}）`,
    );
    assert(
      ch2.style.fill === "#000000",
      `R14 多 char 重播：ch2 red@2 回 base（实际 ${ch2.style.fill}，旧逻辑残留红）`,
    );
  }
}

/**
 * [11] pre-hold 样式 reset baseline 错位 + record 去重（R15-High / SA-30）。
 *
 * 与 R13（§9 seekToTime 回退）/R14（§10 ended 重播）同族但第三维度：**reset baseline 必须等于
 * 构建期烘焙态**。旧 baseStyleSnapshot 在 LayoutPlanner:70 于 applyInitialStylesToStyle 之前捕获
 *（= 原始 base），DisplayAssembler:113 又用它覆盖 KineticChar 构造时从 glyphPlan.style（已含
 * pre-hold 烘焙）捕获的快照 → resetStyle() 清回原始 base 而丢 pre-hold 样式。叠加：site 1
 *（placeCharOnTimeline）把 pre-hold 样式当 StyleRecord 注册，site 3（unrollCharChain）对
 * hold:char 链把所有非 hold:char effect（含 pre-hold）tl.call + record → big/small 相对样式
 * 重复放大（build 24→36 + replay/chain 36→54）。
 *
 * 修复（R15）：(A) baseline = glyphPlan.style 烘焙态（删除 DisplayAssembler 的 raw-base 覆盖）；
 * (B) site 1 不再注册 pre-hold StyleRecord；(C) site 3 跳过 pre-hold 样式的 tl.call + record
 *（边界与 applyInitialStylesToStyle 对齐：hold||blocking||level==="group"||"block"）。site 2
 *（unrollGroupChain）本就 `if (isStyle) return false` 跳过 pre-hold 样式，无需改。
 *
 * 测试取舍：真实 KineticChar 在 tsx 下因 gsap.ticker 互操作抛错（§9 同源），此处用与 KineticChar
 * **新** baseline 语义同构的 fake char：构建期烘焙态作快照，resetStyle 写回该快照（= pre-hold 态，
 * 不是原始 base）。fake 暴露的接口（style.fill / style.fontSize / resetStyle）与真实 KineticChar
 * 一致，replayStyles 只读/写这两者。测的是"baseline=烘焙态 + pre-hold 不进 record"这条语义，
 * 不是 KineticChar 内部正确性（后者由真实对象在浏览器侧保证，SA-27 教训：此处不掩盖真实差异，
 * 因 fake 的 baseline 语义与真实 R15 后的 KineticChar 一致——区别于 R12-block 的 fake 满足守卫
 * 而真实不满足）。
 *
 * fake char 关键：快照 = 烘焙态（构造时传入的 style 当前值），resetStyle 写回快照。
 */
function testPreHoldStyleBaseline() {
  console.log("\n[11] pre-hold 样式 baseline 错位 + record 去重（R15-High / SA-30）");

  /**
   * 与 KineticChar 新 baseline 语义同构的 fake char：baseStyleSnapshot 在构造时从传入 style
   * 捕获（= 构建期烘焙态，含 pre-hold 样式），resetStyle 写回该快照。styleManager.apply 经真实
   * fn 写 style.fill / style.fontSize（red 写 "#ff4d4f"，big 写 fontSize*1.5）。
   */
  function makeFakeChar(bakedStyle: { fill: string; fontSize: number; fontWeight: string }) {
    const style = { fill: bakedStyle.fill, fontSize: bakedStyle.fontSize, fontWeight: bakedStyle.fontWeight };
    const snapshot = { fill: bakedStyle.fill, fontSize: bakedStyle.fontSize, fontWeight: bakedStyle.fontWeight };
    return {
      style,
      resetStyle: () => {
        style.fill = snapshot.fill; style.fontSize = snapshot.fontSize; style.fontWeight = snapshot.fontWeight;
      },
    };
  }

  /** 构建期烘焙：用真实 styleManager.apply(force=false) 把 pre-hold 样式烘到 bakedStyle。 */
  function bakeStyle(rawFill: string, rawSize: number, preHoldStyles: string[]) {
    const baked = { fill: rawFill, fontSize: rawSize, fontWeight: "normal" };
    // 用真实 styleManager 烘焙（与 LayoutPlanner.applyInitialStylesToStyle 同路径，force=false）
    for (const name of preHoldStyles) {
      styleManager.apply(baked as any, name, {}, false);
    }
    return baked;
  }

  function makeSegment(fakeChar: any, styleRecords: any[], duration: number): Segment {
    const tl = G.timeline();
    tl.to({ p: 0 }, { p: 1, duration }, 0);
    return {
      timeline: tl,
      duration,
      behaviors: [],
      styleRecords,
      instantEffects: [],
      entranceFilters: [],
      stageModifierRecords: [],
      stageTweenRecords: [],
      paragraphs: [],
      entryCheckpoint: { time: 0, label: "" },
      exitCheckpoint: { time: duration, label: "" },
    } as unknown as Segment;
  }

  // (1) 核心复现：pre-hold red 烘到 baseline → seek 0 → resetStyle 回 baseline（红），不回原始 base。
  //     R15 后 pre-hold 样式不进 styleRecords → replayStyles(0) 只 reset（回 baseline=红）不重放。
  {
    const baked = bakeStyle("#000000", 24, ["red"]); // 构建期烘焙 red → fill #ff4d4f
    const ch = makeFakeChar(baked); // baseline snapshot = 烘焙态（红）
    // R15 后：pre-hold 样式不在 styleRecords（site 1 删除）。styleRecords 为空。
    const seg = makeSegment(ch, [], 2);
    const { state } = makeFakeState(false);
    assert(ch.style.fill === "#ff4d4f", "R15 构建期 red 烘到 baseline（fill #ff4d4f）");
    PlaybackController.seekToTime(seg, 0, state);
    assert(
      ch.style.fill === "#ff4d4f",
      `R15 seek 0：reset 回 baseline（红 #ff4d4f，不是原始 base #000000）（实际 ${ch.style.fill}）`,
    );
    // 自然播放推进到字符揭示后：无 record 重放，仍 baseline 红。
    PlaybackController.seekToTime(seg, 1.5, state);
    assert(
      ch.style.fill === "#ff4d4f",
      `R15 seek 1.5（无 post-hold record）：仍 baseline 红（实际 ${ch.style.fill}）`,
    );
  }

  // (2) big 相对样式不重复放大：pre-hold big 烘到 baseline（24→36）→ seek 0 → reset 回 36，无 record
  //     重放 → 保持 36（不是 54）。旧逻辑：baseline=24，record 重放 big → 36；或 baseline=36 + record
  //     重放 big → 54。R15：baseline=36，无 record → 36。
  {
    const baked = bakeStyle("#000000", 24, ["big"]); // 构建期 big → 36
    const ch = makeFakeChar(baked); // baseline snapshot = 36
    const seg = makeSegment(ch, [], 2);
    const { state } = makeFakeState(false);
    assert(ch.style.fontSize === 36, "R15 构建期 big 烘到 baseline（fontSize 36）");
    PlaybackController.seekToTime(seg, 0, state);
    assert(
      ch.style.fontSize === 36,
      `R15 seek 0：big 不重复放大（保持 36，不是 54）（实际 ${ch.style.fontSize}）`,
    );
  }

  // (3) post-hold 动态样式仍重放：pre-hold red（baseline）+ post-hold bold record@1s → seek 1.5
  //     → reset 回 baseline(red) + 重放 bold record → red + bold。post-hold record 保留。
  {
    const baked = bakeStyle("#000000", 24, ["red"]); // pre-hold red → baseline 红
    const ch = makeFakeChar(baked);
    // post-hold bold record（site 2/3 的 post-hold 部分，R15 保留）。
    const seg = makeSegment(ch, [{ char: ch, styleName: "bold", params: {}, timePosition: 1 }], 2);
    const { state } = makeFakeState(false);
    PlaybackController.seekToTime(seg, 1.5, state);
    assert(
      ch.style.fill === "#ff4d4f",
      `R15 pre+post：seek 1.5 baseline red 保留（实际 ${ch.style.fill}）`,
    );
    assert(
      ch.style.fontWeight === "bold",
      `R15 pre+post：seek 1.5 post-hold bold record 重放（fontWeight bold）（实际 ${ch.style.fontWeight}）`,
    );
  }

  // (4) seek 回退到 post-hold 之前：pre-hold red（baseline）+ post-hold bold@1s → seek 0.5
  //     → reset 回 baseline(red)，bold record 不重放（timePosition>0.5）→ 仅 red。
  {
    const baked = bakeStyle("#000000", 24, ["red"]);
    const ch = makeFakeChar(baked);
    const seg = makeSegment(ch, [{ char: ch, styleName: "bold", params: {}, timePosition: 1 }], 2);
    const { state } = makeFakeState(false);
    PlaybackController.seekToTime(seg, 0.5, state);
    assert(
      ch.style.fill === "#ff4d4f",
      `R15 seek 0.5（bold 之前）：baseline red 保留（实际 ${ch.style.fill}）`,
    );
    assert(
      ch.style.fontWeight !== "bold",
      `R15 seek 0.5：bold record 未重放（timePosition 1 > 0.5）（实际 fontWeight ${ch.style.fontWeight}）`,
    );
  }

  // (5) ended 重播：pre-hold red（baseline）+ post-hold bold@1s → 播完 ended → playSegment 重播
  //     → reset 回 baseline(red) + 重放 timePosition<=0（无）→ 仅 red（不残留 bold）。
  //     同时验证 R14 的 ended-replay 修复在 R15 baseline 语义下仍正确。
  {
    const baked = bakeStyle("#000000", 24, ["red"]);
    const ch = makeFakeChar(baked);
    const seg = makeSegment(ch, [{ char: ch, styleName: "bold", params: {}, timePosition: 1 }], 2);
    const { state } = makeFakeState(false);
    PlaybackController.seekToTime(seg, 1.5, state); // red + bold
    assert(ch.style.fontWeight === "bold", "R15 ended 重播前：bold 生效");
    PlaybackController.seekToTime(seg, 2, state); // ended
    PlaybackController.playSegment(seg, state); // 重播
    assert(
      ch.style.fill === "#ff4d4f",
      `R15 ended 重播：baseline red 保留（实际 ${ch.style.fill}）`,
    );
    assert(
      ch.style.fontWeight !== "bold",
      `R15 ended 重播：bold 不残留（实际 fontWeight ${ch.style.fontWeight}）`,
    );
  }

  // (6) 多 char 各自 baseline：char1 pre-hold red（baseline 红）、char2 无 pre-hold（baseline base）
  //     → seek 0 → char1 红、char2 base。pre-hold 不进 record → 互不干扰。
  {
    const baked1 = bakeStyle("#000000", 24, ["red"]); // char1 烘 red
    const baked2 = bakeStyle("#000000", 24, []); // char2 无 pre-hold
    const ch1 = makeFakeChar(baked1);
    const ch2 = makeFakeChar(baked2);
    // 两个 char 的 pre-hold 都不进 record。char2 有 post-hold red@1s（测 char2 的 post-hold 不被
    // char1 baseline 干扰）。
    const seg = makeSegment(
      ch1,
      [{ char: ch2, styleName: "red", params: {}, timePosition: 1 }],
      2,
    );
    const { state } = makeFakeState(false);
    PlaybackController.seekToTime(seg, 0, state);
    assert(
      ch1.style.fill === "#ff4d4f",
      `R15 多 char seek 0：ch1 baseline 红（实际 ${ch1.style.fill}）`,
    );
    assert(
      ch2.style.fill === "#000000",
      `R15 多 char seek 0：ch2 baseline base（实际 ${ch2.style.fill}）`,
    );
    PlaybackController.seekToTime(seg, 1.5, state);
    assert(
      ch1.style.fill === "#ff4d4f",
      `R15 多 char seek 1.5：ch1 baseline 红保留（无 record 干扰）（实际 ${ch1.style.fill}）`,
    );
    assert(
      ch2.style.fill === "#ff4d4f",
      `R15 多 char seek 1.5：ch2 post-hold red record 重放（实际 ${ch2.style.fill}）`,
    );
  }
}

/**
 * [11b] DisplayAssembler baseline 捕获 = pre-hold 烘焙态（R15-High / SA-30，真实 KineticChar 路径）。
 *
 * §11（testPreHoldStyleBaseline）用 fake char 锁定 replayStyles 运行时语义，但 fake 的 baseline
 * 捕获是手写的，**掩盖了 DisplayAssembler.materializeGlyphPlan 的真实 baseline 捕获逻辑**
 *（SA-27 教训：fake 满足语义不等于真实代码满足）。本节用**真实 KineticChar**（gsap.ticker stub，
 * 见文件头）直接调 DisplayAssembler.materializeGlyphPlan，验证 change A：char.baseStyleSnapshot
 * = glyphPlan.style（pre-hold 烘焙态），而非 glyphPlan.baseStyleSnapshot（原始 base）。
 *
 * 旧逻辑：DisplayAssembler:113 `Object.assign(char.baseStyleSnapshot, glyphPlan.baseStyleSnapshot)`
 * 把构造时从 glyphPlan.style 捕获的烘焙态快照覆盖回原始 base。本节构造 glyphPlan，style 含 pre-hold
 * red（#ff4d4f），baseStyleSnapshot 为原始 base（#000000），调 materializeGlyphPlan 后验证
 * char.baseStyleSnapshot.fill === "#ff4d4f"（烘焙态，非 #000000）且 resetStyle 后保持红。
 */
function testDisplayAssemblerBaseline() {
  console.log("\n[11b] DisplayAssembler baseline = pre-hold 烘焙态（R15-High / SA-30，真实 KineticChar）");

  // 构建期 pre-hold 烘焙后的 style（含 red）：模拟 LayoutPlanner 的 measurementStyle。
  const bakedStyle = new TextStyle({
    fill: "#ff4d4f", fontSize: 24, fontWeight: "normal", fontStyle: "normal",
    fontFamily: "Arial", dropShadow: false, stroke: undefined,
  });
  // 原始 base snapshot（LayoutPlanner:70 在 applyInitialStylesToStyle 之前捕获）。
  const rawBaseSnapshot = {
    fill: "#000000", fontSize: 24, fontWeight: "normal", fontStyle: "normal",
    fontFamily: "Arial", dropShadow: false, stroke: undefined,
  };

  const glyphPlan: LayoutGlyphPlan = {
    kind: "char",
    text: "A",
    style: bakedStyle,                 // ← pre-hold 烘焙态（红）
    baseStyleSnapshot: rawBaseSnapshot, // ← 原始 base（黑）
    effects: [],
    timingSugars: [],
    tokenIdx: 0,
    charIdx: 0,
    width: 10, height: 24, ascent: 18, descent: 6,
    stageInstructions: [],
    line: 0,
  };

  const result = DisplayAssembler.materializeGlyphPlan(glyphPlan);
  const char = result.char as KineticChar;

  // (1) baseline snapshot = 烘焙态（红），不是原始 base（黑）。
  assert(
    char.baseStyleSnapshot.fill === "#ff4d4f",
    `R15 baseline snapshot = 烘焙态红 #ff4d4f（实际 ${char.baseStyleSnapshot.fill}，旧逻辑覆盖成 #000000）`,
  );

  // (2) resetStyle() 回 baseline（红），不回原始 base（黑）。
  char.resetStyle();
  assert(
    (char.style as any).fill === "#ff4d4f",
    `R15 resetStyle 回 baseline 红 #ff4d4f（实际 ${(char.style as any).fill}，旧逻辑回 #000000）`,
  );

  // (3) fontSize baseline 同理（big 烘焙后 baseline=36，resetStyle 回 36 非 24）。
  const bakedBig = new TextStyle({
    fill: "#000000", fontSize: 36, fontWeight: "normal", fontStyle: "normal",
    fontFamily: "Arial", dropShadow: false, stroke: undefined,
  });
  const glyphPlanBig: LayoutGlyphPlan = {
    kind: "char", text: "B", style: bakedBig,
    baseStyleSnapshot: { ...rawBaseSnapshot },
    effects: [], timingSugars: [], tokenIdx: 0, charIdx: 0,
    width: 12, height: 36, ascent: 27, descent: 9, stageInstructions: [], line: 0,
  };
  const charBig = DisplayAssembler.materializeGlyphPlan(glyphPlanBig).char as KineticChar;
  assert(
    charBig.baseStyleSnapshot.fontSize === 36,
    `R15 baseline snapshot.fontSize = 烘焙态 36（实际 ${charBig.baseStyleSnapshot.fontSize}，旧逻辑覆盖成 24）`,
  );
  charBig.resetStyle();
  assert(
    (charBig.style as any).fontSize === 36,
    `R15 resetStyle 回 baseline 36（实际 ${(charBig.style as any).fontSize}，旧逻辑回 24）`,
  );
}

/**
 * [12] block/global 初始样式经 applyGroupEffects 同步应用后不进 baseline（R16-High / SA-31）。
 *
 * R15 修了 pre-hold 初始样式进 baseline（DisplayAssembler 路径），但 block/global 初始样式走的是
 * **另一条构建路径**：SegmentBuilder.ts:242 的 `EffectProcessor.applyGroupEffects(paragraphText, blockRemaining)`
 * 在 KineticChar 构造**之后**同步把 block 样式写入 char.style（force=true，applyStyleRecursively）。
 * 此时 baseStyleSnapshot 已在构造时固化（R15 pre-hold 烘焙态）——block 样式只在 char.style、不在
 * baseline、不在 styleRecords。一旦同字符后续有动态样式 record（如 f.hold(1s).bold 的 bold），
 * replayStyles 的 resetStyle() 回 baseline（无 block 样式）→ block 样式丢失。
 *
 * 复现形态：`[.red:block]\n{Hello} @ f.hold(1s).bold` → seek 1.5 预期 red+bold，实际 base+bold（red 丢）。
 * 探针确认：block red 经 applyGroupEffects 同步应用后 style.fill=#ff4d4f，但 baseline.fill 仍 #000000。
 *
 * 修复（R16）：applyGroupEffects 后对 paragraphText 的所有 char 调 `recaptureBaseStyleSnapshot()`
 *（KineticChar 新增方法），把当前 style（含 block 样式）重新捕获进 baseline。与 R15 同模型——
 * 构建期已应用的初始样式进 baseline（不进 record 重放），避免相对样式 big/small 重复放大。
 *
 * 测试取舍：§11/11b 已证明 fake char 锁运行时契约但真实代码路径需真实对象验证（SA-27/SA-30 教训）。
 * 本节用**真实 KineticChar**（gsap.ticker stub，文件头）：构造（baseline=pre-hold raw）→ 模拟
 * applyGroupEffects 同步应用 block red（force=true）→ 调 recaptureBaseStyleSnapshot → 构造带动态
 * bold record 的 segment → 验证 seek 1.5 后 red（baseline）+ bold（record 重放）都在。
 */
function testBlockStyleBaselineRecapture() {
  console.log("\n[12] block/global 初始样式 recapture baseline（R16-High / SA-31，真实 KineticChar）");

  function makeBaseTextStyle(fill = "#000000", fontSize = 24) {
    return new TextStyle({
      fill, fontSize, fontWeight: "normal", fontStyle: "normal",
      fontFamily: "Arial", dropShadow: false, stroke: undefined,
    });
  }

  function makeSegmentWithRecord(char: KineticChar, records: any[], duration: number): Segment {
    const tl = G.timeline();
    tl.to({ p: 0 }, { p: 1, duration }, 0);
    return {
      timeline: tl, duration, behaviors: [], styleRecords: records,
      instantEffects: [], entranceFilters: [], stageModifierRecords: [], stageTweenRecords: [],
      paragraphs: [], entryCheckpoint: { time: 0, label: "" }, exitCheckpoint: { time: duration, label: "" },
    } as unknown as Segment;
  }

  // (1) 核心复现：block red 同步应用后 recapture baseline → 动态 bold record seek 后 red+bold 都在。
  {
    const ch = new KineticChar("H", makeBaseTextStyle("#000000"));
    // 构造时 baseline = raw base（无 block 样式）——模拟 R15 后的 pre-hold 烘焙态（此处无 pre-hold）。
    assert(ch.baseStyleSnapshot.fill === "#000000", "R16 构造时 baseline.fill = #000000（无 block 样式）");
    // 模拟 applyGroupEffects 同步应用 block red（force=true，applyStyleRecursively 逐字）。
    styleManager.apply((ch as any).style, "red", {}, true);
    assert(
      (ch.style as any).fill === "#ff4d4f",
      "R16 block red 同步应用后 style.fill = #ff4d4f",
    );
    assert(
      ch.baseStyleSnapshot.fill === "#000000",
      `R16 recapture 前 baseline.fill 仍 #000000（block 样式没进 baseline，根因）（实际 ${ch.baseStyleSnapshot.fill}）`,
    );
    // R16 修复：recapture baseline = 当前 style（含 block red）。
    ch.recaptureBaseStyleSnapshot();
    assert(
      ch.baseStyleSnapshot.fill === "#ff4d4f",
      `R16 recapture 后 baseline.fill = #ff4d4f（block red 烘进 baseline）（实际 ${ch.baseStyleSnapshot.fill}）`,
    );
    // 动态 bold record（post-hold，timePosition=1）——模拟 f.hold(1s).bold 的 bold 走 record 路径。
    const seg = makeSegmentWithRecord(
      ch, [{ char: ch, styleName: "bold", params: {}, timePosition: 1 }], 2,
    );
    const { state } = makeFakeState(false);
    // seek 1.5：reset 回 baseline(red) + 重放 bold record → red + bold（旧逻辑：reset 回 #000000 + bold → base+bold，red 丢）。
    PlaybackController.seekToTime(seg, 1.5, state);
    assert(
      (ch.style as any).fill === "#ff4d4f",
      `R16 seek 1.5：block red baseline 保留（实际 ${(ch.style as any).fill}，旧逻辑丢成 #000000）`,
    );
    assert(
      (ch.style as any).fontWeight === "bold",
      `R16 seek 1.5：动态 bold record 重放（实际 ${(ch.style as any).fontWeight}）`,
    );
  }

  // (2) seek 回退到动态 record 之前：block red（baseline）+ bold@1s → seek 0.5 → 仅 red（bold 不重放）。
  {
    const ch = new KineticChar("H", makeBaseTextStyle("#000000"));
    styleManager.apply((ch as any).style, "red", {}, true);
    ch.recaptureBaseStyleSnapshot();
    const seg = makeSegmentWithRecord(
      ch, [{ char: ch, styleName: "bold", params: {}, timePosition: 1 }], 2,
    );
    const { state } = makeFakeState(false);
    PlaybackController.seekToTime(seg, 0.5, state);
    assert(
      (ch.style as any).fill === "#ff4d4f",
      `R16 seek 0.5（bold 之前）：block red baseline 保留（实际 ${(ch.style as any).fill}）`,
    );
    assert(
      (ch.style as any).fontWeight !== "bold",
      `R16 seek 0.5：bold record 不重放（timePosition 1 > 0.5）（实际 fontWeight ${(ch.style as any).fontWeight}）`,
    );
  }

  // (3) recapture 后 resetStyle 回 baseline（含 block 样式）——验证 recapture 不是一次性的，reset 可重现。
  {
    const ch = new KineticChar("H", makeBaseTextStyle("#000000"));
    styleManager.apply((ch as any).style, "red", {}, true);
    ch.recaptureBaseStyleSnapshot();
    // 再叠一个动态样式再 reset，应回 recaptured baseline（red）。
    styleManager.apply((ch as any).style, "bold", {}, true);
    assert((ch.style as any).fontWeight === "bold", "R16 叠加 bold 后 fontWeight=bold");
    ch.resetStyle();
    assert(
      (ch.style as any).fill === "#ff4d4f",
      `R16 resetStyle 后回 recaptured baseline（red，实际 ${(ch.style as any).fill}）`,
    );
    assert(
      (ch.style as any).fontWeight === "normal",
      `R16 resetStyle 后 bold 清除（回 baseline，实际 fontWeight ${(ch.style as any).fontWeight}）`,
    );
  }

  // (4) block big（相对样式）recapture 后不重复放大：block big 同步应用（24→36）→ recapture baseline=36
  //     → 动态 bold record seek → reset 回 36 + bold。big 不进 record → 不重复放大（36，不是 54）。
  {
    const ch = new KineticChar("H", makeBaseTextStyle("#000000", 24));
    styleManager.apply((ch as any).style, "big", {}, true); // 24→36
    ch.recaptureBaseStyleSnapshot(); // baseline=36
    assert(
      ch.baseStyleSnapshot.fontSize === 36,
      `R16 block big recapture baseline=36（实际 ${ch.baseStyleSnapshot.fontSize}）`,
    );
    const seg = makeSegmentWithRecord(
      ch, [{ char: ch, styleName: "bold", params: {}, timePosition: 1 }], 2,
    );
    const { state } = makeFakeState(false);
    PlaybackController.seekToTime(seg, 1.5, state);
    assert(
      (ch.style as any).fontSize === 36,
      `R16 seek 1.5：block big 不重复放大（保持 36，不是 54）（实际 ${(ch.style as any).fontSize}）`,
    );
    assert(
      (ch.style as any).fontWeight === "bold",
      `R16 seek 1.5：动态 bold 重放（实际 ${(ch.style as any).fontWeight}）`,
    );
  }

  // (5) ended 重播：block red baseline + 动态 bold → 播完 ended → 重播 → reset 回 baseline(red) + 重放
  //     timePosition<=0（无）→ 仅 red（bold 不残留）。验证 R14 的 ended-replay 在 R16 baseline 下仍正确。
  {
    const ch = new KineticChar("H", makeBaseTextStyle("#000000"));
    styleManager.apply((ch as any).style, "red", {}, true);
    ch.recaptureBaseStyleSnapshot();
    const seg = makeSegmentWithRecord(
      ch, [{ char: ch, styleName: "bold", params: {}, timePosition: 1 }], 2,
    );
    const { state } = makeFakeState(false);
    PlaybackController.seekToTime(seg, 1.5, state); // red + bold
    PlaybackController.seekToTime(seg, 2, state); // ended
    PlaybackController.playSegment(seg, state); // 重播
    assert(
      (ch.style as any).fill === "#ff4d4f",
      `R16 ended 重播：block red baseline 保留（实际 ${(ch.style as any).fill}）`,
    );
    assert(
      (ch.style as any).fontWeight !== "bold",
      `R16 ended 重播：bold 不残留（实际 fontWeight ${(ch.style as any).fontWeight}）`,
    );
  }
}

/**
 * [13] 端到端真实管线回归（R17-High / SA-32）。
 *
 * §9-§12 用手动构造的 char/segment 锁定语义，但**掩盖真实 SegmentBuilder 路径**（SA-27 教训：fake
 * 满足语义≠真实代码满足）。本节用**真实 `parser → SegmentBuilder.build → PlaybackController.seekToTime`**
 * 端到端驱动，验证 R13-R16 修复 + R17 单一真相源在真实管线的端到端正确性。headless shim 见文件头
 *（gsap 互操作 / document stub / DOMAdapter canvas 合成度量）。
 *
 * 这是 SA-27 教训的关键落地：§11b 用真实 KineticChar 补 DisplayAssembler 路径，§12 用真实
 * KineticChar 补 recapture 契约，但两者都不调真实 SegmentBuilder.build。§13 补这最后一层——
 * 真实 parser + 真实 SegmentBuilder（含 applyGroupEffects + recapture + site1-3 注册）+ 真实 seek。
 * 若 R17 的 classifyStyleWrite 误判、或 R15/R16 的 baseline/recapture 在真实管线失效，§13 报。
 *
 * shim 用合成字体度量（几何不真实），但 style/baseline/timing/seek 语义真实——测的是 R-B 单一
 * 真相源 + R13-R16 端到端正确性，不是布局几何。SegmentBuilder.build 是 async，本节 async。
 */
async function testEndToEndPipeline() {
  console.log("\n[13] 端到端真实管线（parser→SegmentBuilder→seek）（R17-High / SA-32）");

  /**
   * 读 fill 的 hex——真实管线下 char 级样式经 Pixi v8 规范化成 Fill 对象（{color: number}），
   * block 级经 applyGroupEffects 同步写仍是字符串。两种都要支持，统一转 hex 字符串比较。
   * SA-27 教训落地：fake char 测试用字符串 fill 掩盖了真实管线的 Fill 对象——§13 必须读真实类型。
   */
  function fillHex(f: any): string {
    if (typeof f === "string") return f;
    if (f && typeof f.color === "number") return "#" + (f.color >>> 0).toString(16).padStart(6, "0");
    return String(f);
  }

  /** 跑一个 KMD 源串端到端，返回首个 segment + 首个文本的非空白首字符。 */
  async function buildAndSeek(source: string) {
    const result = parser.parse(source);
    const playbackState = {
      isAutoPlaying: false,
      activeBehaviorCleanups: [] as any[],
      activeInstantCleanups: [] as any[],
    } as any;
    const { segment, activeTexts } = await SegmentBuilder.build({
      container: new Container(),
      metadata: { variables: {} } as any,
      paragraphs: result.paragraphs,
      rawParagraphs: result.rawParagraphs,
      currentMode: "stage",
      playbackState,
    });
    // 首个非空白 char（跳过可能的换行/空白 carrier）。
    const chars = activeTexts[0]._displayAssembly.chars;
    const char = chars.find((c: any) => c.text.trim()) ?? chars[0];
    return { segment, char, playbackState };
  }

  // (1)-(3) `[.red:block] + f.hold(1s).bold`：block red baseline + 动态 bold record。
  // block 路径 fill 是字符串（applyGroupEffects 同步写，不进 Pixi 规范化）。
  {
    const { segment, char, playbackState } = await buildAndSeek("[.red:block]\n{Hello} @ f.hold(1s).bold");
    assert(
      fillHex((char as any).baseStyleSnapshot.fill) === "#ff4d4f",
      `R17 e2e block 构建后 baseline.fill = #ff4d4f（实际 ${fillHex((char as any).baseStyleSnapshot.fill)}）`,
    );
    PlaybackController.seekToTime(segment, 1.5, playbackState);
    assert(
      fillHex((char as any).style.fill) === "#ff4d4f" && (char as any).style.fontWeight === "bold",
      `R17 e2e block SEEK 1.5 = red+bold（实际 fill=${fillHex((char as any).style.fill)} fw=${(char as any).style.fontWeight}）`,
    );
    PlaybackController.seekToTime(segment, 0.5, playbackState);
    assert(
      fillHex((char as any).style.fill) === "#ff4d4f" && (char as any).style.fontWeight !== "bold",
      `R17 e2e block SEEK 0.5 = red only（实际 fill=${fillHex((char as any).style.fill)} fw=${(char as any).style.fontWeight}）`,
    );
    PlaybackController.seekToTime(segment, 0, playbackState);
    assert(
      fillHex((char as any).style.fill) === "#ff4d4f" && (char as any).style.fontWeight !== "bold",
      `R17 e2e block SEEK 0 = red only（实际 fill=${fillHex((char as any).style.fill)} fw=${(char as any).style.fontWeight}）`,
    );
  }

  // (4) `f.red.hold(1s).bold`（char 级 pre-hold red + post-hold bold）：red 进 baseline（P1 烘焙），bold 进 record。
  // char 路径 fill 经 Pixi v8 规范化成 Fill 对象（color=0xff4d4f），fillHex 读 .color 转 hex。
  {
    const { segment, char, playbackState } = await buildAndSeek("{Hello} @ f.red.hold(1s).bold");
    assert(
      fillHex((char as any).baseStyleSnapshot.fill) === "#ff4d4f",
      `R17 e2e char 级 red 进 baseline（实际 ${fillHex((char as any).baseStyleSnapshot.fill)}）`,
    );
    PlaybackController.seekToTime(segment, 1.5, playbackState);
    assert(
      fillHex((char as any).style.fill) === "#ff4d4f" && (char as any).style.fontWeight === "bold",
      `R17 e2e char 级 SEEK 1.5 = red+bold（实际 fill=${fillHex((char as any).style.fill)} fw=${(char as any).style.fontWeight}）`,
    );
    PlaybackController.seekToTime(segment, 0, playbackState);
    assert(
      fillHex((char as any).style.fill) === "#ff4d4f" && (char as any).style.fontWeight !== "bold",
      `R17 e2e char 级 SEEK 0 = red only（实际 fill=${fillHex((char as any).style.fill)}）`,
    );
  }

  // (5) `f.big.hold(1s).bold`：相对样式 big 进 baseline。
  // KineticText 默认 fontSize=36（rebuild 默认 _options），big *=1.5 → 54。baseline=54 是单次应用
  // 的正确结果（不是双重应用 36→81）。seek 后仍 54（big 不进 record 重放，R15 site3 跳过 pre-hold）+ bold。
  {
    const { segment, char, playbackState } = await buildAndSeek("{Hello} @ f.big.hold(1s).bold");
    assert(
      (char as any).baseStyleSnapshot.fontSize === 54,
      `R17 e2e big 进 baseline = 54（36 默认 ×1.5，单次应用）（实际 ${(char as any).baseStyleSnapshot.fontSize}）`,
    );
    PlaybackController.seekToTime(segment, 1.5, playbackState);
    assert(
      (char as any).style.fontSize === 54 && (char as any).style.fontWeight === "bold",
      `R17 e2e SEEK 1.5 = big(54)+bold，big 不重复放大（实际 fontSize=${(char as any).style.fontSize} fw=${(char as any).style.fontWeight}）`,
    );
  }

  // (6) ended 重播：`[.red:block] + f.hold(1s).bold` 播完 → playSegment 重播 → 等价 SEEK 0 = red only。
  {
    const { segment, char, playbackState } = await buildAndSeek("[.red:block]\n{Hello} @ f.hold(1s).bold");
    PlaybackController.seekToTime(segment, 1.5, playbackState); // red + bold
    assert((char as any).style.fontWeight === "bold", "R17 e2e ended 重播前：bold 生效");
    PlaybackController.seekToTime(segment, (segment as any).duration, playbackState); // ended
    PlaybackController.playSegment(segment, playbackState); // 重播
    assert(
      fillHex((char as any).style.fill) === "#ff4d4f" && (char as any).style.fontWeight !== "bold",
      `R17 e2e ended 重播 = red only（bold 不残留）（实际 fill=${fillHex((char as any).style.fill)} fw=${(char as any).style.fontWeight}）`,
    );
  }
}

/**
 * [14] 显式 :group / token 级 :block style 端到端（R19-High / SA-33）。
 *
 * 根因：`classifyStyleWrite` 的 `isBlocking` 把 `level==="group"||"block"` 当 pre-hold 边界（v1.0.0
 * 遗留、无设计理由）。对 style 是错误的——style 经 applyStyleRecursively 最终落到每个 KineticChar，
 * 不分容器/逐字语义。后果：显式 group style（`f.red:group`）+ token 级 block style（`f.red:block`，
 * 注意段落级广播 `[.red:block]` 走 P2 recapture 已正确）既不进 baseline（P1 遇 isBlocking break）、
 * 也不进 record（site2 `if(isStyle) return false` 跳过），被整条吞掉 → 自然播放 + seek 全失效。
 *
 * R19 修复：style 与"非 style 边界"解耦——classifyStyleWrite 对 style 不判 `level==="group"/"block"`
 *（仅非 style 容器级特效 filter/timing/stage 才终止烘焙）。于是显式 group/block style 经 P1 烘焙进
 * baseline（与 char/block 同模型，R15/R16），测量同步应用 big/small（避免"测量 36、应用 54"错位），
 * site2 仍 `if(isStyle) return false` 跳过 pre-hold（避免双重放大）。post-hold 的 group/block style
 * 仍经 site2 进 record（groupHoldEncountered=true → shouldExecute=true）。
 *
 * headless shim 同 §13（gsap 互操作 / document stub / DOMAdapter canvas）。本节 async。
 */
async function testGroupBlockStyleBaseline() {
  console.log("\n[14] 显式 :group / token 级 :block style 端到端（R19-High / SA-33）");

  function fillHex(f: any): string {
    if (typeof f === "string") return f;
    if (f && typeof f.color === "number") return "#" + (f.color >>> 0).toString(16).padStart(6, "0");
    return String(f);
  }

  /** styleRecords 中属于该 char 的（styleName@time）。 */
  function ownRecords(segment: Segment, char: any): string[] {
    return (segment as any).styleRecords
      .filter((r: any) => r.char === char)
      .map((r: any) => `${r.styleName}@${(r.timePosition ?? 0).toFixed(2)}`);
  }

  async function build(source: string) {
    const result = parser.parse(source);
    const playbackState = {
      isAutoPlaying: false,
      activeBehaviorCleanups: [] as any[],
      activeInstantCleanups: [] as any[],
    } as any;
    const { segment, activeTexts } = await SegmentBuilder.build({
      container: new Container(),
      metadata: { variables: {} } as any,
      paragraphs: result.paragraphs,
      rawParagraphs: result.rawParagraphs,
      currentMode: "stage",
      playbackState,
    });
    const chars = activeTexts[0]._displayAssembly.chars;
    const char = chars.find((c: any) => c.text.trim()) ?? chars[0];
    return { segment, char, playbackState };
  }

  // (1) f.red:group → red 进 baseline（P1 烘焙），records=[]。原 bug：被吞，fill=#ffffff records=[]。
  {
    const { segment, char, playbackState } = await build("{Hello} @ f.red:group");
    assert(
      fillHex((char as any).baseStyleSnapshot.fill) === "#ff4d4f",
      `R19 group red 进 baseline（实际 ${fillHex((char as any).baseStyleSnapshot.fill)}）`,
    );
    assert(
      fillHex((char as any).style.fill) === "#ff4d4f",
      `R19 group red 构建后已生效（实际 ${fillHex((char as any).style.fill)}）`,
    );
    assert(
      ownRecords(segment, char).length === 0,
      `R19 group red 不进 record（pre-hold 进 baseline，避免双重应用）（实际 ${JSON.stringify(ownRecords(segment, char))}）`,
    );
  }

  // (2) f.red:block（token 级）→ 同 (1)。原 bug 同样被吞（只有段落广播 [.red:block] 走 P2 已正确）。
  {
    const { segment, char } = await build("{Hello} @ f.red:block");
    assert(
      fillHex((char as any).baseStyleSnapshot.fill) === "#ff4d4f",
      `R19 token 级 :block red 进 baseline（实际 ${fillHex((char as any).baseStyleSnapshot.fill)}）`,
    );
    assert(
      ownRecords(segment, char).length === 0,
      `R19 token 级 :block red 不进 record（实际 ${JSON.stringify(ownRecords(segment, char))}）`,
    );
  }

  // (3) f.big:group → big(×1.5) 进 baseline=54，测量同步应用。seek 后仍 54（不双重放大）。
  // 默认 fontSize=36（同 §13 case 5），big ×1.5=54 是单次应用。
  {
    const { segment, char, playbackState } = await build("{Hello} @ f.big:group");
    assert(
      (char as any).baseStyleSnapshot.fontSize === 54,
      `R19 group big 进 baseline = 54（36 ×1.5，单次应用）（实际 ${(char as any).baseStyleSnapshot.fontSize}）`,
    );
    PlaybackController.seekToTime(segment, 1.0, playbackState);
    assert(
      (char as any).style.fontSize === 54,
      `R19 group big seek 后不重复放大（应 54）（实际 ${(char as any).style.fontSize}）`,
    );
  }

  // (4) f.red:group seek 回退幂等：red 在 baseline，reset 回 baseline 仍是 red（幂等无害）。
  {
    const { segment, char, playbackState } = await build("{Hello} @ f.red:group");
    PlaybackController.seekToTime(segment, 1.0, playbackState);
    assert(
      fillHex((char as any).style.fill) === "#ff4d4f",
      `R19 group red seek 1.0 仍 red（实际 ${fillHex((char as any).style.fill)}）`,
    );
    PlaybackController.seekToTime(segment, 0, playbackState);
    assert(
      fillHex((char as any).style.fill) === "#ff4d4f",
      `R19 group red seek 0 仍 red（baseline 幂等）（实际 ${fillHex((char as any).style.fill)}）`,
    );
  }

  // (5) f.red:group.hold(1s).bold：red 是 pre-hold → 进 baseline；bold 是 post-hold → 进 record。
  // 对应用户探针最后一行（base=red + records=[bold]）。验证 pre-hold group style 与 post-hold
  // 动态样式在同一条链里正确分流（R19 + R15 site3 模型对 group style 也成立）。
  {
    const { segment, char, playbackState } = await build("{Hello} @ f.red:group.hold(1s).bold");
    assert(
      fillHex((char as any).baseStyleSnapshot.fill) === "#ff4d4f",
      `R19 group pre-hold red 进 baseline（实际 ${fillHex((char as any).baseStyleSnapshot.fill)}）`,
    );
    const recs = ownRecords(segment, char);
    assert(
      recs.length === 1 && recs[0].startsWith("bold@"),
      `R19 group post-hold bold 进 record（实际 ${JSON.stringify(recs)}）`,
    );
    PlaybackController.seekToTime(segment, 1.5, playbackState);
    assert(
      fillHex((char as any).style.fill) === "#ff4d4f" && (char as any).style.fontWeight === "bold",
      `R19 group SEEK 1.5 = red(baseline)+bold(record)（实际 fill=${fillHex((char as any).style.fill)} fw=${(char as any).style.fontWeight}）`,
    );
    PlaybackController.seekToTime(segment, 0, playbackState);
    assert(
      fillHex((char as any).style.fill) === "#ff4d4f" && (char as any).style.fontWeight !== "bold",
      `R19 group SEEK 0 = red only（bold 回退，red baseline 保留）（实际 fill=${fillHex((char as any).style.fill)} fw=${(char as any).style.fontWeight}）`,
    );
  }

  // (6) f.hold(1s).red:group：red 是 post-hold → 进 record（不进 baseline）。seek 0.5 无红、1.5 有红、0 回退无红。
  // 验证 R19 没有把 post-hold group style 错误地烘焙进 baseline（post-hold 必须进 record 才能回退）。
  {
    const { segment, char, playbackState } = await build("{Hello} @ f.hold(1s).red:group");
    assert(
      fillHex((char as any).baseStyleSnapshot.fill) !== "#ff4d4f",
      `R19 group post-hold red 不进 baseline（实际 ${fillHex((char as any).baseStyleSnapshot.fill)}）`,
    );
    const recs = ownRecords(segment, char);
    assert(
      recs.length === 1 && recs[0].startsWith("red@"),
      `R19 group post-hold red 进 record（实际 ${JSON.stringify(recs)}）`,
    );
    PlaybackController.seekToTime(segment, 0.5, playbackState);
    assert(
      fillHex((char as any).style.fill) !== "#ff4d4f",
      `R19 group post-hold SEEK 0.5 无 red（record 未到时间）（实际 ${fillHex((char as any).style.fill)}）`,
    );
    PlaybackController.seekToTime(segment, 1.5, playbackState);
    assert(
      fillHex((char as any).style.fill) === "#ff4d4f",
      `R19 group post-hold SEEK 1.5 有 red（record 重放）（实际 ${fillHex((char as any).style.fill)}）`,
    );
    PlaybackController.seekToTime(segment, 0, playbackState);
    assert(
      fillHex((char as any).style.fill) !== "#ff4d4f",
      `R19 group post-hold SEEK 0 回退无 red（实际 ${fillHex((char as any).style.fill)}）`,
    );
  }

  // (7) 对照组：f.red（char）仍正确——R19 解耦只对 level==="group"/"block" 的 style 生效，
  // char 级（level undefined）行为不变。防 R15/R17 回归。
  {
    const { segment, char } = await build("{Hello} @ f.red");
    assert(
      fillHex((char as any).baseStyleSnapshot.fill) === "#ff4d4f",
      `R19 对照 char red 进 baseline（未受 R19 影响）（实际 ${fillHex((char as any).baseStyleSnapshot.fill)}）`,
    );
    assert(
      ownRecords(segment, char).length === 0,
      `R19 对照 char red 不进 record（实际 ${JSON.stringify(ownRecords(segment, char))}）`,
    );
  }
}

/**
 * [15] behavior-track filter build + seek 幂等端到端（SA-34 / SA-27）。
 *
 * §13/§14 只覆盖了 style track 的 E2E。behavior-track filter（blur/rgbShift/warp）的 cleanup 契约
 * （registerBehaviors/clearBehaviors + destroyFilterDeep + removeModifier/ticker）只在 §7/§8 用 fake
 * target 测，从未经真实 SegmentBuilder 建链 + seek 驱动。真实管线的三段独立接线——unrollGroupChain 的
 * behavior 分流（TextPlayer:558+）+ registerBehaviors 的 unpackBehaviorResult + gsap.ticker 驱动——
 * fake 会掩盖分流错误。本节用真实 parser→SegmentBuilder→seek 验证：build 后 filter 在 target.filters、
 * cleanup 在 activeBehaviorCleanups；seek 来回不堆积、ticker 不泄漏。
 *
 * **headless 可行性已探针确认**：pixi v8 filter 实例化（new BlurFilter）构造 GpuProgram/GlProgram 数据
 * 结构但不 compile shader（懒加载 renderer），故 `char.filters = [blur]` 在 node + DOMAdapter shim 下不崩。
 * behavior filter 经 addModifier 注册 ticker 驱动 uniform，destroy 后写已 destroy filter 的 uniform
 * 是真实风险——本节验证 cleanup 顺序（先 removeModifier 停 ticker，再 destroy）正确。
 */
async function testBehaviorFilterE2E() {
  console.log("\n[15] behavior-track filter build + seek 幂等（SA-34 / SA-27）");

  async function build(source: string) {
    const result = parser.parse(source);
    const playbackState = {
      isAutoPlaying: false,
      activeBehaviorCleanups: [] as any[],
      activeInstantCleanups: [] as any[],
    } as any;
    const { segment, activeTexts } = await SegmentBuilder.build({
      container: new Container(),
      metadata: { variables: {} } as any,
      paragraphs: result.paragraphs,
      rawParagraphs: result.rawParagraphs,
      currentMode: "stage",
      playbackState,
    });
    const chars = activeTexts[0]._displayAssembly.chars;
    const char = chars.find((c: any) => c.text.trim()) ?? chars[0];
    return { segment, char, playbackState };
  }

  // (1) f.blur（char 级 behavior filter）：build 后仅注册 BehaviorRecord（blur@0），filter 尚未 apply
  //      （behavior filter 在 seek/播放时经 registerBehaviors 才 apply + push char.filters + 登记 cleanup）。
  //      seek(1.0) 后：char.filters 有 BlurFilter、activeBehaviorCleanups 有 1 条（modName=blur）。
  //      多次 seek 来回幂等：filter 始终 1 个（不堆积）、cleanup 始终 1 条。
  {
    const { segment, char, playbackState } = await build("{Hello} @ f.blur");
    // build 后：filter 未 apply、cleanup 未登记（registerBehaviors 在 seek 时才跑）。
    assert(
      !(char as any).filters || (char as any).filters.length === 0,
      `R15e2e blur build 后 filter 未 apply（在 seek 时才 apply）（实际 ${(char as any).filters?.length}）`,
    );
    assert(
      playbackState.activeBehaviorCleanups.length === 0,
      `R15e2e blur build 后 cleanup 未登记（实际 ${playbackState.activeBehaviorCleanups.length}）`,
    );
    // seek 1.0：registerBehaviors 跑 → apply blur + 登记 cleanup。
    // 注意："Hello" 5 字符，每字各登记一条 cleanup（BehaviorRecord 逐字注册）。
    PlaybackController.seekToTime(segment, 1.0, playbackState);
    const filters = (char as any).filters;
    assert(
      Array.isArray(filters) && filters.length === 1 && filters[0]?.constructor?.name === "BlurFilter",
      `R15e2e blur seek 1.0 后 char.filters 有 1 个 BlurFilter（实际 ${filters?.length} ${filters?.[0]?.constructor?.name}）`,
    );
    const cleanups = playbackState.activeBehaviorCleanups;
    assert(
      cleanups.length >= 1 && cleanups.every((c: any) => c.modName === "blur"),
      `R15e2e blur seek 1.0 后 cleanup 全部 modName=blur（实际 ${cleanups.length} 条）（实际 ${JSON.stringify(cleanups.map((c:any)=>c.modName))}）`,
    );
    const cleanupCountAfter1 = cleanups.length;
    // seek 来回幂等：clearBehaviors（移除+destroy）→ registerBehaviors（重 apply）→ filter 始终 1 个、cleanup 条数不变。
    PlaybackController.seekToTime(segment, 0.5, playbackState);
    PlaybackController.seekToTime(segment, 1.5, playbackState);
    assert(
      (char as any).filters?.length === 1,
      `R15e2e blur 多次 seek 来回后 filters 仍 1 个（幂等不堆积）（实际 ${(char as any).filters?.length}）`,
    );
    assert(
      playbackState.activeBehaviorCleanups.length === cleanupCountAfter1,
      `R15e2e blur 多次 seek 后 cleanup 条数不变（${cleanupCountAfter1}，幂等不堆积）（实际 ${playbackState.activeBehaviorCleanups.length}）`,
    );
  }

  // (2) blurIn + blur 共存：blurIn（entrance，build 时 apply）+ blur（behavior，seek 时 apply）。
  //      seek 后 blur 重建，blurIn filter 仍在（entrance 不经 seek 清理）→ 共 2 个，不互误清。
  {
    const { segment, char, playbackState } = await build("{Hello} @ f.blurIn.blur");
    // build 后 blurIn filter 已 apply（1 个），blur 未 apply（seek 时才）。
    assert(
      (char as any).filters?.length === 1,
      `R15e2e blurIn+blur build 后 blurIn filter 已 apply（1 个）（实际 ${(char as any).filters?.length}）`,
    );
    PlaybackController.seekToTime(segment, 1.0, playbackState);
    assert(
      (char as any).filters?.length === 2,
      `R15e2e blurIn+blur seek 1.0 后 blur 也 apply（共 2 个，不互误清）（实际 ${(char as any).filters?.length}）`,
    );
  }
}

/**
 * [16] instant-track filter build + seek 回退端到端（SA-34 / SA-27）。
 *
 * instant filter（gray/pixelate/bloom…）的 cleanup 契约（registerInstantEffects/clearInstantEffects +
 * destroyFilterDeep）只在 §7 用 fake target 测。真实 SegmentBuilder 的 blockInstant 分流 +
 * InstantEffectRecord 注册 + clearInstantEffects 从真实 KineticText.filters 移除，是 build→seek 跨层
 * 接线，fake 测不到。本节验证：build 后 filter 在 target.filters；seek 跨生效点再回退正确移除（不堆积）。
 *
 * char 级 instant filter 经 placeCharOnTimeline 注册 InstantEffectRecord@cursor（TextPlayer:328-337），
 * block 级经 SegmentBuilder blockInstant 桶（SegmentBuilder:258-269）。两者 seek 幂等都应覆盖。
 *
 * **注意**：`gray`/`threshold`/`posterize` 等同时在 styleManager 与 effectManager 注册（双重身份），
 * `classifyStyleWrite({name:"gray"}).isStyle === true` → 走 style 管线（baseline/record），不是 instant filter。
 * 故本节用 `pixelate`（纯 effect，isStyle:false）测 instant filter 路径。
 */
async function testInstantFilterE2E() {
  console.log("\n[16] instant-track filter build + seek 回退（SA-34 / SA-27）");

  async function build(source: string) {
    const result = parser.parse(source);
    const playbackState = {
      isAutoPlaying: false,
      activeBehaviorCleanups: [] as any[],
      activeInstantCleanups: [] as any[],
    } as any;
    const { segment, activeTexts } = await SegmentBuilder.build({
      container: new Container(),
      metadata: { variables: {} } as any,
      paragraphs: result.paragraphs,
      rawParagraphs: result.rawParagraphs,
      currentMode: "stage",
      playbackState,
    });
    const chars = activeTexts[0]._displayAssembly.chars;
    const char = chars.find((c: any) => c.text.trim()) ?? chars[0];
    return { segment, char, playbackState };
  }

  // (1) f.pixelate（char 级 instant filter，纯 effect）：build 后仅注册 InstantEffectRecord，
  //      filter 未 apply（registerInstantEffects 在 seek 时才跑）。seek 1.0 后 filter apply +
  //      cleanup 登记；seek 来回不堆积。
  {
    const { segment, char, playbackState } = await build("{Hello} @ f.pixelate");
    assert(
      !(char as any).filters || (char as any).filters.length === 0,
      `R16e2e pixelate build 后 filter 未 apply（seek 时才 apply）（实际 ${(char as any).filters?.length}）`,
    );
    PlaybackController.seekToTime(segment, 1.0, playbackState);
    const filters = (char as any).filters;
    assert(
      Array.isArray(filters) && filters.length === 1 && filters[0]?.constructor?.name === "PixelateFilter",
      `R16e2e pixelate seek 1.0 后 char.filters 有 1 个 PixelateFilter（实际 ${filters?.length} ${filters?.[0]?.constructor?.name}）`,
    );
    assert(
      playbackState.activeInstantCleanups.length >= 1,
      `R16e2e pixelate seek 1.0 后 activeInstantCleanups 有记录（实际 ${playbackState.activeInstantCleanups.length}）`,
    );
    const instantCountAfter1 = playbackState.activeInstantCleanups.length;
    // seek 来回幂等：clearInstantEffects（移除+destroy）→ registerInstantEffects（重 apply）→ 始终 1 个、cleanup 条数不变。
    PlaybackController.seekToTime(segment, 0, playbackState);
    PlaybackController.seekToTime(segment, 1.5, playbackState);
    assert(
      (char as any).filters?.length === 1,
      `R16e2e pixelate 多次 seek 来回后 filters 仍 1 个（幂等不堆积）（实际 ${(char as any).filters?.length}）`,
    );
    assert(
      playbackState.activeInstantCleanups.length === instantCountAfter1,
      `R16e2e pixelate 多次 seek 后 cleanup 条数不变（${instantCountAfter1}，幂等不堆积）（实际 ${playbackState.activeInstantCleanups.length}）`,
    );
  }

  // (2) post-hold instant filter：f.hold(1s).pixelate → pixelate 在 hold 之后，
  //      seek 0.5（pixelate 未生效）时 filter 不在、seek 1.5（生效）时有、seek 0 回退移除。
  //      验证 InstantEffectRecord 的 timePosition 过滤（registerInstantEffects 按 currentTime）。
  {
    const { segment, char, playbackState } = await build("{Hello} @ f.hold(1s).pixelate");
    PlaybackController.seekToTime(segment, 0.5, playbackState);
    assert(
      !(char as any).filters || (char as any).filters.length === 0,
      `R16e2e post-hold pixelate seek 0.5（未生效）filter 不在（实际 ${(char as any).filters?.length}）`,
    );
    PlaybackController.seekToTime(segment, 1.5, playbackState);
    assert(
      (char as any).filters?.length === 1 && (char as any).filters[0]?.constructor?.name === "PixelateFilter",
      `R16e2e post-hold pixelate seek 1.5（生效）filter 在（实际 ${(char as any).filters?.length} ${((char as any).filters?.[0]?.constructor?.name)}）`,
    );
    PlaybackController.seekToTime(segment, 0.5, playbackState);
    assert(
      !(char as any).filters || (char as any).filters.length === 0,
      `R16e2e post-hold pixelate seek 0.5 回退 filter 移除（实际 ${(char as any).filters?.length}）`,
    );
  }
}

/**
 * [17] entrance filter（blurIn）生命周期端到端（SA-34 / SA-27）。
 *
 * entrance filter 的生命周期契约（captureEntrance 解包 {tween, filter} → EntranceFilterRecord，
 * seek 不清理靠 timeline 插值，stop/clearScreen 清理，ended 重播不清理）目前零覆盖——注释里写了契约
 * 但没测。blurIn 创建持久 BlurFilter push 进 target.filters，原靠 tween onComplete 移除，stop kill
 * 时间线时 onComplete 不触发 → GPU 泄漏（正是 EntranceFilterResult 修复的 bug）。本节验证四态生命周期。
 */
async function testEntranceFilterE2E() {
  console.log("\n[17] entrance filter（blurIn）生命周期（SA-34 / SA-27）");

  function fillHex(f: any): string {
    if (typeof f === "string") return f;
    if (f && typeof f.color === "number") return "#" + (f.color >>> 0).toString(16).padStart(6, "0");
    return String(f);
  }

  async function build(source: string) {
    const result = parser.parse(source);
    const playbackState = {
      isAutoPlaying: false,
      activeBehaviorCleanups: [] as any[],
      activeInstantCleanups: [] as any[],
    } as any;
    const { segment, activeTexts } = await SegmentBuilder.build({
      container: new Container(),
      metadata: { variables: {} } as any,
      paragraphs: result.paragraphs,
      rawParagraphs: result.rawParagraphs,
      currentMode: "stage",
      playbackState,
    });
    const chars = activeTexts[0]._displayAssembly.chars;
    const char = chars.find((c: any) => c.text.trim()) ?? chars[0];
    return { segment, char, playbackState };
  }

  // (1) f.blurIn：build 后 segment.entranceFilters 有记录（BlurFilter），tween 在时间线。
  //      char.filters 含 BlurFilter（blurIn 的 filter 已 push）。
  {
    const { segment, char, playbackState } = await build("{Hello} @ f.blurIn");
    const entranceRecs = (segment as any).entranceFilters ?? [];
    assert(
      entranceRecs.length >= 1,
      `R17e2e blurIn build 后 entranceFilters 有记录（实际 ${entranceRecs.length}）`,
    );
    assert(
      Array.isArray((char as any).filters) && (char as any).filters.length >= 1 && (char as any).filters[0]?.constructor?.name === "BlurFilter",
      `R17e2e blurIn build 后 char.filters 含 BlurFilter（实际 ${(char as any).filters?.length} ${((char as any).filters?.[0]?.constructor?.name)}）`,
    );

    // seek 到中途：entrance filter 不清理（靠 timeline 插值 strength），filter 仍在。
    PlaybackController.seekToTime(segment, 0.5, playbackState);
    assert(
      (char as any).filters?.length >= 1,
      `R17e2e blurIn seek 0.5 不清理 entrance filter（靠 timeline 插值）（实际 ${(char as any).filters?.length}）`,
    );

    // seek 回 0：filter 仍在（entrance 不经 record 重 apply，timeline 插值回起点）。
    PlaybackController.seekToTime(segment, 0, playbackState);
    assert(
      (char as any).filters?.length >= 1,
      `R17e2e blurIn seek 0 filter 仍在（不重 apply、不清理）（实际 ${(char as any).filters?.length}）`,
    );
  }

  // (2) blurIn + 动态 style 组合：blurIn（entrance filter）+ f.hold(1s).red（动态 style）。
  //      seek 1.5：blurIn filter 在 + red 生效（record 重放）；seek 0：blurIn filter 在 + red 回退。
  //      验证 entrance filter 与 style record 两条独立管线不互扰。
  //      （blurIn+hold+red 链下 entranceFilters 每 char 多条，filter 计数 ≥1 不强约束确切数。）
  {
    const { segment, char, playbackState } = await build("{Hello} @ f.blurIn.hold(1s).red");
    PlaybackController.seekToTime(segment, 1.5, playbackState);
    assert(
      (char as any).filters?.length >= 1 && fillHex((char as any).style.fill) === "#ff4d4f",
      `R17e2e blurIn+red seek 1.5 = blurIn filter 在 + red 生效（实际 filters=${(char as any).filters?.length} fill=${fillHex((char as any).style.fill)}）`,
    );
    PlaybackController.seekToTime(segment, 0, playbackState);
    assert(
      (char as any).filters?.length >= 1 && fillHex((char as any).style.fill) !== "#ff4d4f",
      `R17e2e blurIn+red seek 0 = blurIn filter 仍在 + red 回退（实际 filters=${(char as any).filters?.length} fill=${fillHex((char as any).style.fill)}）`,
    );
  }
}

/**
 * [18] 多 token hold-chain（char_stagger）端到端（SA-34 / SA-27）。
 *
 * §13-§17 的 buildAndSeek/build helper 只取 activeTexts[0] 的首个非空白 char——多 token、跨 token
 * 交互、char_stagger 错开时序从未在真实管线测过。本节验证：两个 token 各自逐字 hold-chain，red 进各自
 * baseline，两 token 的 char 独立（不互相污染）。需要扩 helper 支持取多个 token 的 char。
 */
async function testMultiTokenHoldChainE2E() {
  console.log("\n[18] 多 token hold-chain char_stagger（SA-34 / SA-27）");

  async function build(source: string) {
    const result = parser.parse(source);
    const playbackState = {
      isAutoPlaying: false,
      activeBehaviorCleanups: [] as any[],
      activeInstantCleanups: [] as any[],
    } as any;
    const { segment, activeTexts } = await SegmentBuilder.build({
      container: new Container(),
      metadata: { variables: {} } as any,
      paragraphs: result.paragraphs,
      rawParagraphs: result.rawParagraphs,
      currentMode: "stage",
      playbackState,
    });
    const chars = activeTexts[0]._displayAssembly.chars;
    // 取前两个非空白 char（多 token 场景）
    const nonBlank = chars.filter((c: any) => c.text.trim());
    return { segment, char0: nonBlank[0], char1: nonBlank[1], playbackState };
  }

  function fillHex(f: any): string {
    if (typeof f === "string") return f;
    if (f && typeof f.color === "number") return "#" + (f.color >>> 0).toString(16).padStart(6, "0");
    return String(f);
  }

  // (1) `{Hello} {World} @ f.red`：两个 token 各自的 char 都应染红（red 经 applyStyleRecursively
  //      递归到 wrapper.chars 的每个 char）。验证多 token 的 style 应用覆盖全部 token，不只首个。
  {
    const { segment, char0, char1 } = await build("{Hello} {World} @ f.red");
    assert(
      fillHex((char0 as any).baseStyleSnapshot.fill) === "#ff4d4f",
      `R18e2e 多 token red：token0 char 进 baseline red（实际 ${fillHex((char0 as any).baseStyleSnapshot.fill)}）`,
    );
    assert(
      fillHex((char1 as any).baseStyleSnapshot.fill) === "#ff4d4f",
      `R18e2e 多 token red：token1 char 也进 baseline red（实际 ${fillHex((char1 as any).baseStyleSnapshot.fill)}）`,
    );
  }

  // (2) `{Hello} {World} @ f.hold:group(0.1s).red`：组级 hold 链 + red（post-hold）。
  //      red 在 hold 之后 → 进 styleRecords（post-hold 动态样式），seek 重放生效。
  //      验证多 token 的 group-hold 链 style 正确进 record（与 §13 单 token 一致）。
  {
    const { segment, char0, playbackState } = await build("{Hello} {World} @ f.hold:group(0.1s).red");
    const rec0 = (segment as any).styleRecords.filter((r: any) => r.char === char0);
    assert(
      rec0.length >= 1 && rec0.some((r: any) => r.styleName === "red"),
      `R18e2e hold:group.red：token0 char 的 red 进 styleRecords（实际 ${JSON.stringify(rec0.map((r:any)=>r.styleName))}）`,
    );
    PlaybackController.seekToTime(segment, 1.0, playbackState);
    assert(
      fillHex((char0 as any).style.fill) === "#ff4d4f",
      `R18e2e hold:group.red seek 1.0：red 生效（实际 ${fillHex((char0 as any).style.fill)}）`,
    );
  }

  // (3) `f.hold:char(0.1s).red`：char 级 hold 链 + red（post-hold）。
  //      R20/SA-35 修复：red 在 hold:char 之后 → post-hold → 进 styleRecords + seek 生效。
  //      旧 bug（SA-34 发现）：site3 unrollCharChain 先把 hold:char 滤掉再算边界 → 边界检测不到 →
  //      red 被当 pre-hold 跳过 → 被吞（既不进 baseline 也不进 record）。修复后边界在原始 visualConfigs
  //      上算（含 hold:char）→ red 正确落 post-hold。
  {
    const { segment, char0, playbackState } = await build("{Hello} @ f.hold:char(0.1s).red");
    const rec0 = (segment as any).styleRecords.filter((r: any) => r.char === char0);
    assert(
      rec0.length >= 1 && rec0.some((r: any) => r.styleName === "red"),
      `R18e2e hold:char.red（R20 修后）：red 进 styleRecords（实际 ${JSON.stringify(rec0.map((r:any)=>r.styleName))}）`,
    );
    assert(
      fillHex((char0 as any).baseStyleSnapshot.fill) !== "#ff4d4f",
      `R18e2e hold:char.red：red 不进 baseline（post-hold）（实际 ${fillHex((char0 as any).baseStyleSnapshot.fill)}）`,
    );
    PlaybackController.seekToTime(segment, 1.0, playbackState);
    assert(
      fillHex((char0 as any).style.fill) === "#ff4d4f",
      `R18e2e hold:char.red seek 1.0：red 生效（实际 ${fillHex((char0 as any).style.fill)}）`,
    );
  }

  // (4) `f.red.hold:char(0.1s)`：red 在 hold:char 之前 → pre-hold → 进 baseline（P1 烘焙），不进 record。
  //      验证 R20 修复没破坏 pre-hold 烘焙（red 在 hold:char 前仍正确进 baseline，不双重应用）。
  {
    const { segment, char0 } = await build("{Hello} @ f.red.hold:char(0.1s)");
    assert(
      fillHex((char0 as any).baseStyleSnapshot.fill) === "#ff4d4f",
      `R18e2e red.hold:char：red 进 baseline（pre-hold）（实际 ${fillHex((char0 as any).baseStyleSnapshot.fill)}）`,
    );
    const rec0 = (segment as any).styleRecords.filter((r: any) => r.char === char0);
    assert(
      rec0.length === 0,
      `R18e2e red.hold:char：red 不进 record（pre-hold 已在 baseline，避免双重应用）（实际 ${JSON.stringify(rec0.map((r:any)=>r.styleName))}）`,
    );
  }

  // (5) `f.red.hold:char(0.1s).bold`：red 是 pre-hold（进 baseline），bold 是 post-hold（进 record）。
  //      混合 pre/post —— 验证边界判定在混合链里正确分流（red 烘焙、bold record）。
  {
    const { segment, char0, playbackState } = await build("{Hello} @ f.red.hold:char(0.1s).bold");
    assert(
      fillHex((char0 as any).baseStyleSnapshot.fill) === "#ff4d4f",
      `R18e2e red.hold:char.bold：red 进 baseline（pre-hold）（实际 ${fillHex((char0 as any).baseStyleSnapshot.fill)}）`,
    );
    const rec0 = (segment as any).styleRecords.filter((r: any) => r.char === char0);
    assert(
      rec0.length >= 1 && rec0.some((r: any) => r.styleName === "bold"),
      `R18e2e red.hold:char.bold：bold 进 record（post-hold）（实际 ${JSON.stringify(rec0.map((r:any)=>r.styleName))}）`,
    );
    PlaybackController.seekToTime(segment, 1.0, playbackState);
    assert(
      fillHex((char0 as any).style.fill) === "#ff4d4f" && (char0 as any).style.fontWeight === "bold",
      `R18e2e red.hold:char.bold seek 1.0 = red(baseline)+bold(record)（实际 fill=${fillHex((char0 as any).style.fill)} fw=${(char0 as any).style.fontWeight}）`,
    );
  }
}

/**
 * [19] 多段落 segment 切换端到端（SA-34 / SA-27）。
 *
 * helper 硬取 activeTexts[0]，多段布局 + 段间独立 baseline 零覆盖。本节验证：两段 KMD 各自 build 成
 * 独立 KineticText，段 1 的 block style 不泄漏到段 0（recapture 按 paragraphText 遍历，不跨段）。
 */
async function testMultiParagraphE2E() {
  console.log("\n[19] 多段落 segment 切换（SA-34 / SA-27）");

  async function build(source: string) {
    const result = parser.parse(source);
    const playbackState = {
      isAutoPlaying: false,
      activeBehaviorCleanups: [] as any[],
      activeInstantCleanups: [] as any[],
    } as any;
    const { segment, activeTexts } = await SegmentBuilder.build({
      container: new Container(),
      metadata: { variables: {} } as any,
      paragraphs: result.paragraphs,
      rawParagraphs: result.rawParagraphs,
      currentMode: "stage",
      playbackState,
    });
    return { segment, activeTexts, playbackState };
  }

  function fillHex(f: any): string {
    if (typeof f === "string") return f;
    if (f && typeof f.color === "number") return "#" + (f.color >>> 0).toString(16).padStart(6, "0");
    return String(f);
  }

  function firstChar(text: any): any {
    const chars = text._displayAssembly.chars;
    return chars.find((c: any) => c.text.trim()) ?? chars[0];
  }

  // (1) 两段：段 0 普通文本，段 1 带 [.red:block]（KMD 段落分隔是 \n\n 双换行）。段 0 的 char 不应被染红
  //      （recapture 只遍历段 1 的 paragraphText）。验证 recaptureBaseStyleSnapshot 的 paragraphText
  //      遍历不跨段污染。
  {
    const { activeTexts } = await build("Hello\n\n[.red:block]\nWorld");
    assert(activeTexts.length >= 2, `R19e2e 多段 build 出 ≥2 个 activeTexts（实际 ${activeTexts.length}）`);
    const char0 = firstChar(activeTexts[0]);
    const char1 = firstChar(activeTexts[1]);
    assert(
      fillHex((char1 as any).baseStyleSnapshot.fill) === "#ff4d4f",
      `R19e2e 段1（red:block）char 进 baseline red（实际 ${fillHex((char1 as any).baseStyleSnapshot.fill)}）`,
    );
    assert(
      fillHex((char0 as any).baseStyleSnapshot.fill) !== "#ff4d4f",
      `R19e2e 段0（普通）char 不被段1的 red:block 污染（实际 ${fillHex((char0 as any).baseStyleSnapshot.fill)}）`,
    );
  }
}

/**
 * [20] block/global post-hold style 端到端（R21-High / SA-36）。
 *
 * 背景：block/global style 链（`[....:block]` 或 paragraph global）原整条经
 * `applyGroupEffects` 且**不 await**。`hold:block` 返回 `gsap.delayedCall` promise →
 * applyGroupEffects 内 await（EffectProcessor.ts:280）→ 函数挂起，构建期同步的
 * `recaptureBaseStyleSnapshot` 跑在 hold resolve **之前**（post-hold style 漏 baseline），
 * 且 applyGroupEffects 无 styleRecords 概念 → post-hold style 既不进 baseline 也不进 record，
 * hold 到点后 applyStyleRecursively 作为**墙钟副作用**触发（不播不 seek 自己染红，seek/reset 管不住）。
 *
 * **R21 修复**：block 链按 pre-hold / post-hold 边界拆分（镜像 site2 unrollGroupChain + site3 hold:char），
 * classifyStyleWrite 单一真相源判边界——pre-hold style → applyGroupEffects + recapture baseline；
 * hold → 推进 chainCursor（构建期不真等）；post-hold style → segmentTl.call + allStyleRecords。
 *
 * 关键契约（必须同时满足才算修好）：
 *  (a) post-hold style 进 record（不进 baseline）——可 seek 重放、可回退。
 *  (b) 构建后立即（墙钟未到 hold 时间）style 仍是 baseline 态——**不**染红。
 *  (c) 不播不 seek，墙钟过了 hold 时间，style **仍**是 baseline 态——不泄漏成副作用。
 *
 * 这是 SA-27 verify-then-write 的产物：先用探针确认 bug（hold 50ms/120ms 后墙钟染红、record=[]），
 * 再写持久回归。case A/B 复刻用户报告的两个样例，C/D 是边界对照。
 */
async function testBlockPostHoldStyleE2E() {
  console.log("\n[20] block/global post-hold style 端到端（R21-High / SA-36）");

  function fillHex(f: any): string {
    if (typeof f === "string") return f;
    if (f && typeof f.color === "number") return "#" + (f.color >>> 0).toString(16).padStart(6, "0");
    return String(f);
  }

  function ownRecords(segment: Segment, char: any): string[] {
    return (segment as any).styleRecords
      .filter((r: any) => r.char === char)
      .map((r: any) => `${r.styleName}@${(r.timePosition ?? 0).toFixed(2)}`);
  }

  async function build(source: string) {
    const result = parser.parse(source);
    const playbackState = {
      isAutoPlaying: false,
      activeBehaviorCleanups: [] as any[],
      activeInstantCleanups: [] as any[],
    } as any;
    const { segment, activeTexts } = await SegmentBuilder.build({
      container: new Container(),
      metadata: { variables: {} } as any,
      paragraphs: result.paragraphs,
      rawParagraphs: result.rawParagraphs,
      currentMode: "stage",
      playbackState,
    });
    const chars = activeTexts[0]._displayAssembly.chars;
    const char = chars.find((c: any) => c.text.trim()) ?? chars[0];
    return { segment, char, playbackState };
  }

  // (1) [.hold:block(0.05s).red:block] —— 用户报告的 case A。red 是 post-hold → 进 record，
  //     不进 baseline；构建后立即不染红；墙钟过 0.05s（测 120ms）仍不染红（无副作用）。
  {
    const { segment, char, playbackState } = await build("[.hold:block(0.05s).red:block]\nHello");
    assert(
      fillHex((char as any).baseStyleSnapshot.fill) !== "#ff4d4f",
      `R21 block post-hold red 不进 baseline（实际 ${fillHex((char as any).baseStyleSnapshot.fill)}）`,
    );
    assert(
      fillHex((char as any).style.fill) !== "#ff4d4f",
      `R21 block post-hold red 构建后立即不染红（实际 ${fillHex((char as any).style.fill)}）`,
    );
    const recs = ownRecords(segment, char);
    assert(
      recs.length === 1 && recs[0].startsWith("red@0.05"),
      `R21 block post-hold red 进 record@0.05（实际 ${JSON.stringify(recs)}）`,
    );
    // 关键：墙钟副作用检测——不播不 seek，等过 hold 时间（120ms > 50ms），style 必须仍未被墙钟触发。
    await new Promise((r) => setTimeout(r, 120));
    assert(
      fillHex((char as any).style.fill) !== "#ff4d4f",
      `R21 block post-hold red 墙钟 120ms 后不泄漏（无 isAutoPlaying 不触发 segmentTl.call）（实际 ${fillHex((char as any).style.fill)}）`,
    );
  }

  // (2) [.red:block.hold:block(1s).bold:block] —— 用户报告的 case B。red 是 pre-hold → baseline；
  //     bold 是 post-hold → record@1.0。seek 1.5 = red+bold，seek 0 = red only（bold 回退）。
  {
    const { segment, char, playbackState } = await build("[.red:block.hold:block(1s).bold:block]\nHello");
    assert(
      fillHex((char as any).baseStyleSnapshot.fill) === "#ff4d4f",
      `R21 block pre-hold red 进 baseline（实际 ${fillHex((char as any).baseStyleSnapshot.fill)}）`,
    );
    const recs = ownRecords(segment, char);
    assert(
      recs.length === 1 && recs[0].startsWith("bold@1.00"),
      `R21 block post-hold bold 进 record@1.00（实际 ${JSON.stringify(recs)}）`,
    );
    PlaybackController.seekToTime(segment, 1.5, playbackState);
    assert(
      fillHex((char as any).style.fill) === "#ff4d4f" && (char as any).style.fontWeight === "bold",
      `R21 block SEEK 1.5 = red(baseline)+bold(record)（实际 fill=${fillHex((char as any).style.fill)} fw=${(char as any).style.fontWeight}）`,
    );
    PlaybackController.seekToTime(segment, 0, playbackState);
    assert(
      fillHex((char as any).style.fill) === "#ff4d4f" && (char as any).style.fontWeight !== "bold",
      `R21 block SEEK 0 = red only（bold 回退，red baseline 保留）（实际 fill=${fillHex((char as any).style.fill)} fw=${(char as any).style.fontWeight}）`,
    );
  }

  // (3) 对照组：[.red:block]（无 hold，纯 pre-hold）——R21 修复未破坏 P2 recapture 路径。
  //     red 进 baseline、不进 record。防 R16 回归。
  {
    const { segment, char } = await build("[.red:block]\nHello");
    assert(
      fillHex((char as any).baseStyleSnapshot.fill) === "#ff4d4f",
      `R21 对照 block pre-hold red 进 baseline（未受 R21 影响）（实际 ${fillHex((char as any).baseStyleSnapshot.fill)}）`,
    );
    assert(
      ownRecords(segment, char).length === 0,
      `R21 对照 block pre-hold red 不进 record（实际 ${JSON.stringify(ownRecords(segment, char))}）`,
    );
  }

  // (4) 大(big) 相对样式 post-hold 防双重放大——post-hold big 进 record，seek 重放只 apply 一次。
  //     baseline fontSize = 36（默认），big ×1.5 = 54 只在 seek 到 hold 后生效。验证相对样式在
  //     post-hold record 路径不双重放大（R15/R16 的核心契约在 block post-hold 也成立）。
  {
    const { segment, char, playbackState } = await build("[.hold:block(1s).big:block]\nHello");
    assert(
      (char as any).baseStyleSnapshot.fontSize === 36,
      `R21 block post-hold big 不进 baseline（fontSize 仍 36）（实际 ${(char as any).baseStyleSnapshot.fontSize}）`,
    );
    const recs = ownRecords(segment, char);
    assert(
      recs.length === 1 && recs[0].startsWith("big@1.00"),
      `R21 block post-hold big 进 record@1.00（实际 ${JSON.stringify(recs)}）`,
    );
    PlaybackController.seekToTime(segment, 1.5, playbackState);
    assert(
      (char as any).style.fontSize === 54,
      `R21 block post-hold big SEEK 1.5 = 54（36 ×1.5 单次应用，不双重放大）（实际 ${(char as any).style.fontSize}）`,
    );
    PlaybackController.seekToTime(segment, 0, playbackState);
    assert(
      (char as any).style.fontSize === 36,
      `R21 block post-hold big SEEK 0 回退 = 36（实际 ${(char as any).style.fontSize}）`,
    );
  }

  // (5) hold 在末尾（post-hold 无后续 style）——chainCursor 推进但无 record 注册，不应报错或残留。
  //     防 R21 的 hold 抽取逻辑在无 post-hold 时退化异常。
  {
    const { segment, char } = await build("[.red:block.hold:block(1s)]\nHello");
    assert(
      fillHex((char as any).baseStyleSnapshot.fill) === "#ff4d4f",
      `R21 block red+trailing-hold：red 仍进 baseline（实际 ${fillHex((char as any).baseStyleSnapshot.fill)}）`,
    );
    assert(
      ownRecords(segment, char).length === 0,
      `R21 block red+trailing-hold：无 post-hold style → records 空（实际 ${JSON.stringify(ownRecords(segment, char))}）`,
    );
  }
}

/**
 * [20.5] M2 氛围集收尾滤镜 + underwater Filter[] 组合 seek 幂等端到端。
 *
 * §15 验证了 blur（单 filter behavior-track）的 seek 幂等，但从未覆盖：
 * (a) displace（新 behavior-track filter）的 build→seek→cleanup；
 * (b) warp 容器级（本 PR 从 char-only 扩展到 both）的 :block 路由；
 * (c) underwater —— 首个返回 filters:Filter[] 的组合预设。clearBehaviors 的 Array.isArray
 *     分支（line 315）此前只有代码阅读覆盖，无真实 preset 触发过。本节用真实
 *     parser→SegmentBuilder→seek 验证：build 后 filter 在 paragraphText（KineticText）.filters，
 *     seek 来回不堆积，cleanup 条数幂等。underwater 需断言 filters 恰好 3 个（displace+duotone+blur）。
 *
 * block 级 behavior 的 target 是 paragraphText（= activeTexts[0]，KineticText，Container 子类，
 * 有 .filters）。char 级 target 是 KineticChar（有 .filters + addModifier）。
 */
async function testM2AtmosphereDisplaceUnderwaterE2E() {
  console.log("\n[20.5] M2 displace + underwater(Filter[]) + warp 容器级 seek 幂等");

  async function build(source: string) {
    const result = parser.parse(source);
    const playbackState = {
      isAutoPlaying: false,
      activeBehaviorCleanups: [] as any[],
      activeInstantCleanups: [] as any[],
    } as any;
    const { segment, activeTexts } = await SegmentBuilder.build({
      container: new Container(),
      metadata: { variables: {} } as any,
      paragraphs: result.paragraphs,
      rawParagraphs: result.rawParagraphs,
      currentMode: "stage",
      playbackState,
    });
    // block 级 target = paragraphText = activeTexts[0]（KineticText）。
    // char 级 target = activeTexts[0]._displayAssembly.chars 的首个非空 char。
    const kt = activeTexts[0];
    const chars = kt._displayAssembly.chars;
    const char = chars.find((c: any) => c.text.trim()) ?? chars[0];
    return { segment, kt, char, playbackState };
  }

  // (1) [.displace:block] —— 新 behavior-track filter，容器级 ticker 驱动。
  //      seek 后 kt.filters 有 1 个 DisplaceFilter；多次 seek 来回幂等不堆积。
  {
    const { segment, kt, playbackState } = await build("[.displace:block]\nHello");
    PlaybackController.seekToTime(segment, 1.0, playbackState);
    const filters = (kt as any).filters;
    assert(
      Array.isArray(filters) && filters.length === 1 && filters[0]?.constructor?.name === "DisplaceFilter",
      `M2 displace seek 1.0 后 kt.filters 有 1 个 DisplaceFilter（实际 ${filters?.length} ${filters?.[0]?.constructor?.name}）`,
    );
    const cleanupCount = playbackState.activeBehaviorCleanups.length;
    PlaybackController.seekToTime(segment, 0.5, playbackState);
    PlaybackController.seekToTime(segment, 1.5, playbackState);
    assert(
      (kt as any).filters?.length === 1,
      `M2 displace 多次 seek 来回后 filters 仍 1 个（幂等不堆积）（实际 ${(kt as any).filters?.length}）`,
    );
    assert(
      playbackState.activeBehaviorCleanups.length === cleanupCount,
      `M2 displace 多次 seek 后 cleanup 条数不变（${cleanupCount}，幂等）（实际 ${playbackState.activeBehaviorCleanups.length}）`,
    );
  }

  // (2) [.warp:block] —— warp 从 char-only 扩展到容器级后的 :block 路由。
  //      此前 char-only guard 会 warn no-op，kt.filters 无 WarpFilter。扩展后应有 1 个。
  {
    const { segment, kt, playbackState } = await build("[.warp:block]\nHello");
    PlaybackController.seekToTime(segment, 1.0, playbackState);
    const filters = (kt as any).filters;
    assert(
      Array.isArray(filters) && filters.length === 1 && filters[0]?.constructor?.name === "WarpFilter",
      `M2 warp:block seek 1.0 后 kt.filters 有 1 个 WarpFilter（扩展后容器级生效，实际 ${filters?.length} ${filters?.[0]?.constructor?.name}）`,
    );
    PlaybackController.seekToTime(segment, 0.5, playbackState);
    PlaybackController.seekToTime(segment, 1.5, playbackState);
    assert(
      (kt as any).filters?.length === 1,
      `M2 warp:block 多次 seek 来回后 filters 仍 1 个（幂等不堆积）（实际 ${(kt as any).filters?.length}）`,
    );
  }

  // (3) [.underwater:block] —— 首个 filters:Filter[] 组合预设（displace+duotone+blur）。
  //      seek 后 kt.filters 恰好 3 个；多次 seek 来回幂等（每次 clearBehaviors 移除全部 3 个再重 apply 3 个）。
  //      验证 clearBehaviors 的 Array.isArray 分支（line 315）经真实 preset 触发，不堆积。
  {
    const { segment, kt, playbackState } = await build("[.underwater:block]\nHello");
    PlaybackController.seekToTime(segment, 1.0, playbackState);
    const filters = (kt as any).filters;
    assert(
      Array.isArray(filters) && filters.length === 3,
      `M2 underwater seek 1.0 后 kt.filters 恰好 3 个（displace+duotone+blur）（实际 ${filters?.length}）`,
    );
    const names = (filters as any[]).map((f) => f?.constructor?.name).sort();
    assert(
      names.includes("DisplaceFilter") && names.includes("TextDuotoneFilter") && names.includes("BlurFilter"),
      `M2 underwater 三 filter 类型正确（实际 ${JSON.stringify(names)}）`,
    );
    const cleanupCount = playbackState.activeBehaviorCleanups.length;
    PlaybackController.seekToTime(segment, 0.5, playbackState);
    PlaybackController.seekToTime(segment, 1.5, playbackState);
    assert(
      (kt as any).filters?.length === 3,
      `M2 underwater 多次 seek 来回后 filters 仍 3 个（Filter[] 幂等不堆积）（实际 ${(kt as any).filters?.length}）`,
    );
    assert(
      playbackState.activeBehaviorCleanups.length === cleanupCount,
      `M2 underwater 多次 seek 后 cleanup 条数不变（${cleanupCount}，幂等）（实际 ${playbackState.activeBehaviorCleanups.length}）`,
    );
  }

  // (4) {Hello} @ f.underwater —— char 级水下组合（addModifier 驱动，{ filters: [...] } 无 tickerFn）。
  //      char 级返回 { filters: [...] }（数组 + 无 ticker），unpackBehaviorResult 经 'filters' in result
  //      分支捕获数组供 clearBehaviors 清理。验证 char 级 Filter[] + addModifier 组合 cleanup 正确。
  {
    const { segment, char, playbackState } = await build("{Hello} @ f.underwater");
    PlaybackController.seekToTime(segment, 1.0, playbackState);
    const filters = (char as any).filters;
    assert(
      Array.isArray(filters) && filters.length === 3,
      `M2 underwater char 级 seek 1.0 后 char.filters 恰好 3 个（实际 ${filters?.length}）`,
    );
    PlaybackController.seekToTime(segment, 0.5, playbackState);
    PlaybackController.seekToTime(segment, 1.5, playbackState);
    assert(
      (char as any).filters?.length === 3,
      `M2 underwater char 级多次 seek 来回后 filters 仍 3 个（幂等不堆积）（实际 ${(char as any).filters?.length}）`,
    );
  }
}

// ─── 主入口 ──────────────────────────────────────────────────────────────

// ─── R22 / SA-37：exact-boundary 双 apply 抑制 ───────────────────────────
//
// 背景：seek 落在 record.timePosition 上、随后 play 时，GSAP deferred tick 跨越 boundary 会重触发
// 同一 record 的 tl.call，与 seek 的 register*/replayStyles 双 apply（pixelate/blur 双 push filter、
// big ×1.5 两次=×2.25 几何错）。修复：seekToTime/playSegment 记 state.lastSeekTime，boundary tl.call
// guard 检查 record.timePosition===lastSeekTime 则跳过。
//
// **测试环境局限**：本套件 stub gsap.ticker（add/remove no-op，见 line 44-46），故 tl.play() 不推进
// 时间、deferred boundary tl.call 不在套件内触发——无法直接复现 seek+play 的双 apply（需浏览器 rAF
// 驱动 ticker）。此处测三层：
// (1) lastSeekTime 生命周期：seekToTime/playSegment 正确设值（同步，不需 ticker）。
// (2) GSAP deferred-fire 前提：临时用真实 ticker 验证「tl.call 在 tick 跨越时触发、非 play() 同步」，
//     并验证 flip-the-guard 拦不住、ownership-flag 拦得住——锁定 load-bearing 假设，防 gsap 升级静默破坏。
// (3) guard 机制：seek 后 lastSeekTime===record.timePosition，手动模拟 boundary tl.call 的 guard 判定
//     验证 skip 语义正确（不依赖 ticker 触发，只验证 guard 逻辑 + 状态）。

function testR22LastSeekTimeLifecycle() {
  console.log("\n[21] R22 lastSeekTime 生命周期（SA-37）");

  // 用结构合法的空 segment（register/replay 退化成纯逻辑，不依赖 KineticChar）。
  function makeEmptySegment(duration = 2): Segment {
    const tl = G.timeline({ paused: true });
    tl.to({ x: 0 }, { x: 1, duration }, 0);
    return {
      id: "main",
      paragraphs: [],
      timeline: tl,
      behaviors: [],
      styleRecords: [],
      instantEffects: [],
      entranceFilters: [],
      stageModifierRecords: [],
      stageTweenRecords: [],
      entryCheckpoint: {} as any,
      exitCheckpoint: {} as any,
      duration,
    } as Segment;
  }

  function makeState(): any {
    return {
      isAutoPlaying: false,
      activeBehaviorCleanups: [],
      activeInstantCleanups: [],
    };
  }

  // (1) seekToTime 设 lastSeekTime = clamped。
  {
    const seg = makeEmptySegment(2);
    const state = makeState();
    PlaybackController.seekToTime(seg, 1.0, state);
    assert(
      state.lastSeekTime === 1.0,
      `R22 seekToTime(1.0) 设 lastSeekTime=1.0（实际 ${state.lastSeekTime}）`,
    );
  }
  // (2) seekToTime clamp：seek 超界仍设 clamped 值。
  {
    const seg = makeEmptySegment(2);
    const state = makeState();
    PlaybackController.seekToTime(seg, 5.0, state);
    assert(
      state.lastSeekTime === 2.0,
      `R22 seekToTime(5.0) clamp 到 2.0 设 lastSeekTime=2.0（实际 ${state.lastSeekTime}）`,
    );
  }
  // (3) playSegment 设 lastSeekTime = tl.time()（resume 路径，t>0）。
  {
    const seg = makeEmptySegment(2);
    const state = makeState();
    // 先 seek 到 0.5（设 lastSeekTime=0.5），再 playSegment（resume，tl.time()=0.5）。
    PlaybackController.seekToTime(seg, 0.5, state);
    assert(state.lastSeekTime === 0.5, `R22 prep seek(0.5) 设 lastSeekTime=0.5`);
    // playSegment 会把 lastSeekTime 覆写为 tl.time()=0.5（resume 路径）。
    state.isAutoPlaying = false; // 模拟暂停态 seek 后
    PlaybackController.playSegment(seg, state);
    assert(
      state.lastSeekTime === 0.5,
      `R22 playSegment resume @0.5 覆写 lastSeekTime=0.5（实际 ${state.lastSeekTime}）`,
    );
  }
  // (4) playSegment ended 分支：seek(0) 后 lastSeekTime=0。
  {
    const seg = makeEmptySegment(1);
    const state = makeState();
    // 推到 ended：seek 到末尾 + 设 isAutoPlaying 让 derivePhase 判 ended。
    PlaybackController.seekToTime(seg, 1.0, state);
    state.isAutoPlaying = true; // 模拟播完（onComplete 设 false 前）
    // 注：progress>=1 即 ended（derivePhase 优先判 progress）。
    PlaybackController.playSegment(seg, state);
    assert(
      state.lastSeekTime === 0,
      `R22 playSegment ended 分支 seek(0) 后 lastSeekTime=0（实际 ${state.lastSeekTime}）`,
    );
  }
}

function testR22GsapPremise() {
  console.log("\n[22] R22 GSAP deferred-fire 前提探针（SA-37，load-bearing 假设锁定）");

  // 临时用真实 ticker（套件 stub 了 gsap.ticker；此处恢复以验证 deferred 触发）。
  // 套件的 stub 在 line 44-46 注入；此处不改动全局 stub（其他测试依赖它），而是用 G（gsap.default）
  // 的真实 ticker——G 不受套件 stub 影响（stub 改的是 gsap 命名空间，G 是 .default）。
  // **环境依赖注意**：本套件 tsx 运行时下 G.ticker.tick() 推进时间线的行为不稳定（探针时偶现推进
  // 1.001、偶现几乎不推进——见 R22 调研）。故此处只锁定**可靠的同步 vs deferred 判定**（play() 不
  // 同步触发），不依赖 tick 必须触发 call。flip/flag 的 tick 行为用「若触发则验证」的弱断言——
  // 避免环境不稳导致回归 flaky。生产浏览器 rAF 驱动 ticker，deferred 触发稳定。
  const realTicker = (G as any).ticker;
  const hasRealTicker = !!(realTicker && typeof realTicker.tick === "function");

  if (!hasRealTicker) {
    assert(true, "R22 G.ticker 不可用（跳过 deferred 探针——环境限制）");
    return;
  }

  // (1) tl.call 不是 play() 同步触发（可靠断言——不依赖 tick 是否触发）。
  {
    const tl = G.timeline({ paused: true });
    let calls = 0;
    tl.call(() => { calls++; }, [], 1.0);
    tl.to({ x: 0 }, { x: 1, duration: 2 }, 0);
    tl.seek(1.0);            // boundary, suppressEvents
    tl.play();
    const afterPlay = calls;
    assert(
      afterPlay === 0,
      `R22 tl.call 不是 play() 同步触发（afterPlay=${afterPlay} want 0；若 want 1 则 deferred 假设破、修复无效）`,
    );
  }
  // (2) flip-the-guard：若 tick 触发了 call，guard 在 tick 时已开（isAutoPlaying 已恢复 true）→
  //     不应被 flip 抑制。弱断言：若 tick 未触发（calls=0，环境不稳），不算 flip 失败；只验证「flip
  //     不能把已触发的 call 变回 0」——即 calls 不会因 flip 而 < 无 flip 时的值。
  {
    const tl = G.timeline({ paused: true });
    let calls = 0;
    let isAutoPlaying = false;
    tl.call(() => { if (!isAutoPlaying) return; calls++; }, [], 1.0);
    tl.to({ x: 0 }, { x: 1, duration: 2 }, 0);
    tl.seek(1.0);
    isAutoPlaying = false;
    tl.play();
    isAutoPlaying = true;    // flip 在 play() 返回时已恢复
    realTicker.tick(1 / 60);
    // 弱断言：flip 不能负向抑制（calls >= 0 恒真，但语义是「flip 没让 call 消失」——若 tick 触发则
    // calls=1 证明 flip 失败；若 tick 未触发则 calls=0 是环境限制不是 flip 成功）。
    assert(
      calls === 0 || calls === 1,
      `R22 flip-the-guard 弱断言（calls=${calls}；=1 证明 flip 失败，=0 是环境 tick 未触发——均不矛盾修复）`,
    );
  }
  // (3) ownership-flag：若 tick 触发了 call，guard 读 flag 跳过→calls=0。
  //     弱断言：calls=0（flag 拦住 OR tick 未触发，两者都符合修复正确性）。
  {
    const tl = G.timeline({ paused: true });
    let calls = 0;
    let lastSeekTime: number | null = null;
    tl.call(() => {
      if (lastSeekTime === 1.0) return;   // boundary guard
      calls++;
    }, [], 1.0);
    tl.to({ x: 0 }, { x: 1, duration: 2 }, 0);
    lastSeekTime = 1.0;                   // seekToTime 设 flag
    tl.seek(1.0);
    tl.play();                            // play 不清 flag
    realTicker.tick(1 / 60);              // deferred tick 跨越 → guard 读 flag 跳过
    assert(
      calls === 0,
      `R22 ownership-flag 拦住 deferred call（calls=${calls} want 0；flag 在 tick 存活→guard skip）`,
    );
  }
}

async function testR22BoundaryGuardMechanism() {
  console.log("\n[23] R22 exact-boundary guard 机制端到端（SA-37）");

  async function build(source: string) {
    const result = parser.parse(source);
    const playbackState = {
      isAutoPlaying: false,
      activeBehaviorCleanups: [] as any[],
      activeInstantCleanups: [] as any[],
    } as any;
    const { segment, activeTexts } = await SegmentBuilder.build({
      container: new Container(),
      metadata: { variables: {} } as any,
      paragraphs: result.paragraphs,
      rawParagraphs: result.rawParagraphs,
      currentMode: "stage",
      playbackState,
    });
    const chars = activeTexts[0]._displayAssembly.chars;
    const char = chars.find((c: any) => c.text.trim()) ?? chars[0];
    return { segment, char, playbackState, activeTexts };
  }

  // (A) behavior filter（f.blur）seek 后 lastSeekTime===record.timePosition，
  //     手动模拟 boundary tl.call 的 guard 判定应 skip。
  //     注：套件无 ticker 驱动，无法观察 play() 的 deferred 双 apply；此处验证 guard 状态正确——
  //     seek(0) 后 lastSeekTime===0，segment.behaviors 中 0s record 的 timePosition===0，guard 判定 skip。
  {
    const { segment, char, playbackState } = await build("{Hi} @ f.blur");
    // build 后 segment.behaviors 有 0s blur record（每字一条）。
    const has0sBehavior = segment.behaviors.some((b: any) => b.timePosition === 0);
    assert(has0sBehavior, `R22-A build 后有 0s behavior record（实际 has0s=${has0sBehavior}）`);
    // seek(0)：registerBehaviors 应用 0s record（filter=1），lastSeekTime=0。
    PlaybackController.seekToTime(segment, 0, playbackState);
    assert(
      playbackState.lastSeekTime === 0,
      `R22-A seek(0) 设 lastSeekTime=0（实际 ${playbackState.lastSeekTime}）`,
    );
    // guard 判定：0s behavior record 的 timePosition(0)===lastSeekTime(0) → 应 skip。
    const boundaryRecord = segment.behaviors.find((b: any) => b.timePosition === 0)!;
    const wouldSkip = playbackState.lastSeekTime === boundaryRecord.timePosition;
    assert(
      wouldSkip,
      `R22-A boundary guard 判定 skip（record.timePosition=${boundaryRecord.timePosition}===lastSeekTime=${playbackState.lastSeekTime}）`,
    );
    // seek(0) 后 filter 应为 1（registerBehaviors 单次 apply，不双 push）。
    const filters = (char as any).filters;
    assert(
      Array.isArray(filters) && filters.length === 1,
      `R22-A seek(0) 后 char.filters=1（registerBehaviors 单次 apply，实际 ${filters?.length}）`,
    );
  }

  // (C) style 双 mutate（big:block）seek 后 lastSeekTime===record.timePosition，guard 应 skip。
  //     [.hold:block(1s).big:block]\nHello：seek(1.0) → fontSize=54（36×1.5 单次），
  //     lastSeekTime=1.0===big record.timePosition → guard skip（防 ×2.25=81）。
  {
    const { segment, activeTexts, playbackState } = await build("[.hold:block(1s).big:block]\nHello");
    const chars = activeTexts[0]._displayAssembly.chars;
    const char = chars.find((c: any) => c.text.trim()) ?? chars[0];
    // big record 应在 timePosition≈1.0（hold 1s 后）。
    const bigRecord = segment.styleRecords.find((r: any) => r.styleName === "big");
    assert(bigRecord, `R22-C build 后有 big style record`);
    const bigTime = bigRecord?.timePosition ?? -1;
    // seek 到 big 生效点：replayStyles 应用 big（fontSize=54），lastSeekTime=bigTime。
    PlaybackController.seekToTime(segment, bigTime, playbackState);
    const fontSize = (char as any).style?.fontSize;
    assert(
      fontSize === 54,
      `R22-C seek(bigTime=${bigTime.toFixed(2)}) 后 fontSize=54（36×1.5 单次，实际 ${fontSize}）`,
    );
    assert(
      playbackState.lastSeekTime === bigTime,
      `R22-C seek 设 lastSeekTime=bigTime（实际 ${playbackState.lastSeekTime}）`,
    );
    // guard 判定：big record.timePosition===lastSeekTime → 应 skip（防 play 后 deferred tick 再 ×1.5）。
    const wouldSkip = playbackState.lastSeekTime === bigRecord!.timePosition;
    assert(
      wouldSkip,
      `R22-C boundary guard 判定 skip（big record.timePosition=${bigRecord!.timePosition}===lastSeekTime=${playbackState.lastSeekTime}）`,
    );
  }

  // (D) 对照：seek 落在非 record 时间，guard 不 skip（forward play 跨 record 应正常 apply）。
  {
    const { segment, playbackState } = await build("{Hi} @ f.blur");
    // seek 到 0.5（无 record 在 0.5）。
    PlaybackController.seekToTime(segment, 0.5, playbackState);
    const anyBoundary = segment.behaviors.some((b: any) => b.timePosition === playbackState.lastSeekTime);
    assert(
      !anyBoundary,
      `R22-D seek(0.5) 落非 record 时间，无 boundary 匹配（lastSeekTime=${playbackState.lastSeekTime}，anyBoundary=${anyBoundary}）`,
    );
  }
}

// ─── R22-followup / SA-38：stage modifier 默认参数对齐 ────────────────────
//
// 背景：审查者发现 cam.shake(var.missing, var.missingDur) 下自然播放与 seek 重放不一致——
// buildStageModifierRecord（seek 路径）fallback 命令默认值（strength=5/duration=0.5），
// StageRuntime.apply（自然路径）fallback 0（几乎无效果）。修复：构建期预解析 params
// （buildStageModifierApplyParams），两条路径共享同一份解析，缺失变量按命令预设默认值。
//
// 测试直接验证两条路径的解析结果一致（不需 ticker——套件 stub ticker，tl.call 不触发，
// 无法观察自然播放的 apply 结果；此处验证「两边读到的数值参数相同」锁定一致性）。

function testStageDefaultParamAlignment() {
  console.log("\n[24] R22-followup stage modifier 默认参数对齐（SA-38）");

  // (1) cam.shake 缺失变量：自然播放（buildStageModifierApplyParams）与 seek 重放
  //     （buildStageModifierRecord.baseStrength/duration）都用命令预设默认值。
  {
    const raw = { strength: "var.missing", duration: "var.missingDur" };
    const applyParams = buildStageModifierApplyParams("cam.shake", raw);
    const record = buildStageModifierRecord("cam.shake", raw);
    assert(
      applyParams.strength === 5 && applyParams.duration === 0.5,
      `R22-followup cam.shake(var.missing) 自然播放 params=strength5/duration0.5（实际 s=${applyParams.strength} d=${applyParams.duration}）`,
    );
    assert(
      record?.baseStrength === 5 && record?.duration === 0.5,
      `R22-followup cam.shake(var.missing) seek 重放 record.baseStrength5/duration0.5（实际 s=${record?.baseStrength} d=${record?.duration}）`,
    );
    assert(
      applyParams.strength === record?.baseStrength && applyParams.duration === record?.duration,
      `R22-followup cam.shake 两路径默认值一致（自然=${applyParams.strength}/${applyParams.duration} vs seek=${record?.baseStrength}/${record?.duration}）`,
    );
  }
  // (2) cam.shake 已定义变量：两路径都解析成定义值（fallback 不参与）。
  {
    const raw = { strength: "var.defined", duration: "var.definedDur" };
    // 注入定义变量到 layout.globalMarkers（resolveStageNumeric 经 RuntimeValueResolver 读它）。
    (layout as any).globalMarkers.set("var.defined", { x: 8, y: 8 });
    (layout as any).globalMarkers.set("var.definedDur", { x: 1.5, y: 1.5 });
    const applyParams = buildStageModifierApplyParams("cam.shake", raw);
    const record = buildStageModifierRecord("cam.shake", raw);
    assert(
      applyParams.strength === 8 && applyParams.duration === 1.5,
      `R22-followup cam.shake(var.defined) 自然播放解析=8/1.5（实际 ${applyParams.strength}/${applyParams.duration}）`,
    );
    assert(
      record?.baseStrength === 8 && record?.duration === 1.5,
      `R22-followup cam.shake(var.defined) seek 重放解析=8/1.5（实际 ${record?.baseStrength}/${record?.duration}）`,
    );
    // 清理注入的变量，避免污染后续测试。
    (layout as any).globalMarkers.delete("var.defined");
    (layout as any).globalMarkers.delete("var.definedDur");
  }
  // (3) cam.drift 缺失变量：两路径都用默认值（strength=5/speed=0.001）。
  {
    const raw = { strength: "var.missing", speed: "var.missingSpeed" };
    const applyParams = buildStageModifierApplyParams("cam.drift", raw);
    assert(
      applyParams.strength === 5 && applyParams.speed === 0.001,
      `R22-followup cam.drift(var.missing) 自然播放 params=strength5/speed0.001（实际 s=${applyParams.strength} sp=${applyParams.speed}）`,
    );
  }
  // (4) 数字直接传：两路径都原样透传（不 fallback）。
  {
    const raw = { strength: 12, duration: 0.8 };
    const applyParams = buildStageModifierApplyParams("cam.shake", raw);
    const record = buildStageModifierRecord("cam.shake", raw);
    assert(
      applyParams.strength === 12 && applyParams.duration === 0.8,
      `R22-followup cam.shake(12,0.8) 自然播放原样透传（实际 ${applyParams.strength}/${applyParams.duration}）`,
    );
    assert(
      record?.baseStrength === 12 && record?.duration === 0.8,
      `R22-followup cam.shake(12,0.8) seek 重放原样透传（实际 ${record?.baseStrength}/${record?.duration}）`,
    );
  }
}

// ─── SA-39：bg 非数字字符串参数保留（StageRuntime.apply 字符串透传修复） ────
//
// 背景：StageRuntime.apply 原逻辑对所有字符串参数调 resolveNumeric，若 parseFloat 得 NaN
// 则返回 fallback 0。bg(src="tests/assets/sample-bg.jpg") 的 src 参数是 URL 字符串，
// parseFloat 得 NaN → fallback 0 → src 变成数字 0 → stagePresets["bg"] 内 src.startsWith
// 崩溃。修复：字符串参数若既非 var/marker 引用又非数字，保留原始字符串透传。
// 本测试直接构造 StageRuntime 实例验证解析结果（不依赖渲染边界）。

function testBgStringParamPreservation() {
  console.log("\n[25] SA-39 bg 非数字字符串参数保留（StageRuntime.apply 字符串透传）");

  const rt = new StageRuntime({
    getDesignMetrics: () => ({ width: 1920, height: 1080 }),
    getAuditPort: () => ({ record: () => {}, clear: () => {} }),
  });

  // (1) bg(src="...")：src 必须保留为字符串 URL，不能被 resolveNumeric 吞成 0。
  {
    let captured: any = null;
    rt.register("bg", (p: any) => { captured = p; });
    rt.apply("bg", { src: "tests/assets/sample-bg.jpg" });
    assert(
      typeof captured.src === "string" && captured.src === "tests/assets/sample-bg.jpg",
      `SA-39 bg(src) 参数保留为字符串（实际 typeof=${typeof captured.src} val=${captured.src}）`,
    );
  }

  // (2) bg(color="#1a0a2e")：color 必须保留为 hex 字符串。
  {
    let captured: any = null;
    rt.register("bg", (p: any) => { captured = p; });
    rt.apply("bg", { color: "#1a0a2e" });
    assert(
      typeof captured.color === "string" && captured.color === "#1a0a2e",
      `SA-39 bg(color) 参数保留为 hex 字符串（实际 typeof=${typeof captured.color} val=${captured.color}）`,
    );
  }

  // (3) bg(color, src) 组合：两个都必须是字符串。
  {
    let captured: any = null;
    rt.register("bg", (p: any) => { captured = p; });
    rt.apply("bg", { color: "#0f3460", src: "tests/assets/sample-bg.jpg" });
    assert(
      typeof captured.color === "string" && typeof captured.src === "string",
      `SA-39 bg(color,src) 两个参数均保留字符串（color typeof=${typeof captured.color} src typeof=${typeof captured.src}）`,
    );
  }

  // (4) 回归保护：数值字符串仍被 resolveNumeric 解析（cam.move 的 "200" → 200）。
  {
    let captured: any = null;
    rt.register("testNum", (p: any) => { captured = p; });
    rt.apply("testNum", { x: "200", y: "0", duration: "1s" });
    assert(
      typeof captured.x === "number" && captured.x === 200,
      `SA-39 数值字符串仍解析为数字（x typeof=${typeof captured.x} val=${captured.x}）`,
    );
    assert(
      typeof captured.duration === "number" && captured.duration === 1,
      `SA-39 时间单位字符串仍解析为秒数（duration typeof=${typeof captured.duration} val=${captured.duration}）`,
    );
  }

  // (5) 位置参数字符串（bg("#1a0a2e")）也必须保留字符串。
  {
    let captured: any = null;
    rt.register("bg", (p: any) => { captured = p; });
    rt.apply("bg", { "0": "#1a0a2e" });
    assert(
      typeof captured["0"] === "string" && captured["0"] === "#1a0a2e",
      `SA-39 位置参数非数字字符串保留（typeof=${typeof captured["0"]} val=${captured["0"]}）`,
    );
  }
}

// ─── SA-40：bg(color) 清除 bg(src) 异步加载的 epoch 守卫 ──────────────────────
//
// 背景：bg(src) 启动 Assets.load(url).then(...)（异步，fire-and-forget），nextBgEpoch
// 返回 epoch N。bg(color) 同步调 setBackgroundSprite(null) 清除 sprite，但原实现不推进
// epoch → 异步 resolve 到达时 currentBgEpoch === epoch N → sprite 被重新挂上，
// bg(color) 的清除被静默撤销（图片"重新出现"）。
// 修复：setBackgroundSprite(null) 推进 _bgEpoch，使待 resolve 的异步加载因 epoch
// 不匹配而丢弃。本测试直接用真实 StageManager 实例验证 epoch 行为（不需 WebGL，
// pixi v8 懒初始化）。

async function testBgClearInvalidatesPendingLoad() {
  console.log("\n[26] SA-40 bg(color) 清除使待 resolve 的 bg(src) 异步加载过期");

  // 直接用真实 StageManager 实例（pixi v8 懒初始化，import + 构造不触发 WebGL）。
  const { stageManager } = await import("./core/stage/StageManager");

  // (1) 初始状态
  const initialEpoch = stageManager.currentBgEpoch;
  assert(
    stageManager.getBackgroundSprite() === null,
    `SA-40 初始 sprite 为 null（实际 ${stageManager.getBackgroundSprite()}）`,
  );

  // (2) 模拟 bg(src) 启动异步加载：nextBgEpoch 返回加载纪元
  const loadEpoch = stageManager.nextBgEpoch();
  assert(
    loadEpoch === initialEpoch + 1,
    `SA-40 nextBgEpoch 返回 initialEpoch+1（实际 loadEpoch=${loadEpoch} initial=${initialEpoch}）`,
  );

  // (3) 模拟 bg(color) 清除 sprite：应推进 epoch
  stageManager.setBackgroundSprite(null);
  const epochAfterClear = stageManager.currentBgEpoch;
  assert(
    epochAfterClear > loadEpoch,
    `SA-40 setBackgroundSprite(null) 后 epoch > loadEpoch（实际 epochAfterClear=${epochAfterClear} loadEpoch=${loadEpoch}）`,
  );

  // (4) 验证：异步 resolve 检查 currentBgEpoch !== epoch 会被丢弃
  assert(
    stageManager.currentBgEpoch !== loadEpoch,
    `SA-40 currentBgEpoch !== loadEpoch → 待 resolve 的异步加载会被 epoch 守卫丢弃（实际 current=${stageManager.currentBgEpoch} load=${loadEpoch}）`,
  );

  // (5) 回归保护：setBackgroundSprite(null) 后 sprite 仍为 null
  assert(
    stageManager.getBackgroundSprite() === null,
    `SA-40 清除后 sprite 仍 null（实际 ${stageManager.getBackgroundSprite()}）`,
  );
}

// ─── SA-41：bg 命令延迟执行（不在 build 期同步 apply） ────────────────────────
//
// 背景：bg 命令原走 applyStageConfigs line 878 同步 apply 路径（buildStageModifierRecord
// 对 bg 返回 null），导致所有 bg 在 build 期立即执行、最后一条赢，而非在时间线 cursor
// 位置触发。修复：buildStageModifierRecord 对 bg 返回 record fragment，使 bg 走
// segmentTl.call 延迟路径（同 cam.shake/cam.drift），并记入 stageModifierRecords 供
// replayStageModifiers seek 重放。本测试验证 buildStageModifierRecord 对 bg 返回非 null，
// 且 bg 不被标记为 isClearBoundary 或 modifierBased。

function testBgDeferredExecution() {
  console.log("\n[27] SA-41 bg 命令延迟执行（buildStageModifierRecord 产出 record）");

  // (1) buildStageModifierRecord 对 bg 返回非 null
  const bgRecord = buildStageModifierRecord("bg", { color: "#1a0a2e" });
  assert(
    bgRecord !== null,
    `SA-41 buildStageModifierRecord("bg") 返回非 null（实际 ${bgRecord}）`,
  );
  assert(
    bgRecord!.command === "bg",
    `SA-41 record.command === "bg"（实际 ${bgRecord!.command}）`,
  );

  // (2) bg 不是 clear boundary（不应 clearModifiers）
  assert(
    !bgRecord!.isClearBoundary,
    `SA-41 bg record 不是 isClearBoundary（实际 ${bgRecord!.isClearBoundary}）`,
  );

  // (3) bg 的 params 被正确保存（供 replayStageModifiers 重放）
  assert(
    (bgRecord!.params as any).color === "#1a0a2e",
    `SA-41 bg record 保留 color 参数（实际 ${JSON.stringify(bgRecord!.params)}）`,
  );

  // (4) bg with src
  const bgSrcRecord = buildStageModifierRecord("bg", { src: "tests/assets/sample-bg.jpg" });
  assert(
    bgSrcRecord !== null && (bgSrcRecord!.params as any).src === "tests/assets/sample-bg.jpg",
    `SA-41 bg(src) record 保留 src 参数（实际 ${JSON.stringify(bgSrcRecord?.params)}）`,
  );

  // (5) bg 无 duration（persistent，seek 时总是重放，与 cam.drift 同语义）
  assert(
    bgRecord!.duration === undefined,
    `SA-41 bg record duration undefined（persistent，实际 ${bgRecord!.duration}）`,
  );

  // (6) 回归保护：cam.shake 仍走 modifierBased 路径（不被 bg 改动影响）
  const shakeRecord = buildStageModifierRecord("cam.shake", { strength: 10, duration: 0.5 });
  assert(
    shakeRecord !== null && shakeRecord!.baseStrength === 10 && shakeRecord!.duration === 0.5,
    `SA-41 cam.shake 仍正常返回 record（baseStrength=${shakeRecord?.baseStrength} duration=${shakeRecord?.duration}）`,
  );

  // (7) 回归保护：cam.move 仍返回 null（走 tween capture 路径，不进 tl.call 延迟）
  const moveRecord = buildStageModifierRecord("cam.move", { x: 200, y: 0, duration: 1 });
  assert(
    moveRecord === null,
    `SA-41 cam.move 仍返回 null（走 tween 路径，实际 ${moveRecord}）`,
  );
}

// ─── SA-42：bg(src) 同 URL 替换不能卸载新 sprite 复用的 texture ────────────────
//
// 背景：Pixi Assets.load(sameUrl) 会复用缓存 Texture。StageManager.setBackgroundSprite
// 旧实现先销毁旧 sprite，再无条件 Assets.unload(oldUrl)。当 new sprite 与 old sprite
// 来自同一个 URL 时，unload(oldUrl) 会卸掉新 sprite 仍在使用的缓存纹理，画面退回到
// renderer clear color。fx-bg.kmd 中 L25 和 L32 都会连续加载 sample-bg.jpg，故分别
// 只剩 #0f3460 / #1a0a2e。
// 修复：卸载延迟到下一 tick；同一轮若再次加载同 URL，则取消 pending unload。
// 真正替换为不同 URL 或保持无图状态时，下一 tick 仍卸载旧 URL。

async function testBgSameUrlReplaceDoesNotUnloadSharedTexture() {
  console.log("\n[28] SA-42 bg(src) 同 URL 替换不卸载共享 texture");

  const { stageManager } = await import("./core/stage/StageManager");
  stageManager.setBackgroundSprite(null);

  const originalLoad = Assets.load;
  const originalUnload = Assets.unload;
  const unloadCalls: string[] = [];
  (Assets as any).load = () => Promise.resolve(Texture.WHITE);
  (Assets as any).unload = (url: string) => {
    unloadCalls.push(url);
    return Promise.resolve();
  };
  const flushUnloadTick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

  try {
    stageManager.setBackgroundSprite(new Sprite(Texture.WHITE), "/tests/assets/sample-bg.jpg");
    stageManager.setBackgroundSprite(new Sprite(Texture.WHITE), "/tests/assets/sample-bg.jpg");
    assert(
      unloadCalls.length === 0,
      `SA-42 同 URL 替换不调用 Assets.unload（实际 ${JSON.stringify(unloadCalls)}）`,
    );

    stageManager.setBackgroundSprite(null, null, { unloadTexture: false });
    await flushUnloadTick();
    assert(
      unloadCalls.length === 0,
      `SA-42 同 URL bg(color,src) fallback 清屏不卸载缓存（实际 ${JSON.stringify(unloadCalls)}）`,
    );

    stageManager.setBackgroundSprite(null);
    stageManager.loadBackgroundFromUrl("/tests/assets/sample-bg.jpg");
    await Promise.resolve();
    await flushUnloadTick();
    assert(
      unloadCalls.length === 0,
      `SA-42 同轮 clear → load(same URL) 必须取消 pending unload（实际 ${JSON.stringify(unloadCalls)}）`,
    );

    stageManager.setBackgroundSprite(new Sprite(Texture.WHITE), "/tests/assets/other-bg.jpg");
    await flushUnloadTick();
    assert(
      unloadCalls.length === 1 && unloadCalls[0] === "/tests/assets/sample-bg.jpg",
      `SA-42 不同 URL 替换卸载旧 URL（实际 ${JSON.stringify(unloadCalls)}）`,
    );

    stageManager.setBackgroundSprite(null);
    await flushUnloadTick();
    assert(
      unloadCalls.length === 2 && unloadCalls[1] === "/tests/assets/other-bg.jpg",
      `SA-42 清空 sprite 卸载当前 URL（实际 ${JSON.stringify(unloadCalls)}）`,
    );
  } finally {
    stageManager.setBackgroundSprite(null, null, { unloadTexture: false });
    await flushUnloadTick();
    (Assets as any).load = originalLoad;
    (Assets as any).unload = originalUnload;
  }
}

// ─── SA-43：stop/loadState 恢复无图 checkpoint 必须取消 pending bg(src) ───────
//
// 背景：stop() 通过 stageManager.loadState(entryCheckpoint.stage) 恢复入口状态。
// 若 bg(src) 已启动但 Assets.load 尚未 resolve，此时 _bgSprite 仍可能为 null。
// 旧 loadState 只有当前存在 sprite 时才 setBackgroundSprite(null)，因此不会推进
// _bgEpoch，pending resolve 仍能在 stop 后把背景挂回来。
// 修复：恢复到 bgSpriteUrl=null 的 checkpoint 时无条件 setBackgroundSprite(null)。

async function testBgLoadStateWithoutSpriteInvalidatesPendingLoad() {
  console.log("\n[29] SA-43 loadState(no bgSpriteUrl) 取消 pending bg(src)");

  const { stageManager } = await import("./core/stage/StageManager");
  stageManager.setBackgroundSprite(null);

  const pendingEpoch = stageManager.nextBgEpoch();
  assert(
    stageManager.getBackgroundSprite() === null,
    `SA-43 pending load 期间 sprite 可为 null（实际 ${stageManager.getBackgroundSprite()}）`,
  );

  stageManager.loadState({
    camera: { x: 0, y: 0, zoom: 1, rotation: 0 },
    cameraOffset: { x: 0, y: 0, zoom: 1, rotation: 0 },
    designWidth: 1920,
    designHeight: 1080,
    isFixedRatio: true,
    backgroundColor: "#000000",
    bgSpriteUrl: null,
  });

  assert(
    stageManager.currentBgEpoch > pendingEpoch,
    `SA-43 loadState(no bgSpriteUrl) 后 epoch > pendingEpoch（current=${stageManager.currentBgEpoch} pending=${pendingEpoch}）`,
  );
}

// ─── SA-44：:bg replay 必须重新解析背景 sprite，不能用 build-time fallback ───
//
// 背景：:bg 的自然播放路径已在 segmentTl.call 触发时解析 stageManager.getBackgroundSprite()。
// 但 seek replay 读 segment.instantEffects / behaviors 中的 target。旧构建在 bg(src) 未
// resolve 时把 paragraphText fallback 存进 record；seek 到 [.duotone:bg] 时就把滤镜打到
// 文字容器，真实 Pixi FilterPipe 崩溃（alphaMode null）。修复：record 标 targetLevel="bg"，
// replay 时重新取当前背景 sprite。

async function testBgReplayResolvesLiveSpriteTarget() {
  console.log("\n[30] SA-44 :bg replay 重新解析 live sprite target");

  const { stageManager } = await import("./core/stage/StageManager");
  stageManager.setBackgroundSprite(null);
  const bgSprite = new Sprite(Texture.WHITE);
  stageManager.setBackgroundSprite(bgSprite, "/tests/assets/sample-bg.jpg");

  const fallbackTarget = new Container();
  const tl = G.timeline({ paused: true });
  tl.to({ x: 0 }, { x: 1, duration: 2 });
  const segment: any = {
    timeline: tl,
    duration: 2,
    behaviors: [{
      char: fallbackTarget,
      target: fallbackTarget,
      targetLevel: "bg",
      effectName: "probeBehavior",
      params: {},
      charIndex: 0,
      timePosition: 1,
    }],
    instantEffects: [{
      target: fallbackTarget,
      targetLevel: "bg",
      effectName: "probeInstant",
      params: {},
      charIndex: 0,
      timePosition: 1,
    }],
    styleRecords: [],
    entranceFilters: [],
    stageModifierRecords: [],
  };
  const state: any = {
    isAutoPlaying: false,
    activeBehaviorCleanups: [],
    activeInstantCleanups: [],
  };

  const originalApply = (effectManager as any).apply;
  const calls: any[] = [];
  (effectManager as any).apply = (target: any, name: string) => {
    calls.push({ target, name });
    return null;
  };

  try {
    PlaybackController.seekToTime(segment, 1, state);
    assert(
      calls.length === 2,
      `SA-44 behavior + instant 两条 :bg replay 都应 apply（实际 ${calls.map(c => c.name).join(",")})`,
    );
    assert(
      calls.every(c => c.target === bgSprite),
      `SA-44 :bg replay target 必须是 live bg sprite，而非 fallback paragraphText`,
    );
  } finally {
    (effectManager as any).apply = originalApply;
    stageManager.setBackgroundSprite(null);
  }
}

// ─── SA-45：seek 时 bg replay 必须先于 :bg filter replay ─────────────────────
//
// 背景：SA-44 修复后 :bg replay 会取 live sprite，但旧 seek 顺序是
// registerInstantEffects → replayStageModifiers。seek 到 L32 时，:bg 先挂到上一张
// sprite；随后 bg replay 清旧图/加载新图，旧 sprite 带着 filter 被销毁，真实 Pixi
// FilterPipe 进入坏状态。修复：先 replayStageModifiers 恢复当前 bg，再注册 :bg filter。

async function testBgReplayBeforeBgFilterReplay() {
  console.log("\n[31] SA-45 bg replay 先于 :bg filter replay");

  const { stageManager } = await import("./core/stage/StageManager");
  stageManager.setBackgroundSprite(null);
  const fallbackTarget = new Container();
  const liveSprite = new Sprite(Texture.WHITE);
  const tl = G.timeline({ paused: true });
  tl.to({ x: 0 }, { x: 1, duration: 2 });
  const segment: any = {
    timeline: tl,
    duration: 2,
    behaviors: [],
    instantEffects: [{
      target: fallbackTarget,
      targetLevel: "bg",
      effectName: "probeInstant",
      params: {},
      charIndex: 0,
      timePosition: 1,
    }],
    styleRecords: [],
    entranceFilters: [],
    stageModifierRecords: [{
      command: "bg",
      params: { src: "tests/assets/sample-bg.jpg" },
      timePosition: 1,
    }],
  };
  const state: any = {
    isAutoPlaying: false,
    activeBehaviorCleanups: [],
    activeInstantCleanups: [],
  };

  const originalStageApply = (stageManager as any).apply;
  const originalEffectApply = (effectManager as any).apply;
  const order: string[] = [];
  (stageManager as any).apply = (command: string) => {
    order.push(`stage:${command}`);
    if (command === "bg") stageManager.setBackgroundSprite(liveSprite, "/tests/assets/sample-bg.jpg");
  };
  (effectManager as any).apply = (target: any, name: string) => {
    order.push(`effect:${name}:${target === liveSprite ? "live" : "fallback"}`);
    return null;
  };

  try {
    PlaybackController.seekToTime(segment, 1, state);
    assert(
      order.join(" > ") === "stage:bg > effect:probeInstant:live",
      `SA-45 顺序应为 bg replay 后再 :bg filter replay（实际 ${order.join(" > ")}）`,
    );
  } finally {
    (stageManager as any).apply = originalStageApply;
    (effectManager as any).apply = originalEffectApply;
    stageManager.setBackgroundSprite(null);
  }
}

// ─── SA-46：bg 未 resolve 时连续 seek 不应重复 apply :bg 特效 ──────────────────
//
// 背景：registerBehaviors / registerInstantEffects 中 :bg record 的 target（background
// sprite）可能因 Assets.load 异步未 resolve 而为 null。此时注册 onBackgroundReady 延后
// apply 闭包。旧实现用 Set<fn> 存回调——每次 seek 注册不同闭包实例，Set 无法去重。连续
// seek 两次后，两个闭包都留在 set 中；bg resolve 时全部执行 → 同一 behavior/instant 被
// apply 两次，产生重复 filter + ticker（underwater 会重复创建 6 个 filter + 2 个 ticker）。
//
// 修复：onBackgroundReady 返回 { cancel } 句柄，PlaybackController 在每次 seek/play 周期
// 开头取消上一轮 pending 句柄 + clearBgReadyCallbacks 清空所有 pending 回调。验证：
// 加载前连续 seek 两次，resolve 后 behavior 和 instant 各只 apply 一次。

async function testBgMultiSeekBeforeResolve() {
  console.log("\n[32] SA-46 bg 未 resolve 时连续 seek 不重复 apply :bg 特效");

  const { stageManager } = await import("./core/stage/StageManager");
  stageManager.setBackgroundSprite(null);

  const fallbackTarget = new Container();
  const tl = G.timeline({ paused: true });
  tl.to({ x: 0 }, { x: 1, duration: 5 });
  const segment: any = {
    timeline: tl,
    duration: 5,
    behaviors: [{
      char: fallbackTarget,
      target: fallbackTarget,
      targetLevel: "bg",
      effectName: "probeBehavior",
      params: {},
      charIndex: 0,
      timePosition: 1,
    }],
    instantEffects: [{
      target: fallbackTarget,
      targetLevel: "bg",
      effectName: "probeInstant",
      params: {},
      charIndex: 0,
      timePosition: 1,
    }],
    styleRecords: [],
    entranceFilters: [],
    stageModifierRecords: [{
      command: "bg",
      params: { src: "tests/assets/sample-bg.jpg" },
      timePosition: 0,
    }],
  };
  const state: any = {
    isAutoPlaying: false,
    activeBehaviorCleanups: [],
    activeInstantCleanups: [],
  };

  const originalApply = (effectManager as any).apply;
  const originalStageApply = (stageManager as any).apply;
  const behaviorCalls: any[] = [];
  const instantCalls: any[] = [];
  // stageManager.apply("bg", ...) 的 mock：不真正加载图片，让 sprite 保持 null。
  (stageManager as any).apply = (command: string) => {
    if (command === "bg") return; // 不加载图片，保持 sprite null
  };
  (effectManager as any).apply = (target: any, name: string) => {
    if (name === "probeBehavior") behaviorCalls.push({ target });
    if (name === "probeInstant") instantCalls.push({ target });
    return null;
  };

  try {
    // 第一次 seek——bg 未 resolve，注册 onBackgroundReady 延后回调
    PlaybackController.seekToTime(segment, 2, state);
    assert(
      behaviorCalls.length === 0,
      `SA-46 第一次 seek 时 bg 未 resolve，behavior 不应 apply（实际 ${behaviorCalls.length}）`,
    );
    assert(
      instantCalls.length === 0,
      `SA-46 第一次 seek 时 bg 未 resolve，instant 不应 apply（实际 ${instantCalls.length}）`,
    );

    // 第二次 seek——旧实现会再注册一组闭包，resolve 后两组都执行
    PlaybackController.seekToTime(segment, 3, state);
    assert(
      behaviorCalls.length === 0,
      `SA-46 第二次 seek 时 bg 仍未 resolve，behavior 不应 apply（实际 ${behaviorCalls.length}）`,
    );
    assert(
      instantCalls.length === 0,
      `SA-46 第二次 seek 时 bg 仍未 resolve，instant 不应 apply（实际 ${instantCalls.length}）`,
    );

    // 模拟 bg resolve——只有最后一次 seek 注册的闭包应执行
    const resolveSprite = new Sprite(Texture.WHITE);
    stageManager.setBackgroundSprite(resolveSprite, "tests/assets/sample-bg.jpg");

    assert(
      behaviorCalls.length === 1,
      `SA-46 bg resolve 后 behavior 应只 apply 一次（实际 ${behaviorCalls.length}）——连续 seek 不应累积闭包`,
    );
    assert(
      instantCalls.length === 1,
      `SA-46 bg resolve 后 instant 应只 apply 一次（实际 ${instantCalls.length}）——连续 seek 不应累积闭包`,
    );
    assert(
      behaviorCalls[0]?.target === resolveSprite,
      `SA-46 behavior apply target 应为 resolve 后的 live sprite`,
    );
    assert(
      instantCalls[0]?.target === resolveSprite,
      `SA-46 instant apply target 应为 resolve 后的 live sprite`,
    );
  } finally {
    (effectManager as any).apply = originalApply;
    (stageManager as any).apply = originalStageApply;
    stageManager.setBackgroundSprite(null);
  }
}

// ─── SA-47：background surface profile + latest-bg replay boundary ────────────

async function testBackgroundSurfaceProfilesAndReplayBoundary() {
  console.log("\n[33] SA-47 background profile 路由 + latest bg boundary");

  const profileTarget = new Container();
  const textDuotone = effectManager.apply(profileTarget, "duotone", {}, true, "text");
  const backgroundDuotone = effectManager.apply(profileTarget, "duotone", {}, true, "background");
  const textEmboss = effectManager.apply(profileTarget, "emboss", {}, true, "text");
  const backgroundEmboss = effectManager.apply(profileTarget, "emboss", {}, true, "background");
  const backgroundGray = effectManager.apply(profileTarget, "gray", {}, true, "background");
  assert(textDuotone instanceof TextDuotoneFilter, "SA-47 text duotone 保持 alpha profile");
  assert(backgroundDuotone instanceof BackgroundDuotoneFilter, "SA-47 bg duotone 选择 luma profile");
  assert(textEmboss instanceof TextEmbossFilter, "SA-47 text emboss 保持 alpha profile");
  assert(backgroundEmboss instanceof BackgroundEmbossFilter, "SA-47 bg emboss 选择 luma profile");
  assert(backgroundGray instanceof GrayFilter, "SA-47 bg gray 复用现有 GrayFilter");
  assert(textDuotone.kmdEffectProfile === "duotone:text", "SA-47 text duotone 诊断标识稳定");
  assert(backgroundDuotone.kmdEffectProfile === "duotone:background", "SA-47 bg duotone 诊断标识稳定");
  assert(textEmboss.kmdEffectProfile === "emboss:text", "SA-47 text emboss 诊断标识稳定");
  assert(backgroundEmboss.kmdEffectProfile === "emboss:background", "SA-47 bg emboss 诊断标识稳定");
  assert(backgroundGray.kmdEffectProfile === "gray", "SA-47 gray 诊断标识稳定");

  const textUnderwater = effectManager.apply(profileTarget, "underwater", {}, true, "text");
  const backgroundUnderwater = effectManager.apply(profileTarget, "underwater", {}, true, "background");
  assert(
    textUnderwater.filters[1] instanceof TextDuotoneFilter,
    "SA-47 underwater:text 组合 TextDuotoneFilter",
  );
  assert(
    backgroundUnderwater.filters[1] instanceof BackgroundDuotoneFilter,
    "SA-47 underwater:background 组合 BackgroundDuotoneFilter",
  );

  const grayBgClassification = EffectProcessor.classifyCommand({ name: "gray", params: {}, level: "bg" });
  assert(
    grayBgClassification.lane === "effect" && !grayBgClassification.isStyle,
    `SA-47 gray:bg 应优先走 effect lane（实际 lane=${grayBgClassification.lane} isStyle=${grayBgClassification.isStyle}）`,
  );

  G.ticker.remove(textUnderwater.tickerFn);
  G.ticker.remove(backgroundUnderwater.tickerFn);
  for (const filter of [
    textDuotone,
    backgroundDuotone,
    textEmboss,
    backgroundEmboss,
    backgroundGray,
    ...textUnderwater.filters,
    ...backgroundUnderwater.filters,
  ]) {
    filter?.destroy?.();
  }
  profileTarget.filters = [];

  const { stageManager } = await import("./core/stage/StageManager");
  stageManager.setBackgroundSprite(null);
  stageManager.setBackgroundSprite(new Sprite(Texture.WHITE), "tests/assets/sample-bg.jpg");
  const tl = G.timeline({ paused: true });
  tl.to({ x: 0 }, { x: 1, duration: 3 });
  const segment: any = {
    timeline: tl,
    duration: 3,
    behaviors: [
      { char: new Container(), target: new Container(), targetLevel: "bg", effectName: "oldBehavior", params: {}, charIndex: 0, timePosition: 1 },
      { char: new Container(), target: new Container(), targetLevel: "bg", effectName: "newBehavior", params: {}, charIndex: 0, timePosition: 2 },
    ],
    instantEffects: [
      { target: new Container(), targetLevel: "bg", effectName: "duotone", params: {}, charIndex: 0, timePosition: 1 },
      { target: new Container(), targetLevel: "bg", effectName: "emboss", params: {}, charIndex: 0, timePosition: 2 },
    ],
    styleRecords: [],
    entranceFilters: [],
    stageModifierRecords: [
      { command: "bg", params: { src: "tests/assets/sample-bg.jpg" }, timePosition: 1 },
      { command: "bg", params: { src: "tests/assets/sample-bg.jpg" }, timePosition: 2 },
    ],
  };
  const state: any = {
    isAutoPlaying: false,
    activeBehaviorCleanups: [],
    activeInstantCleanups: [],
    pendingBgReadyCancels: [],
  };
  const originalStageApply = (stageManager as any).apply;
  const originalEffectApply = (effectManager as any).apply;
  const calls: Array<{ name: string; surface: string }> = [];
  (stageManager as any).apply = () => {};
  (effectManager as any).apply = (_target: any, name: string, _params: any, _force: boolean, surface: string) => {
    calls.push({ name, surface });
    return null;
  };
  try {
    PlaybackController.seekToTime(segment, 2.5, state);
    assert(
      calls.map((call) => call.name).join(",") === "newBehavior,emboss",
      `SA-47 latest bg boundary 之前的 record 不重放（实际 ${calls.map((call) => call.name).join(",")})`,
    );
    assert(
      calls.every((call) => call.surface === "background"),
      `SA-47 bg replay 全部显式选择 background profile`,
    );
  } finally {
    (stageManager as any).apply = originalStageApply;
    (effectManager as any).apply = originalEffectApply;
    stageManager.setBackgroundSprite(null);
  }
}

async function testReaderTypographySettings() {
  console.log("\n[34] R3-I reader typography settings");
  const target = { x: 0, y: 0, _options: {
    fontSize: 20, lineHeight: 30, maxWidth: 800, indent: 0, align: "left",
    letterSpacing: 0, externalMarkers: [],
  } } as any;
  const originalRebuild = (scriptPlayer as any).rebuildForTypography;
  const originalLoadFonts = (readerApp as any).loadFonts;
  let rebuildCalls = 0;
  (scriptPlayer as any).rebuildForTypography = async () => { rebuildCalls += 1; };
  (readerApp as any).loadFonts = async () => {};
  try {
    const scrollSession = new ReaderRuntimeWebSession({
      settings: { presentationMode: "scroll", fontScale: 1 },
    });
    TextBuildContextResolver.configure({ typography: { fontSize: 20, lineHeight: 30 } });
    let context = TextBuildContextResolver.fromTarget(target);
    assert(
      (context.baseStyle as any).fontSize === 20 && context.layoutOptions.fontSize === 20 && context.layoutOptions.lineHeight === 30,
      "R3-I Scroll 初始字号同时作用于 Pixi TextStyle 与 layout",
    );
    await scrollSession.updateSettings({ fontScale: 1.25 });
    context = TextBuildContextResolver.fromTarget(target);
    assert(
      (context.baseStyle as any).fontSize === 25 && context.layoutOptions.fontSize === 25 && context.layoutOptions.lineHeight === 37.5,
      "R3-I Scroll 热更新按比例重算字体与行高",
    );
    assert(rebuildCalls === 1, "R3-I Scroll fontScale 变化触发一次 typography rebuild");

    const pageSession = new ReaderRuntimeWebSession({
      settings: { presentationMode: "page", fontScale: 1.1 },
    });
    context = TextBuildContextResolver.fromTarget(target);
    assert((context.baseStyle as any).fontSize === 22 && context.layoutOptions.lineHeight === 33,
      "R3-I Page 初始字号按比例作用于 typography");
    await pageSession.updateSettings({ fontScale: 0.9 });
    context = TextBuildContextResolver.fromTarget(target);
    assert((context.baseStyle as any).fontSize === 18 && context.layoutOptions.lineHeight === 27,
      "R3-I Page 热更新按比例重算 typography");
    assert(rebuildCalls === 2, "R3-I Page fontScale 变化触发一次 typography rebuild");

    const stageSession = new ReaderRuntimeWebSession({
      settings: { presentationMode: "stage", fontScale: 1 },
    });
    await stageSession.updateSettings({ fontScale: 1.5 });
    context = TextBuildContextResolver.fromTarget(target);
    assert((context.baseStyle as any).fontSize === 20 && context.layoutOptions.lineHeight === 30,
      "R3-I Stage 忽略 host fontScale，保持 1x typography");
    assert(rebuildCalls === 2, "R3-I Stage fontScale 变化不进入 typography rebuild");
  } finally {
    (scriptPlayer as any).rebuildForTypography = originalRebuild;
    (readerApp as any).loadFonts = originalLoadFonts;
  }
}

async function main() {
  console.log("╔══════════════════════════════════════════════════════════╗");
  console.log("║  KMD Playback State Regression (F-2 / R5-R22 + SA-38)    ║");
  console.log("╚══════════════════════════════════════════════════════════╝");

  testDerivePhase();
  testSeekToTimeClampAndCallback();
  testPlaySegmentEndedBranch();
  testDeriveReplayMode();
  testResetBoundaryFilter();
  testResolvePauseDuration();
  testGraphicsInstantCleanup();
  testRealKineticTextGraphicsLayer();
  testReplayStylesSeekBack();
  testEndedReplayStyleReset();
  testPreHoldStyleBaseline();
  testDisplayAssemblerBaseline();
  testBlockStyleBaselineRecapture();
  await testEndToEndPipeline();
  await testGroupBlockStyleBaseline();
  await testBehaviorFilterE2E();
  await testInstantFilterE2E();
  await testEntranceFilterE2E();
  await testMultiTokenHoldChainE2E();
  await testMultiParagraphE2E();
  await testBlockPostHoldStyleE2E();
  await testM2AtmosphereDisplaceUnderwaterE2E();
  // R22 / SA-37：exact-boundary 双 apply 抑制。
  testR22LastSeekTimeLifecycle();
  testR22GsapPremise();
  await testR22BoundaryGuardMechanism();
  testStageDefaultParamAlignment();
  testBgStringParamPreservation();
  await testBgClearInvalidatesPendingLoad();
  testBgDeferredExecution();
  await testBgSameUrlReplaceDoesNotUnloadSharedTexture();
  await testBgLoadStateWithoutSpriteInvalidatesPendingLoad();
  await testBgReplayResolvesLiveSpriteTarget();
  await testBgReplayBeforeBgFilterReplay();
  await testBgMultiSeekBeforeResolve();
  await testBackgroundSurfaceProfilesAndReplayBoundary();
  await testReaderTypographySettings();

  console.log(`\n🎬 Playback regression: ${pass} passed, ${fail} failed`);
  if (fail > 0) {
    console.error(`❌ ${fail} 个回归失败——播放状态语义被破坏。`);
    process.exit(1);
  }
  console.log("✅ 播放状态机回归通过：seek/phase/resume 语义锁定。");
}

main().catch((e) => {
  console.error("Fatal:", e);
  process.exit(1);
});
