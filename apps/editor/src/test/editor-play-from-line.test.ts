import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { useEditorStore } from '../store/editorStore';

function createPlayer(options: { canSeek?: boolean } = {}) {
  const calls: string[] = [];
  const player = {
    getMetadata: { designWidth: 1280, designHeight: 720 },
    mode: 'stage',
    updateConfig: vi.fn(),
    load: vi.fn(async (source: string) => {
      calls.push(`load:${source}`);
    }),
    seekToSourceLine: vi.fn((line: number) => {
      calls.push(`seek:${line}`);
      return options.canSeek ?? true;
    }),
    toggleAutoPlay: vi.fn((force: boolean) => {
      calls.push(`play:${force}`);
    }),
  };
  return { player, calls };
}

describe('编辑器从右键行播放', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', {
      getItem: vi.fn(() => null),
      setItem: vi.fn(),
      removeItem: vi.fn(),
    });
    setActivePinia(createPinia());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('先加载当前编辑内容，再跳到源码行并显式播放', async () => {
    const store = useEditorStore();
    const { player, calls } = createPlayer();
    store.setPlayer(player as any);
    store.kmdContent = 'CURRENT EDITOR SOURCE';

    await expect(store.runScriptFromLine(12)).resolves.toBe(true);
    expect(calls).toEqual([
      'load:CURRENT EDITOR SOURCE',
      'seek:12',
      'play:true',
    ]);
  });

  it('无可播放锚点时保持 ready，不误从开头播放', async () => {
    const store = useEditorStore();
    const { player, calls } = createPlayer({ canSeek: false });
    store.setPlayer(player as any);
    store.kmdContent = 'TRAILING EMPTY LINE';

    await expect(store.runScriptFromLine(99)).resolves.toBe(false);
    expect(calls).toEqual([
      'load:TRAILING EMPTY LINE',
      'seek:99',
    ]);
  });
});
