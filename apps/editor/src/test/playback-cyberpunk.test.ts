import { describe, expect, it } from 'vitest';
import { effectManager } from '@kmd/core/effects/EffectManager';
import { KMDParser } from '@kmd/core/parser/Parser';
import { PlaybackController } from '@kmd/core/player/PlaybackController';
import { Container } from 'pixi.js';
import { build } from './playback-harness';

const PRESET_NAMES = [
  'cyberGlitch',
  'crtDisplay',
  'neonGlow',
  'digitalFlicker',
  'hologram',
  'chromaticAberration',
] as const;

const LIFECYCLE_CASES = [
  {
    name: 'cyberGlitch',
    source: '[.cyberGlitch:block(rgb=14, blockSize=12, noise=0.2)]\nSIGNAL LOST',
    filters: ['RGBSplitFilter', 'NoiseFilter', 'PixelateFilter'],
  },
  {
    name: 'crtDisplay',
    source: '[.crtDisplay:block(density=4, curvature=0.1)]\nCRT ONLINE',
    filters: ['ScanlineFilter', 'NoiseFilter', 'VignetteFilter'],
  },
  {
    name: 'neonGlow',
    source: '[.neonGlow:block(color="#00f5ff", strength=2)]\nNEON CITY',
    filters: ['TextDuotoneFilter', 'OutlineFilter', 'BloomFilter'],
  },
  {
    name: 'hologram',
    source: '[.hologram:block(tint="#66f7ff", scan=5)]\nREMOTE AVATAR',
    filters: ['TextDuotoneFilter', 'ScanlineFilter', 'RGBSplitFilter', 'BloomFilter'],
  },
  {
    name: 'chromaticAberration',
    source: '[.chromaticAberration:block(x=8, y=1)]\nCOLOR FRINGE',
    filters: ['RGBSplitFilter'],
  },
] as const;

describe('cyberpunk effect preset library', () => {
  it('六个 preset 已注册、带可查询参数 schema，Parser known-command 自动接受', () => {
    const source = PRESET_NAMES.map((name) => `{${name}} @ f.${name}`).join('\n\n');
    expect(new KMDParser().validate(source)).toEqual([]);

    for (const name of PRESET_NAMES) {
      const meta = effectManager.getMetadata(name);
      expect(meta, `${name} metadata missing`).toBeDefined();
      expect(meta?.category).toBe('cyberpunk');
      expect(meta?.track).toBe('behavior');
      expect(Object.keys(meta?.parameters ?? {}).length).toBeGreaterThan(0);

      for (const [paramName, parameter] of Object.entries(meta?.parameters ?? {})) {
        if (parameter.type !== 'number') continue;
        expect(typeof parameter.default, `${name}.${paramName} default`).toBe('number');
        if (parameter.min !== undefined) {
          expect(parameter.default, `${name}.${paramName} default < min`).toBeGreaterThanOrEqual(parameter.min);
        }
        if (parameter.max !== undefined) {
          expect(parameter.default, `${name}.${paramName} default > max`).toBeLessThanOrEqual(parameter.max);
        }
      }
    }
  });

  it.each(LIFECYCLE_CASES)(
    '$name 自然构建后由 seek 重建组合资源，反复 seek 不堆积并可 cleanup',
    async ({ name, source, filters: expectedFilters }) => {
      const { segment, char, playbackState } = await build(source);
      const record = segment.behaviors.find((item) => item.effectName === name);
      expect(record, `${name} BehaviorRecord missing`).toBeDefined();
      const target = record?.char ?? char;

      expect(target.filters ?? [], `${name} build before timeline boundary`).toHaveLength(0);
      PlaybackController.seekToTime(segment, 1, playbackState);

      const firstFilters = (target.filters ?? []).map((filter: any) => filter.constructor.name);
      expect(firstFilters).toEqual(expectedFilters);
      expect(playbackState.activeBehaviorCleanups.some((cleanup: any) => cleanup.modName === name)).toBe(true);
      const cleanupCount = playbackState.activeBehaviorCleanups.length;

      PlaybackController.seekToTime(segment, 0.5, playbackState);
      PlaybackController.seekToTime(segment, 1.5, playbackState);
      expect((target.filters ?? []).map((filter: any) => filter.constructor.name)).toEqual(expectedFilters);
      expect(playbackState.activeBehaviorCleanups).toHaveLength(cleanupCount);

      PlaybackController.clearBehaviors(playbackState);
      expect(target.filters ?? []).toHaveLength(0);
      segment.timeline.kill();
    },
  );

  it('显式 :group 的多通道 behavior 只登记一个容器目标，默认作用域仍逐字', async () => {
    const scoped = await build('{NEON} @ f.neonGlow:group(color="#00f5ff")');
    const scopedRecords = scoped.segment.behaviors.filter((item) => item.effectName === 'neonGlow');
    expect(scopedRecords).toHaveLength(1);
    expect(scopedRecords[0]?.char).not.toBe(scoped.char);

    PlaybackController.seekToTime(scoped.segment, 2, scoped.playbackState);
    expect((scopedRecords[0]?.char.filters ?? []).map((filter: any) => filter.constructor.name)).toEqual([
      'TextDuotoneFilter',
      'OutlineFilter',
      'BloomFilter',
    ]);
    expect(scoped.char.filters ?? []).toHaveLength(0);
    PlaybackController.clearBehaviors(scoped.playbackState);
    scoped.segment.timeline.kill();

    const perChar = await build('{NEON} @ f.neonGlow(color="#00f5ff")');
    const perCharRecords = perChar.segment.behaviors.filter((item) => item.effectName === 'neonGlow');
    expect(perCharRecords).toHaveLength(4);
    expect(perCharRecords.every((item) => item.char !== scopedRecords[0]?.char)).toBe(true);
    perChar.segment.timeline.kill();
  });

  it('显式 :group 对 instant 和 entrance 也只挂载到容器', async () => {
    const instant = await build('{PIXEL} @ f.pixelate:group(size=8)');
    expect(instant.segment.instantEffects).toHaveLength(1);
    const instantTarget = instant.segment.instantEffects[0]?.target;
    expect(instantTarget).not.toBe(instant.char);

    PlaybackController.seekToTime(instant.segment, 2, instant.playbackState);
    expect((instantTarget?.filters ?? []).map((filter: any) => filter.constructor.name)).toEqual([
      'PixelateFilter',
    ]);
    expect(instant.char.filters ?? []).toHaveLength(0);
    PlaybackController.clearInstantEffects(instant.playbackState);
    expect(instantTarget?.filters ?? []).toHaveLength(0);
    instant.segment.timeline.kill();

    const entrance = await build('{BLUR} @ f.blurIn:group(0.5s)');
    expect(entrance.segment.entranceFilters).toHaveLength(1);
    const entranceRecord = entrance.segment.entranceFilters[0];
    expect(entranceRecord?.target).not.toBe(entrance.char);
    expect((entranceRecord?.target.filters ?? []).map((filter: any) => filter.constructor.name)).toEqual([
      'BlurFilter',
    ]);
    expect(entrance.char.filters ?? []).toHaveLength(0);
    PlaybackController.clearEntranceFilters(entrance.segment);
    entrance.segment.timeline.kill();
  });

  it('digitalFlicker 仅登记逐字 alpha modifier，不创建逐字 GPU filter', async () => {
    const { segment, char, playbackState } = await build(
      '{FLICKER} @ f.digitalFlicker(rate=18, duty=0.3, intensity=0.7)',
    );
    const records = segment.behaviors.filter((item) => item.effectName === 'digitalFlicker');
    expect(records).toHaveLength(7);

    PlaybackController.seekToTime(segment, 2, playbackState);
    expect(char.filters ?? []).toHaveLength(0);
    expect((char as any).modifiers.size).toBe(1);
    expect(playbackState.activeBehaviorCleanups.some((cleanup: any) => (
      cleanup.modName === 'digitalFlicker' && cleanup.filterInstance === undefined
    ))).toBe(true);

    PlaybackController.clearBehaviors(playbackState);
    expect((char as any).modifiers.size).toBe(0);
    segment.timeline.kill();
  });

  it('自然播放 boundary 的 apply/unpack 合同能挂载并登记组合资源', async () => {
    const { segment, playbackState } = await build('[.crtDisplay:block]\nLIVE SIGNAL');
    const record = segment.behaviors.find((item) => item.effectName === 'crtDisplay');
    const target = record?.char as any;
    expect(target.filters ?? []).toHaveLength(0);

    // Headless harness 不推进真实 ticker；这里复用 BehaviorRecordBuilder 的自然播放边界合同：
    // effectManager.apply(record params) → unpackBehaviorResult → cleanup registry。
    const result = effectManager.apply(target, record!.effectName, record!.params, true);
    const unpacked = PlaybackController.unpackBehaviorResult(result, target);
    playbackState.activeBehaviorCleanups.push({
      char: target,
      modName: record!.effectName,
      target,
      ...unpacked,
    });
    expect((target.filters ?? []).map((filter: any) => filter.constructor.name)).toEqual([
      'ScanlineFilter',
      'NoiseFilter',
      'VignetteFilter',
    ]);
    expect(playbackState.activeBehaviorCleanups.some((cleanup: any) => cleanup.modName === 'crtDisplay')).toBe(true);

    PlaybackController.clearBehaviors(playbackState);
    segment.timeline.kill();
  });

  it.each([
    ['neonGlow', ['BackgroundDuotoneFilter', 'BloomFilter']],
    ['hologram', ['BackgroundDuotoneFilter', 'ScanlineFilter', 'RGBSplitFilter', 'BloomFilter']],
  ] as const)('%s 的 background profile 使用连续色调实现并完整 cleanup', (name, expectedFilters) => {
    const target = new Container();
    const result = effectManager.apply(target, name, {}, true, 'background');
    const unpacked = PlaybackController.unpackBehaviorResult(result, target);
    const playbackState = {
      activeBehaviorCleanups: [{ char: target, modName: name, target, ...unpacked }],
    } as any;

    expect((target.filters ?? []).map((filter: any) => filter.constructor.name)).toEqual(expectedFilters);
    PlaybackController.clearBehaviors(playbackState);
    expect(target.filters ?? []).toHaveLength(0);
    target.destroy();
  });

  it('数值参数由 metadata 边界钳制，非法极值不会直接进入 filter uniform', async () => {
    const { segment, playbackState } = await build(
      '[.crtDisplay:block(density=-5, curvature=9, flicker=-1, noise=9, grain=0, vignette=0, softness=9)]\nLIMITS',
    );
    const target = segment.behaviors.find((item) => item.effectName === 'crtDisplay')?.char as any;
    PlaybackController.seekToTime(segment, 1, playbackState);

    const [scanline, noise, vignette] = target.filters;
    expect(scanline.density).toBe(0.25);
    expect(scanline.curvature).toBe(1);
    expect(scanline.flicker).toBe(0);
    expect(noise.amount).toBe(1);
    expect(noise.scale).toBe(0.5);
    expect(vignette.radius).toBe(0.5);
    expect(vignette.softness).toBe(0.5);

    PlaybackController.clearBehaviors(playbackState);
    segment.timeline.kill();
  });
});
