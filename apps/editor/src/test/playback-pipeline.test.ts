// 端到端真实管线回归 [13]-[20.5]（主题一：织网 S11 / playback 渐拆第 3 批）。
//
// 迁自 final-playback-test.ts 的 testEndToEndPipeline([13]) / testGroupBlockStyleBaseline([14]) /
// testBehaviorFilterE2E([15]) / testInstantFilterE2E([16]) / testEntranceFilterE2E([17]) /
// testMultiTokenHoldChainE2E([18]) / testMultiParagraphE2E([19]) / testBlockPostHoldStyleE2E([20]) /
// testM2AtmosphereDisplaceUnderwaterE2E([20.5])——9 个 async 函数。
//
// 收编红利：原脚本中 9 份复制粘贴的 build()/buildAndSeek + 6 份 fillHex + 2 份 ownRecords
// 统一为 playback-harness 的一份（new KMDParser() 替代 parser 单例——braceIdCounter 不再跨调用累积；
// 对这批用例行为不变，断言均不读 braceGroupId）。[18]/[19]/[20.5] 的返回形状变体（多 char / 多 text /
// 容器级 kt）在本文件内以 buildTexts() 单一核心派生，不再三处复制。
//
// 诚实边界：
//   - 合成字体度量下几何不真实，style/baseline/timing/seek/filter 生命周期语义真实（setup.ts §1.4）。
//   - [20] case (1) 的墙钟副作用检测用真实 setTimeout(120ms)——vitest 未装 fake timer，此断言
//     依赖真实墙钟（与原脚本同行为；harness 不掩盖此依赖）。
//   - filter 身份断言读 constructor.name（vitest/tsx 环境不 minify，名字稳定；浏览器 e2e 侧另有
//     kmdEffectProfile 约定，见 browser-e2e.md——两条路径各用各的稳定面）。
//   - 本批 fixture 均自含（无跨用例 var/marker 依赖），与原脚本一致不做 layout.reset——
//     刻意保持与原执行语义逐位等价。
//
// 迁移保真：assert() shim 1:1 保留（expect(cond, message).toBe(true)，消息探针验证可见）。

import { describe, it, expect } from 'vitest';
import { PlaybackController } from '../core/player/PlaybackController';
import { KMDParser } from '../core/parser/Parser';
import { SegmentBuilder } from '../core/player/SegmentBuilder';
import { Container } from 'pixi.js';
import type { Segment } from '../core/state/Segment';
import { build, fillHex, ownRecords } from './playback-harness';

/** 断言桥：1:1 保留原脚本 assert(cond, msg) 的诊断文本（vitest 自定义消息）。 */
function assert(cond: boolean, message: string): void {
  expect(Boolean(cond), message).toBe(true);
}

/**
 * 多变体 build 核心（收编 [18]/[19]/[20.5] 的返回形状差异）：返回全部 activeTexts，
 * 各 describe 自取首字符 / 多字符 / 容器级 KineticText。与 harness.build 同源（new KMDParser()）。
 */
async function buildTexts(source: string) {
  const result = new KMDParser().parse(source);
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
    currentMode: 'stage',
    playbackState,
  });
  return { segment, activeTexts, playbackState };
}

const firstNonBlankChar = (text: any): any => {
  const chars = text._displayAssembly.chars;
  return chars.find((c: any) => c.text.trim()) ?? chars[0];
};

describe('[13] 端到端真实管线（parser→SegmentBuilder→seek）（R17-High / SA-32）', () => {
  it('block/char pre-hold baseline + post-hold record + big 单次应用 + ended 重播', async () => {
    // (1)-(3) `[.red:block] + f.hold(1s).bold`：block red baseline + 动态 bold record。
    // block 路径 fill 是字符串（applyGroupEffects 同步写，不进 Pixi 规范化）。
    {
      const { segment, char, playbackState } = await build('[.red:block]\n{Hello} @ f.hold(1s).bold');
      assert(
        fillHex((char as any).baseStyleSnapshot.fill) === '#ff4d4f',
        `R17 e2e block 构建后 baseline.fill = #ff4d4f（实际 ${fillHex((char as any).baseStyleSnapshot.fill)}）`,
      );
      PlaybackController.seekToTime(segment, 1.5, playbackState);
      assert(
        fillHex((char as any).style.fill) === '#ff4d4f' && (char as any).style.fontWeight === 'bold',
        `R17 e2e block SEEK 1.5 = red+bold（实际 fill=${fillHex((char as any).style.fill)} fw=${(char as any).style.fontWeight}）`,
      );
      PlaybackController.seekToTime(segment, 0.5, playbackState);
      assert(
        fillHex((char as any).style.fill) === '#ff4d4f' && (char as any).style.fontWeight !== 'bold',
        `R17 e2e block SEEK 0.5 = red only（实际 fill=${fillHex((char as any).style.fill)} fw=${(char as any).style.fontWeight}）`,
      );
      PlaybackController.seekToTime(segment, 0, playbackState);
      assert(
        fillHex((char as any).style.fill) === '#ff4d4f' && (char as any).style.fontWeight !== 'bold',
        `R17 e2e block SEEK 0 = red only（实际 fill=${fillHex((char as any).style.fill)} fw=${(char as any).style.fontWeight}）`,
      );
    }

    // (4) `f.red.hold(1s).bold`（char 级 pre-hold red + post-hold bold）：red 进 baseline（P1 烘焙），bold 进 record。
    // char 路径 fill 经 Pixi v8 规范化成 Fill 对象（color=0xff4d4f），fillHex 读 .color 转 hex。
    {
      const { segment, char, playbackState } = await build('{Hello} @ f.red.hold(1s).bold');
      assert(
        fillHex((char as any).baseStyleSnapshot.fill) === '#ff4d4f',
        `R17 e2e char 级 red 进 baseline（实际 ${fillHex((char as any).baseStyleSnapshot.fill)}）`,
      );
      PlaybackController.seekToTime(segment, 1.5, playbackState);
      assert(
        fillHex((char as any).style.fill) === '#ff4d4f' && (char as any).style.fontWeight === 'bold',
        `R17 e2e char 级 SEEK 1.5 = red+bold（实际 fill=${fillHex((char as any).style.fill)} fw=${(char as any).style.fontWeight}）`,
      );
      PlaybackController.seekToTime(segment, 0, playbackState);
      assert(
        fillHex((char as any).style.fill) === '#ff4d4f' && (char as any).style.fontWeight !== 'bold',
        `R17 e2e char 级 SEEK 0 = red only（实际 fill=${fillHex((char as any).style.fill)}）`,
      );
    }

    // (5) `f.big.hold(1s).bold`：相对样式 big 进 baseline。
    // KineticText 默认 fontSize=36（rebuild 默认 _options），big *=1.5 → 54。baseline=54 是单次应用
    // 的正确结果（不是双重应用 36→81）。seek 后仍 54（big 不进 record 重放，R15 site3 跳过 pre-hold）+ bold。
    {
      const { segment, char, playbackState } = await build('{Hello} @ f.big.hold(1s).bold');
      assert(
        (char as any).baseStyleSnapshot.fontSize === 54,
        `R17 e2e big 进 baseline = 54（36 默认 ×1.5，单次应用）（实际 ${(char as any).baseStyleSnapshot.fontSize}）`,
      );
      PlaybackController.seekToTime(segment, 1.5, playbackState);
      assert(
        (char as any).style.fontSize === 54 && (char as any).style.fontWeight === 'bold',
        `R17 e2e SEEK 1.5 = big(54)+bold，big 不重复放大（实际 fontSize=${(char as any).style.fontSize} fw=${(char as any).style.fontWeight}）`,
      );
    }

    // (6) ended 重播：`[.red:block] + f.hold(1s).bold` 播完 → playSegment 重播 → 等价 SEEK 0 = red only。
    {
      const { segment, char, playbackState } = await build('[.red:block]\n{Hello} @ f.hold(1s).bold');
      PlaybackController.seekToTime(segment, 1.5, playbackState); // red + bold
      assert((char as any).style.fontWeight === 'bold', 'R17 e2e ended 重播前：bold 生效');
      PlaybackController.seekToTime(segment, (segment as any).duration, playbackState); // ended
      PlaybackController.playSegment(segment, playbackState); // 重播
      assert(
        fillHex((char as any).style.fill) === '#ff4d4f' && (char as any).style.fontWeight !== 'bold',
        `R17 e2e ended 重播 = red only（bold 不残留）（实际 fill=${fillHex((char as any).style.fill)} fw=${(char as any).style.fontWeight}）`,
      );
    }
  });
});

describe('[14] 显式 :group / token 级 :block style 端到端（R19-High / SA-33）', () => {
  it('group/block style 经 P1 烘焙进 baseline；post-hold group style 进 record', async () => {
    // (1) f.red:group → red 进 baseline（P1 烘焙），records=[]。原 bug：被吞，fill=#ffffff records=[]。
    {
      const { segment, char, playbackState } = await build('{Hello} @ f.red:group');
      assert(
        fillHex((char as any).baseStyleSnapshot.fill) === '#ff4d4f',
        `R19 group red 进 baseline（实际 ${fillHex((char as any).baseStyleSnapshot.fill)}）`,
      );
      assert(
        fillHex((char as any).style.fill) === '#ff4d4f',
        `R19 group red 构建后已生效（实际 ${fillHex((char as any).style.fill)}）`,
      );
      assert(
        ownRecords(segment, char).length === 0,
        `R19 group red 不进 record（pre-hold 进 baseline，避免双重应用）（实际 ${JSON.stringify(ownRecords(segment, char))}）`,
      );
    }

    // (2) f.red:block（token 级）→ 同 (1)。原 bug 同样被吞（只有段落广播 [.red:block] 走 P2 已正确）。
    {
      const { segment, char } = await build('{Hello} @ f.red:block');
      assert(
        fillHex((char as any).baseStyleSnapshot.fill) === '#ff4d4f',
        `R19 token 级 :block red 进 baseline（实际 ${fillHex((char as any).baseStyleSnapshot.fill)}）`,
      );
      assert(
        ownRecords(segment, char).length === 0,
        `R19 token 级 :block red 不进 record（实际 ${JSON.stringify(ownRecords(segment, char))}）`,
      );
    }

    // (3) f.big:group → big(×1.5) 进 baseline=54，测量同步应用。seek 后仍 54（不双重放大）。
    // 默认 fontSize=36（同 [13] case 5），big ×1.5=54 是单次应用。
    {
      const { segment, char, playbackState } = await build('{Hello} @ f.big:group');
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
      const { segment, char, playbackState } = await build('{Hello} @ f.red:group');
      PlaybackController.seekToTime(segment, 1.0, playbackState);
      assert(
        fillHex((char as any).style.fill) === '#ff4d4f',
        `R19 group red seek 1.0 仍 red（实际 ${fillHex((char as any).style.fill)}）`,
      );
      PlaybackController.seekToTime(segment, 0, playbackState);
      assert(
        fillHex((char as any).style.fill) === '#ff4d4f',
        `R19 group red seek 0 仍 red（baseline 幂等）（实际 ${fillHex((char as any).style.fill)}）`,
      );
    }

    // (5) f.red:group.hold(1s).bold：red 是 pre-hold → 进 baseline；bold 是 post-hold → 进 record。
    // 对应用户探针最后一行（base=red + records=[bold]）。验证 pre-hold group style 与 post-hold
    // 动态样式在同一条链里正确分流（R19 + R15 site3 模型对 group style 也成立）。
    {
      const { segment, char, playbackState } = await build('{Hello} @ f.red:group.hold(1s).bold');
      assert(
        fillHex((char as any).baseStyleSnapshot.fill) === '#ff4d4f',
        `R19 group pre-hold red 进 baseline（实际 ${fillHex((char as any).baseStyleSnapshot.fill)}）`,
      );
      const recs = ownRecords(segment, char);
      assert(
        recs.length === 1 && recs[0].startsWith('bold@'),
        `R19 group post-hold bold 进 record（实际 ${JSON.stringify(recs)}）`,
      );
      PlaybackController.seekToTime(segment, 1.5, playbackState);
      assert(
        fillHex((char as any).style.fill) === '#ff4d4f' && (char as any).style.fontWeight === 'bold',
        `R19 group SEEK 1.5 = red(baseline)+bold(record)（实际 fill=${fillHex((char as any).style.fill)} fw=${(char as any).style.fontWeight}）`,
      );
      PlaybackController.seekToTime(segment, 0, playbackState);
      assert(
        fillHex((char as any).style.fill) === '#ff4d4f' && (char as any).style.fontWeight !== 'bold',
        `R19 group SEEK 0 = red only（bold 回退，red baseline 保留）（实际 fill=${fillHex((char as any).style.fill)} fw=${(char as any).style.fontWeight}）`,
      );
    }

    // (6) f.hold(1s).red:group：red 是 post-hold → 进 record（不进 baseline）。seek 0.5 无红、1.5 有红、0 回退无红。
    // 验证 R19 没有把 post-hold group style 错误地烘焙进 baseline（post-hold 必须进 record 才能回退）。
    {
      const { segment, char, playbackState } = await build('{Hello} @ f.hold(1s).red:group');
      assert(
        fillHex((char as any).baseStyleSnapshot.fill) !== '#ff4d4f',
        `R19 group post-hold red 不进 baseline（实际 ${fillHex((char as any).baseStyleSnapshot.fill)}）`,
      );
      const recs = ownRecords(segment, char);
      assert(
        recs.length === 1 && recs[0].startsWith('red@'),
        `R19 group post-hold red 进 record（实际 ${JSON.stringify(recs)}）`,
      );
      PlaybackController.seekToTime(segment, 0.5, playbackState);
      assert(
        fillHex((char as any).style.fill) !== '#ff4d4f',
        `R19 group post-hold SEEK 0.5 无 red（record 未到时间）（实际 ${fillHex((char as any).style.fill)}）`,
      );
      PlaybackController.seekToTime(segment, 1.5, playbackState);
      assert(
        fillHex((char as any).style.fill) === '#ff4d4f',
        `R19 group post-hold SEEK 1.5 有 red（record 重放）（实际 ${fillHex((char as any).style.fill)}）`,
      );
      PlaybackController.seekToTime(segment, 0, playbackState);
      assert(
        fillHex((char as any).style.fill) !== '#ff4d4f',
        `R19 group post-hold SEEK 0 回退无 red（实际 ${fillHex((char as any).style.fill)}）`,
      );
    }

    // (7) 对照组：f.red（char）仍正确——R19 解耦只对 level==="group"/"block" 的 style 生效，
    // char 级（level undefined）行为不变。防 R15/R17 回归。
    {
      const { segment, char } = await build('{Hello} @ f.red');
      assert(
        fillHex((char as any).baseStyleSnapshot.fill) === '#ff4d4f',
        `R19 对照 char red 进 baseline（未受 R19 影响）（实际 ${fillHex((char as any).baseStyleSnapshot.fill)}）`,
      );
      assert(
        ownRecords(segment, char).length === 0,
        `R19 对照 char red 不进 record（实际 ${JSON.stringify(ownRecords(segment, char))}）`,
      );
    }
  });
});

describe('[15] behavior-track filter build + seek 幂等（SA-34 / SA-27）', () => {
  it('blur char 级：seek 时 apply + cleanup 登记；多次 seek 幂等不堆积；与 entrance 共存不互误清', async () => {
    // (1) f.blur（char 级 behavior filter）：build 后仅注册 BehaviorRecord（blur@0），filter 尚未 apply
    //      （behavior filter 在 seek/播放时经 registerBehaviors 才 apply + push char.filters + 登记 cleanup）。
    //      seek(1.0) 后：char.filters 有 BlurFilter、activeBehaviorCleanups 有 1 条（modName=blur）。
    //      多次 seek 来回幂等：filter 始终 1 个（不堆积）、cleanup 始终 1 条。
    {
      const { segment, char, playbackState } = await build('{Hello} @ f.blur');
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
        Array.isArray(filters) && filters.length === 1 && filters[0]?.constructor?.name === 'BlurFilter',
        `R15e2e blur seek 1.0 后 char.filters 有 1 个 BlurFilter（实际 ${filters?.length} ${filters?.[0]?.constructor?.name}）`,
      );
      const cleanups = playbackState.activeBehaviorCleanups;
      assert(
        cleanups.length >= 1 && cleanups.every((c: any) => c.modName === 'blur'),
        `R15e2e blur seek 1.0 后 cleanup 全部 modName=blur（实际 ${cleanups.length} 条）（实际 ${JSON.stringify(cleanups.map((c: any) => c.modName))}）`,
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
      const { segment, char, playbackState } = await build('{Hello} @ f.blurIn.blur');
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
  });
});

describe('[16] instant-track filter build + seek 回退（SA-34 / SA-27）', () => {
  it('pixelate：seek 时 apply + cleanup；post-hold 按 timePosition 过滤；回退移除不堆积', async () => {
    // (1) f.pixelate（char 级 instant filter，纯 effect）：build 后仅注册 InstantEffectRecord，
    //      filter 未 apply（registerInstantEffects 在 seek 时才跑）。seek 1.0 后 filter apply +
    //      cleanup 登记；seek 来回不堆积。
    {
      const { segment, char, playbackState } = await build('{Hello} @ f.pixelate');
      assert(
        !(char as any).filters || (char as any).filters.length === 0,
        `R16e2e pixelate build 后 filter 未 apply（seek 时才 apply）（实际 ${(char as any).filters?.length}）`,
      );
      PlaybackController.seekToTime(segment, 1.0, playbackState);
      const filters = (char as any).filters;
      assert(
        Array.isArray(filters) && filters.length === 1 && filters[0]?.constructor?.name === 'PixelateFilter',
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
      const { segment, char, playbackState } = await build('{Hello} @ f.hold(1s).pixelate');
      PlaybackController.seekToTime(segment, 0.5, playbackState);
      assert(
        !(char as any).filters || (char as any).filters.length === 0,
        `R16e2e post-hold pixelate seek 0.5（未生效）filter 不在（实际 ${(char as any).filters?.length}）`,
      );
      PlaybackController.seekToTime(segment, 1.5, playbackState);
      assert(
        (char as any).filters?.length === 1 && (char as any).filters[0]?.constructor?.name === 'PixelateFilter',
        `R16e2e post-hold pixelate seek 1.5（生效）filter 在（实际 ${(char as any).filters?.length} ${((char as any).filters?.[0]?.constructor?.name)}）`,
      );
      PlaybackController.seekToTime(segment, 0.5, playbackState);
      assert(
        !(char as any).filters || (char as any).filters.length === 0,
        `R16e2e post-hold pixelate seek 0.5 回退 filter 移除（实际 ${(char as any).filters?.length}）`,
      );
    }
  });
});

describe('[17] entrance filter（blurIn）生命周期（SA-34 / SA-27）', () => {
  it('blurIn：build 即 apply；seek 不清理靠插值；与 style record 两管线不互扰', async () => {
    // (1) f.blurIn：build 后 segment.entranceFilters 有记录（BlurFilter），tween 在时间线。
    //      char.filters 含 BlurFilter（blurIn 的 filter 已 push）。
    {
      const { segment, char, playbackState } = await build('{Hello} @ f.blurIn');
      const entranceRecs = (segment as any).entranceFilters ?? [];
      assert(
        entranceRecs.length >= 1,
        `R17e2e blurIn build 后 entranceFilters 有记录（实际 ${entranceRecs.length}）`,
      );
      assert(
        Array.isArray((char as any).filters) && (char as any).filters.length >= 1 && (char as any).filters[0]?.constructor?.name === 'BlurFilter',
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
      const { segment, char, playbackState } = await build('{Hello} @ f.blurIn.hold(1s).red');
      PlaybackController.seekToTime(segment, 1.5, playbackState);
      assert(
        (char as any).filters?.length >= 1 && fillHex((char as any).style.fill) === '#ff4d4f',
        `R17e2e blurIn+red seek 1.5 = blurIn filter 在 + red 生效（实际 filters=${(char as any).filters?.length} fill=${fillHex((char as any).style.fill)}）`,
      );
      PlaybackController.seekToTime(segment, 0, playbackState);
      assert(
        (char as any).filters?.length >= 1 && fillHex((char as any).style.fill) !== '#ff4d4f',
        `R17e2e blurIn+red seek 0 = blurIn filter 仍在 + red 回退（实际 filters=${(char as any).filters?.length} fill=${fillHex((char as any).style.fill)}）`,
      );
    }
  });
});

describe('[18] 多 token hold-chain char_stagger（SA-34 / SA-27）', () => {
  it('多 token style 全覆盖；group/char hold 链 pre/post-hold 分流正确', async () => {
    // 多 token 变体：取前两个非空白 char（harness.build 只取首字符）。
    async function buildTwoChars(source: string) {
      const { segment, activeTexts, playbackState } = await buildTexts(source);
      const nonBlank = activeTexts[0]._displayAssembly.chars.filter((c: any) => c.text.trim());
      return { segment, char0: nonBlank[0], char1: nonBlank[1], playbackState };
    }

    // (1) `{Hello} {World} @ f.red`：两个 token 各自的 char 都应染红（red 经 applyStyleRecursively
    //      递归到 wrapper.chars 的每个 char）。验证多 token 的 style 应用覆盖全部 token，不只首个。
    {
      const { char0, char1 } = await buildTwoChars('{Hello} {World} @ f.red');
      assert(
        fillHex((char0 as any).baseStyleSnapshot.fill) === '#ff4d4f',
        `R18e2e 多 token red：token0 char 进 baseline red（实际 ${fillHex((char0 as any).baseStyleSnapshot.fill)}）`,
      );
      assert(
        fillHex((char1 as any).baseStyleSnapshot.fill) === '#ff4d4f',
        `R18e2e 多 token red：token1 char 也进 baseline red（实际 ${fillHex((char1 as any).baseStyleSnapshot.fill)}）`,
      );
    }

    // (2) `{Hello} {World} @ f.hold:group(0.1s).red`：组级 hold 链 + red（post-hold）。
    //      red 在 hold 之后 → 进 styleRecords（post-hold 动态样式），seek 重放生效。
    //      验证多 token 的 group-hold 链 style 正确进 record（与 [13] 单 token 一致）。
    {
      const { segment, char0, playbackState } = await buildTwoChars('{Hello} {World} @ f.hold:group(0.1s).red');
      const rec0 = (segment as any).styleRecords.filter((r: any) => r.char === char0);
      assert(
        rec0.length >= 1 && rec0.some((r: any) => r.styleName === 'red'),
        `R18e2e hold:group.red：token0 char 的 red 进 styleRecords（实际 ${JSON.stringify(rec0.map((r: any) => r.styleName))}）`,
      );
      PlaybackController.seekToTime(segment, 1.0, playbackState);
      assert(
        fillHex((char0 as any).style.fill) === '#ff4d4f',
        `R18e2e hold:group.red seek 1.0：red 生效（实际 ${fillHex((char0 as any).style.fill)}）`,
      );
    }

    // (3) `f.hold:char(0.1s).red`：char 级 hold 链 + red（post-hold）。
    //      R20/SA-35 修复：red 在 hold:char 之后 → post-hold → 进 styleRecords + seek 生效。
    //      旧 bug（SA-34 发现）：site3 unrollCharChain 先把 hold:char 滤掉再算边界 → 边界检测不到 →
    //      red 被当 pre-hold 跳过 → 被吞（既不进 baseline 也不进 record）。修复后边界在原始 visualConfigs
    //      上算（含 hold:char）→ red 正确落 post-hold。
    {
      const { segment, char0, playbackState } = await buildTwoChars('{Hello} @ f.hold:char(0.1s).red');
      const rec0 = (segment as any).styleRecords.filter((r: any) => r.char === char0);
      assert(
        rec0.length >= 1 && rec0.some((r: any) => r.styleName === 'red'),
        `R18e2e hold:char.red（R20 修后）：red 进 styleRecords（实际 ${JSON.stringify(rec0.map((r: any) => r.styleName))}）`,
      );
      assert(
        fillHex((char0 as any).baseStyleSnapshot.fill) !== '#ff4d4f',
        `R18e2e hold:char.red：red 不进 baseline（post-hold）（实际 ${fillHex((char0 as any).baseStyleSnapshot.fill)}）`,
      );
      PlaybackController.seekToTime(segment, 1.0, playbackState);
      assert(
        fillHex((char0 as any).style.fill) === '#ff4d4f',
        `R18e2e hold:char.red seek 1.0：red 生效（实际 ${fillHex((char0 as any).style.fill)}）`,
      );
    }

    // (4) `f.red.hold:char(0.1s)`：red 在 hold:char 之前 → pre-hold → 进 baseline（P1 烘焙），不进 record。
    //      验证 R20 修复没破坏 pre-hold 烘焙（red 在 hold:char 前仍正确进 baseline，不双重应用）。
    {
      const { segment, char0 } = await buildTwoChars('{Hello} @ f.red.hold:char(0.1s)');
      assert(
        fillHex((char0 as any).baseStyleSnapshot.fill) === '#ff4d4f',
        `R18e2e red.hold:char：red 进 baseline（pre-hold）（实际 ${fillHex((char0 as any).baseStyleSnapshot.fill)}）`,
      );
      const rec0 = (segment as any).styleRecords.filter((r: any) => r.char === char0);
      assert(
        rec0.length === 0,
        `R18e2e red.hold:char：red 不进 record（pre-hold 已在 baseline，避免双重应用）（实际 ${JSON.stringify(rec0.map((r: any) => r.styleName))}）`,
      );
    }

    // (5) `f.red.hold:char(0.1s).bold`：red 是 pre-hold（进 baseline），bold 是 post-hold（进 record）。
    //      混合 pre/post —— 验证边界判定在混合链里正确分流（red 烘焙、bold record）。
    {
      const { segment, char0, playbackState } = await buildTwoChars('{Hello} @ f.red.hold:char(0.1s).bold');
      assert(
        fillHex((char0 as any).baseStyleSnapshot.fill) === '#ff4d4f',
        `R18e2e red.hold:char.bold：red 进 baseline（pre-hold）（实际 ${fillHex((char0 as any).baseStyleSnapshot.fill)}）`,
      );
      const rec0 = (segment as any).styleRecords.filter((r: any) => r.char === char0);
      assert(
        rec0.length >= 1 && rec0.some((r: any) => r.styleName === 'bold'),
        `R18e2e red.hold:char.bold：bold 进 record（post-hold）（实际 ${JSON.stringify(rec0.map((r: any) => r.styleName))}）`,
      );
      PlaybackController.seekToTime(segment, 1.0, playbackState);
      assert(
        fillHex((char0 as any).style.fill) === '#ff4d4f' && (char0 as any).style.fontWeight === 'bold',
        `R18e2e red.hold:char.bold seek 1.0 = red(baseline)+bold(record)（实际 fill=${fillHex((char0 as any).style.fill)} fw=${(char0 as any).style.fontWeight}）`,
      );
    }
  });
});

describe('[19] 多段落 segment 切换（SA-34 / SA-27）', () => {
  it('段间 baseline 独立：段 1 的 block style 不泄漏到段 0', async () => {
    // (1) 两段：段 0 普通文本，段 1 带 [.red:block]（KMD 段落分隔是 \n\n 双换行）。段 0 的 char 不应被染红
    //      （recapture 只遍历段 1 的 paragraphText）。验证 recaptureBaseStyleSnapshot 的 paragraphText
    //      遍历不跨段污染。
    const { activeTexts } = await buildTexts('Hello\n\n[.red:block]\nWorld');
    assert(activeTexts.length >= 2, `R19e2e 多段 build 出 ≥2 个 activeTexts（实际 ${activeTexts.length}）`);
    const char0 = firstNonBlankChar(activeTexts[0]);
    const char1 = firstNonBlankChar(activeTexts[1]);
    assert(
      fillHex((char1 as any).baseStyleSnapshot.fill) === '#ff4d4f',
      `R19e2e 段1（red:block）char 进 baseline red（实际 ${fillHex((char1 as any).baseStyleSnapshot.fill)}）`,
    );
    assert(
      fillHex((char0 as any).baseStyleSnapshot.fill) !== '#ff4d4f',
      `R19e2e 段0（普通）char 不被段1的 red:block 污染（实际 ${fillHex((char0 as any).baseStyleSnapshot.fill)}）`,
    );
  });
});

describe('[20] block/global post-hold style 端到端（R21-High / SA-36）', () => {
  it('post-hold block style 进 record 不进 baseline；墙钟过 hold 不泄漏；相对样式不双重放大', async () => {
    // (1) [.hold:block(0.05s).red:block] —— 用户报告的 case A。red 是 post-hold → 进 record，
    //     不进 baseline；构建后立即不染红；墙钟过 0.05s（测 120ms）仍不染红（无副作用）。
    {
      const { segment, char, playbackState } = await build('[.hold:block(0.05s).red:block]\nHello');
      assert(
        fillHex((char as any).baseStyleSnapshot.fill) !== '#ff4d4f',
        `R21 block post-hold red 不进 baseline（实际 ${fillHex((char as any).baseStyleSnapshot.fill)}）`,
      );
      assert(
        fillHex((char as any).style.fill) !== '#ff4d4f',
        `R21 block post-hold red 构建后立即不染红（实际 ${fillHex((char as any).style.fill)}）`,
      );
      const recs = ownRecords(segment, char);
      assert(
        recs.length === 1 && recs[0].startsWith('red@0.05'),
        `R21 block post-hold red 进 record@0.05（实际 ${JSON.stringify(recs)}）`,
      );
      // 关键：墙钟副作用检测——不播不 seek，等过 hold 时间（120ms > 50ms），style 必须仍未被墙钟触发。
      // 真实 setTimeout（vitest 无 fake timer）——诚实依赖墙钟，与原脚本同行为。
      await new Promise((r) => setTimeout(r, 120));
      assert(
        fillHex((char as any).style.fill) !== '#ff4d4f',
        `R21 block post-hold red 墙钟 120ms 后不泄漏（无 isAutoPlaying 不触发 segmentTl.call）（实际 ${fillHex((char as any).style.fill)}）`,
      );
    }

    // (2) [.red:block.hold:block(1s).bold:block] —— 用户报告的 case B。red 是 pre-hold → baseline；
    //     bold 是 post-hold → record@1.0。seek 1.5 = red+bold，seek 0 = red only（bold 回退）。
    {
      const { segment, char, playbackState } = await build('[.red:block.hold:block(1s).bold:block]\nHello');
      assert(
        fillHex((char as any).baseStyleSnapshot.fill) === '#ff4d4f',
        `R21 block pre-hold red 进 baseline（实际 ${fillHex((char as any).baseStyleSnapshot.fill)}）`,
      );
      const recs = ownRecords(segment, char);
      assert(
        recs.length === 1 && recs[0].startsWith('bold@1.00'),
        `R21 block post-hold bold 进 record@1.00（实际 ${JSON.stringify(recs)}）`,
      );
      PlaybackController.seekToTime(segment, 1.5, playbackState);
      assert(
        fillHex((char as any).style.fill) === '#ff4d4f' && (char as any).style.fontWeight === 'bold',
        `R21 block SEEK 1.5 = red(baseline)+bold(record)（实际 fill=${fillHex((char as any).style.fill)} fw=${(char as any).style.fontWeight}）`,
      );
      PlaybackController.seekToTime(segment, 0, playbackState);
      assert(
        fillHex((char as any).style.fill) === '#ff4d4f' && (char as any).style.fontWeight !== 'bold',
        `R21 block SEEK 0 = red only（bold 回退，red baseline 保留）（实际 fill=${fillHex((char as any).style.fill)} fw=${(char as any).style.fontWeight}）`,
      );
    }

    // (3) 对照组：[.red:block]（无 hold，纯 pre-hold）——R21 修复未破坏 P2 recapture 路径。
    //     red 进 baseline、不进 record。防 R16 回归。
    {
      const { segment, char } = await build('[.red:block]\nHello');
      assert(
        fillHex((char as any).baseStyleSnapshot.fill) === '#ff4d4f',
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
      const { segment, char, playbackState } = await build('[.hold:block(1s).big:block]\nHello');
      assert(
        (char as any).baseStyleSnapshot.fontSize === 36,
        `R21 block post-hold big 不进 baseline（fontSize 仍 36）（实际 ${(char as any).baseStyleSnapshot.fontSize}）`,
      );
      const recs = ownRecords(segment, char);
      assert(
        recs.length === 1 && recs[0].startsWith('big@1.00'),
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
      const { segment, char } = await build('[.red:block.hold:block(1s)]\nHello');
      assert(
        fillHex((char as any).baseStyleSnapshot.fill) === '#ff4d4f',
        `R21 block red+trailing-hold：red 仍进 baseline（实际 ${fillHex((char as any).baseStyleSnapshot.fill)}）`,
      );
      assert(
        ownRecords(segment, char).length === 0,
        `R21 block red+trailing-hold：无 post-hold style → records 空（实际 ${JSON.stringify(ownRecords(segment, char))}）`,
      );
    }
  });
});

describe('[20.5] M2 displace + underwater(Filter[]) + warp 容器级 seek 幂等', () => {
  it('容器级 behavior filter：displace/warp:block apply；underwater Filter[] 恰好 3 个；char 级组合 cleanup 正确', async () => {
    // (1) [.displace:block] —— 新 behavior-track filter，容器级 ticker 驱动。
    //      seek 后 kt.filters 有 1 个 DisplaceFilter；多次 seek 来回幂等不堆积。
    {
      const { segment, activeTexts, playbackState } = await buildTexts('[.displace:block]\nHello');
      const kt = activeTexts[0];
      PlaybackController.seekToTime(segment, 1.0, playbackState);
      const filters = (kt as any).filters;
      assert(
        Array.isArray(filters) && filters.length === 1 && filters[0]?.constructor?.name === 'DisplaceFilter',
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
      const { segment, activeTexts, playbackState } = await buildTexts('[.warp:block]\nHello');
      const kt = activeTexts[0];
      PlaybackController.seekToTime(segment, 1.0, playbackState);
      const filters = (kt as any).filters;
      assert(
        Array.isArray(filters) && filters.length === 1 && filters[0]?.constructor?.name === 'WarpFilter',
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
    //      验证 clearBehaviors 的 Array.isArray 分支经真实 preset 触发，不堆积。
    {
      const { segment, activeTexts, playbackState } = await buildTexts('[.underwater:block]\nHello');
      const kt = activeTexts[0];
      PlaybackController.seekToTime(segment, 1.0, playbackState);
      const filters = (kt as any).filters;
      assert(
        Array.isArray(filters) && filters.length === 3,
        `M2 underwater seek 1.0 后 kt.filters 恰好 3 个（displace+duotone+blur）（实际 ${filters?.length}）`,
      );
      const names = (filters as any[]).map((f) => f?.constructor?.name).sort();
      assert(
        names.includes('DisplaceFilter') && names.includes('TextDuotoneFilter') && names.includes('BlurFilter'),
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
      const { segment, activeTexts, playbackState } = await buildTexts('{Hello} @ f.underwater');
      const char = firstNonBlankChar(activeTexts[0]);
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
  });
});
