// Playback 渐拆共享 harness（主题一：织网 S8）。
//
// 收编 final-playback-test.ts 中被复制粘贴 9 次的 build()、6 次的 fillHex、以及 makeFakeSegment /
// makeFakeState / ownRecords——迁出的每组用例（playback-*.test.ts）共享这一份，不再各自重定义。
//
// ⚠️ 铁律一（历史纪律，2026-08 起）：final-playback-test.ts（3846 行，main() import 即执行 +
//   process.exit）与 playback-regression.test.ts 子进程包装已于主题一织网 S15 退役删除。
//   本 harness 是 playback 套件的唯一共享件——不要复活「子进程包装 + 独立 runner」模式，
//   新用例一律进 playback-*.test.ts（计数锚点见 playback-tripwire.test.ts）。
//
// ⚠️ 铁律二：**build() 内用 new KMDParser()，不用 parser 单例**。单例的 AstParser.braceIdCounter
//   跨 parse() 累积（golden 套件同源判例，parser-golden.test.ts:15-16,50）；singleFork 顺序执行
//   下虽不致命，但确定性不押在执行顺序上是家法。
//
// ⚠️ 消费者 teardown 契约（singleFork 共享进程，单例污染必须每用例自清）：
//   - 动过 layout.globalMarkers（var.* / marker）→ afterEach(() => layout.reset(true))
//   - bg 生命周期用例 → beforeEach(() => stageManager.setBackgroundSprite(null))
//     （原脚本 testBgClearInvalidatesPendingLoad 依赖「前序用例已清理」的隐式顺序前提；
//      迁出后顺序无关性即正确性判据，见 S13 有意变更标注）
//   - vi.spyOn 的 monkeypatch → afterEach(() => vi.restoreAllMocks())
//   - vi.stubGlobal → afterEach(() => vi.unstubAllGlobals())
//
// test:playback 门禁（package.json）= `vitest run src/test/playback`（子串过滤，自动覆盖
// 本文件的所有消费者 playback-*.test.ts，含 playback-tripwire.test.ts 计数锚点）。

import { Container } from 'pixi.js';
import { KMDParser } from '@kmd/core/parser/Parser';
import { SegmentBuilder } from '@kmd/core/player/SegmentBuilder';
import type { Segment } from '@kmd/core/state/Segment';
import type { SourceLineAnchor } from '@kmd/core/render/text/TextPlayer';
import { G, SYNTHETIC_METRICS, approxEq } from './setup';

// 同源转导出：消费者从本 harness 一站式取齐 playback 断言工具，不必各自 import setup。
export { G, SYNTHETIC_METRICS, approxEq };

/**
 * 结构合法的空 segment（收编自 final-playback-test.ts:81-97）：
 * record 数组全空 → seekToTime/playSegment 的 register/replay 系列退化为 no-op，
 * 只跑 clamp + 真实 gsap.seek + onTimeUpdate。timeline 是真实 gsap。
 *
 * timeline 必须含一个占位 tween 使其 duration() === duration 秒——否则空 timeline duration=0，
 * 任何 seek 都让 progress()=1，无法复现 playing-mid / paused-mid 态。
 * 占位 tween 用独立目标对象（{p:0}→{p:1}），无副作用，derivePhase/seekToTime 只读 progress/time。
 */
export function makeFakeSegment(duration: number): Segment {
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
    entryCheckpoint: { time: 0, label: '' },
    exitCheckpoint: { time: duration, label: '' },
  } as unknown as Segment;
}

/**
 * 最小 playbackState 假件（收编自 final-playback-test.ts:99-110）：
 * 捕获 onTimeUpdate 的 ms 回调供断言；getLastTimeUpdate 读最近一次。
 */
export function makeFakeState(isAutoPlaying: boolean) {
  let lastTimeUpdate: number | undefined;
  const state = {
    isAutoPlaying,
    activeBehaviorCleanups: [] as any[],
    activeInstantCleanups: [] as any[],
    onTimeUpdate: (timeMs: number) => {
      lastTimeUpdate = timeMs;
    },
  };
  return { state, getLastTimeUpdate: () => lastTimeUpdate };
}

/**
 * 读 fill 的 hex（收编自 final-playback-test.ts:1687-1691，原 6 处复制）：
 * 真实管线下 char 级样式经 Pixi v8 规范化成 Fill 对象（{color: number}），
 * block 级经 applyGroupEffects 同步写仍是字符串。两种都要支持，统一转 hex 字符串比较。
 * SA-27 教训落地：fake char 测试用字符串 fill 会掩盖真实管线的 Fill 对象——必须读真实类型。
 */
export function fillHex(f: any): string {
  if (typeof f === 'string') return f;
  if (f && typeof f.color === 'number') return '#' + (f.color >>> 0).toString(16).padStart(6, '0');
  return String(f);
}

/** styleRecords 中属于该 char 的（styleName@time）（收编自 final-playback-test.ts:1817-1821）。 */
export function ownRecords(segment: Segment, char: any): string[] {
  return (segment as any).styleRecords
    .filter((r: any) => r.char === char)
    .map((r: any) => `${r.styleName}@${(r.timePosition ?? 0).toFixed(2)}`);
}

export interface PlaybackBuildResult {
  segment: Segment;
  /** 首个 segment 首个文本里第一个非空白字符（跳过换行/空白 carrier）。 */
  char: any;
  playbackState: any;
  sourceLineAnchors: SourceLineAnchor[];
}

/**
 * 跑一个 KMD 源串端到端：new KMDParser().parse → SegmentBuilder.build → 返回首字符
 * （收编自 final-playback-test.ts:1694/1823 等 9+1 处复制粘贴，统一为一份）。
 * 消费者拿到后可直接 PlaybackController.seekToTime(segment, t, playbackState) 驱动断言。
 */
export async function build(source: string): Promise<PlaybackBuildResult> {
  const result = new KMDParser().parse(source);
  const playbackState = {
    isAutoPlaying: false,
    activeBehaviorCleanups: [] as any[],
    activeInstantCleanups: [] as any[],
  } as any;
  const { segment, activeTexts, sourceLineAnchors } = await SegmentBuilder.build({
    container: new Container(),
    metadata: { variables: {} } as any,
    paragraphs: result.paragraphs,
    rawParagraphs: result.rawParagraphs,
    currentMode: 'stage',
    playbackState,
  });
  const chars = (activeTexts[0] as any)._displayAssembly.chars;
  const char = chars.find((c: any) => c.text.trim()) ?? chars[0];
  return { segment, char, playbackState, sourceLineAnchors };
}

/** buildAndSeek 是 build 的历史别名（原脚本 :1694 的叫法）；语义相同，保留便于迁移对照。 */
export const buildAndSeek = build;
