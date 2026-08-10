import { Container } from 'pixi.js';
import { describe, expect, it, vi } from 'vitest';
import { ScriptPlayer } from '@kmd/core/player/ScriptPlayer';
import { build, makeFakeSegment } from './playback-harness';

describe('源码行播放导航', () => {
  it('构建期记录每个可执行行的真实时间轴位置', async () => {
    const source = [
      '---',
      'speed: 100',
      '---',
      'FIRST',
      'SECOND',
      '',
      '// comment-only line',
      'THIRD',
    ].join('\n');

    const { segment, sourceLineAnchors } = await build(source);
    expect(sourceLineAnchors.map((anchor) => anchor.line)).toEqual([4, 5, 8]);
    expect(sourceLineAnchors[0]?.timePosition).toBeCloseTo(0, 6);
    expect(sourceLineAnchors[1]!.timePosition).toBeGreaterThan(sourceLineAnchors[0]!.timePosition);
    expect(sourceLineAnchors[2]!.timePosition).toBeGreaterThan(sourceLineAnchors[1]!.timePosition);
    segment.timeline.kill();
  });

  it('纯命令行锚定到段落命令链入口，不会被正文行跳过', async () => {
    const { segment, sourceLineAnchors } = await build([
      '@ cam.zoom(1.1, 0.5s)!',
      'AFTER CAMERA',
    ].join('\n'));

    expect(sourceLineAnchors.map((anchor) => anchor.line)).toEqual([1, 2]);
    expect(sourceLineAnchors[0]?.timePosition).toBeCloseTo(0, 6);
    expect(sourceLineAnchors[1]!.timePosition).toBeGreaterThanOrEqual(
      sourceLineAnchors[0]!.timePosition,
    );
    segment.timeline.kill();
  });

  it('空行和注释向后吸附，超过最后可播放行则拒绝回退', () => {
    const player = new ScriptPlayer(new Container());
    (player as any).segment = makeFakeSegment(4);
    (player as any).sourceLineAnchors = [
      { line: 4, timePosition: 0.25 },
      { line: 8, timePosition: 1.5 },
    ];
    const seek = vi.spyOn(player, 'seekToTime').mockImplementation(() => {});

    expect(player.seekToSourceLine(4)).toBe(true);
    expect(seek).toHaveBeenLastCalledWith(0.25);

    expect(player.seekToSourceLine(6)).toBe(true);
    expect(seek).toHaveBeenLastCalledWith(1.5);

    seek.mockClear();
    expect(player.seekToSourceLine(9)).toBe(false);
    expect(player.seekToSourceLine(0)).toBe(false);
    expect(player.seekToSourceLine(Number.NaN)).toBe(false);
    expect(seek).not.toHaveBeenCalled();
    (player as any).segment.timeline.kill();
  });
});
