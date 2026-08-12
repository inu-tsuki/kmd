// Reader runtime 资产策略 + 数值消解套件（主题一：织网 S2）。
//
// 钉死三块 reader-hostable 策略面：
//   1. RuntimeAssetPolicy —— URL 解析/管控、字体收集、Android WebView 默认字体门
//   2. ScriptSourceLoader —— 路径状输入禁用策略（reader 热路径永久 allowPathFetch:false）
//   3. RuntimeValueResolver —— marker/var 引用消解（唯一触点 layout 单例的部分）
//
// ⚠️ 诚实盲区（harness 不掩盖生产行为）：
//   - resolveControlledSourceUrl 的同源 http(s) 分支（isSameOrigin）在 node 下恒 false
//     （依赖 window.location.origin；setup.ts:41-44 明确禁止 stub window——LayoutPlanner
//     的 typeof window 检查会落进 window.location.search 崩溃）。该分支由 e2e 隐式覆盖
//     （reader bundle 从 http://127.0.0.1:4174 服务并放行自身源）。本套件标注盲区，不伪造覆盖。
//   - ScriptSourceLoader.configure() 是单向合并、无回退 API——本套件一律经 resolve(input, policy)
//     的显式 policy 参数驱动，绝不触碰静态 policy，避免污染后续套件（singleFork 共享进程）。

import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  DEFAULT_READER_FONT_MANIFEST,
  collectRuntimeFonts,
  resolveControlledSourceUrl,
  resolveRuntimeAssetUrl,
} from '@kmd/core/runtime/RuntimeAssetPolicy';
import { ScriptSourceLoader } from '@kmd/core/player/ScriptSourceLoader';
import { RuntimeValueResolver } from '@kmd/core/runtime/RuntimeValueResolver';
import { layout } from '@kmd/core/layout/LayoutEngine';

// ─── URL 解析与管控 ─────────────────────────────────────────────────────────

describe('resolveRuntimeAssetUrl — resolution mechanics', () => {
  it('returns the url unchanged with no base anywhere', () => {
    expect(resolveRuntimeAssetUrl('fonts/a.ttf')).toBe('fonts/a.ttf');
    expect(resolveRuntimeAssetUrl('https://x.com/a.ttf')).toBe('https://x.com/a.ttf');
  });

  it('resolves against assetBaseUrl and strips a leading slash (base-relative intent)', () => {
    const ctx = { assetBaseUrl: 'https://cdn.example.com/assets' };
    expect(resolveRuntimeAssetUrl('/fonts/a.ttf', ctx)).toBe('https://cdn.example.com/assets/fonts/a.ttf');
    expect(resolveRuntimeAssetUrl('fonts/a.ttf', ctx)).toBe('https://cdn.example.com/assets/fonts/a.ttf');
  });

  it('tolerates a base without trailing slash', () => {
    const withSlash = resolveRuntimeAssetUrl('a.ttf', { assetBaseUrl: 'https://cdn.example.com/assets/' });
    const noSlash = resolveRuntimeAssetUrl('a.ttf', { assetBaseUrl: 'https://cdn.example.com/assets' });
    expect(withSlash).toBe(noSlash);
  });

  it('manifest.baseUrl takes precedence over ctx.assetBaseUrl', () => {
    const ctx = {
      assetBaseUrl: 'https://low-priority.example.com/',
      assetManifest: { baseUrl: 'https://manifest.example.com/pkg' },
    };
    expect(resolveRuntimeAssetUrl('a.kmd', ctx)).toBe('https://manifest.example.com/pkg/a.kmd');
  });

  it('an absolute url wins over the base (resolution semantics of new URL)', () => {
    const ctx = { assetBaseUrl: 'https://cdn.example.com/assets' };
    expect(resolveRuntimeAssetUrl('https://other.example.com/a.ttf', ctx)).toBe('https://other.example.com/a.ttf');
  });
});

describe('resolveControlledSourceUrl — containment policy', () => {
  const CDN = { assetBaseUrl: 'https://cdn.example.com/assets' };

  it('allows a relative url within the base', () => {
    expect(resolveControlledSourceUrl('scripts/a.kmd', CDN)).toBe('https://cdn.example.com/assets/scripts/a.kmd');
  });

  it('allows an absolute https url within the base', () => {
    expect(resolveControlledSourceUrl('https://cdn.example.com/assets/scripts/a.kmd', CDN)).toBe(
      'https://cdn.example.com/assets/scripts/a.kmd',
    );
  });

  it('allows http within the base (containment precedes protocol check)', () => {
    const local = { assetBaseUrl: 'http://127.0.0.1:4174' };
    expect(resolveControlledSourceUrl('works/a.kmd', local)).toBe('http://127.0.0.1:4174/works/a.kmd');
  });

  it('allows any https url even outside the base (https is controlled by transport)', () => {
    expect(resolveControlledSourceUrl('https://other.example.com/a.kmd', CDN)).toBe('https://other.example.com/a.kmd');
    expect(resolveControlledSourceUrl('https://other.example.com/a.kmd')).toBe('https://other.example.com/a.kmd');
  });

  it.each([
    ['file: URL', 'file:///etc/passwd'],
    ['data: URL', 'data:text/plain,hello'],
  ])('blocks %s with Blocked-uncontrolled error echoing the original input', (_label, url) => {
    expect(() => resolveControlledSourceUrl(url)).toThrow(`Blocked uncontrolled sourceUrl: ${url}`);
  });

  it('blocks plain http outside the base under node (same-origin branch is browser-only — see header blind spot)', () => {
    // node 下 isSameOrigin 恒 false → http://localhost 被拦。浏览器同源场景由 e2e 覆盖。
    expect(() => resolveControlledSourceUrl('http://127.0.0.1:9999/a.kmd')).toThrow(/Blocked uncontrolled sourceUrl/);
  });
});

// ─── 字体收集 ───────────────────────────────────────────────────────────────

describe('collectRuntimeFonts', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('pins the default manifest families (reader visual baseline; changes are deliberate acts)', () => {
    expect(DEFAULT_READER_FONT_MANIFEST.map((f) => f.family)).toEqual([
      'LXGW WenKai',
      'Sasara Regular',
      'Smiley Sans',
      'Fira Code',
    ]);
    for (const font of DEFAULT_READER_FONT_MANIFEST) {
      expect(font.url.startsWith('fonts/'), `${font.family} url stays bundle-relative`).toBe(true);
    }
  });

  it('returns defaults on a non-Android host with no host fonts', () => {
    expect(collectRuntimeFonts({})).toEqual(DEFAULT_READER_FONT_MANIFEST);
  });

  it('host fonts win: manifest.fonts ++ fontManifest, defaults skipped entirely', () => {
    const manifestFont = { family: 'Host Font', url: 'https://x.com/h.ttf' };
    const ctxFont = { family: 'Ctx Font', url: 'https://x.com/c.ttf' };
    const fonts = collectRuntimeFonts({
      assetManifest: { fonts: [manifestFont] },
      fontManifest: [ctxFont],
    });
    expect(fonts).toEqual([manifestFont, ctxFont]);
  });

  it('Android WebView without the opt-in flag skips default fonts (host supplies system fonts)', () => {
    vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 (Linux; Android 14) KmdReader/1.0' });
    expect(collectRuntimeFonts({})).toEqual([]);
  });

  it('Android WebView with ?kmdLoadDefaultFonts=1 loads defaults anyway', () => {
    vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 (Linux; Android 14) KmdReader/1.0' });
    vi.stubGlobal('location', { search: '?kmdLoadDefaultFonts=1' });
    expect(collectRuntimeFonts({})).toEqual(DEFAULT_READER_FONT_MANIFEST);
  });

  it('Android skip gate is not consulted when host fonts are present', () => {
    vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 (Linux; Android 14) KmdReader/1.0' });
    const hostFont = { family: 'Host', url: 'https://x.com/h.ttf' };
    expect(collectRuntimeFonts({ fontManifest: [hostFont] })).toEqual([hostFont]);
  });
});

// ─── ScriptSourceLoader 策略门 ──────────────────────────────────────────────

describe('ScriptSourceLoader — path-fetch policy gate', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('looksLikeFilePath: .kmd suffix or / prefix, but multiline source is never a path', () => {
    expect(ScriptSourceLoader.looksLikeFilePath('works/a.kmd')).toBe(true);
    expect(ScriptSourceLoader.looksLikeFilePath('/abs/script')).toBe(true);
    expect(ScriptSourceLoader.looksLikeFilePath('plain source text')).toBe(false);
    // 含换行的正文即使以 .kmd 结尾也不是路径（防把源码误判为文件）。
    expect(ScriptSourceLoader.looksLikeFilePath('第一行\n第二行.kmd')).toBe(false);
  });

  it('resolve passes non-path input straight through as source', async () => {
    const source = '你好 @ f.wave\n第二行';
    await expect(ScriptSourceLoader.resolve(source, {})).resolves.toEqual({ source });
  });

  it('resolve rejects path-like input under the runtime default policy (allowPathFetch:false)', async () => {
    // 显式传 {} 之外的 policy 以表达被测策略；不触碰静态 configure（无回退 API，见文件头）。
    await expect(ScriptSourceLoader.resolve('works/a.kmd', { allowPathFetch: false })).rejects.toThrow(
      /Path-like script input is disabled/,
    );
  });

  it('resolve with allowPathFetch:true fetches through the controlled-url gate and returns text + sourcePath', async () => {
    const fetchMock = vi.fn(async (_url: string) => ({
      ok: true,
      blob: async () => ({ text: async () => '远程正文' }),
    }));
    vi.stubGlobal('fetch', fetchMock);
    const result = await ScriptSourceLoader.resolve('/works/a.kmd', {
      allowPathFetch: true,
      assetBaseUrl: 'https://cdn.example.com/assets',
    });
    expect(result.source).toBe('远程正文');
    expect(result.sourcePath).toBe('https://cdn.example.com/assets/works/a.kmd');
    expect(fetchMock).toHaveBeenCalledWith('https://cdn.example.com/assets/works/a.kmd');
  });

  it('resolve surfaces non-ok responses with status in the message', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 404, statusText: 'Not Found' })));
    await expect(
      ScriptSourceLoader.resolve('https://cdn.example.com/missing.kmd', { allowPathFetch: true }),
    ).rejects.toThrow('Failed to load script source: 404 Not Found');
  });
});

// ─── RuntimeValueResolver（唯一触点 layout 单例）────────────────────────────

describe('RuntimeValueResolver — marker/var resolution against layout.globalMarkers', () => {
  afterEach(() => {
    // clearVariables=true：连 var.* 一并清，singleFork 共享进程不留种。
    layout.reset(true);
  });

  const seedMarker = (key: string, x: number, y: number) =>
    layout.globalMarkers.set(key, { x, y } as never);

  it('resolves marker coordinate references <name>.<type>.<x|y>', () => {
    seedMarker('p1.start', 100, 200);
    expect(RuntimeValueResolver.resolveReference('p1.start.x')).toBe(100);
    expect(RuntimeValueResolver.resolveReference('p1.start.y')).toBe(200);
  });

  it('resolves var.<name> references to the marker x slot (variables ride the marker map)', () => {
    seedMarker('var.gold', 42, 0);
    expect(RuntimeValueResolver.resolveReference('var.gold')).toBe(42);
  });

  it('returns undefined for unknown refs, wrong shapes, and non-strings', () => {
    seedMarker('p1.start', 100, 200);
    expect(RuntimeValueResolver.resolveReference('p1.unknown.x')).toBeUndefined();
    expect(RuntimeValueResolver.resolveReference('var.missing')).toBeUndefined();
    expect(RuntimeValueResolver.resolveReference('p1.start.z')).toBeUndefined(); // coord 只认 x|y
    expect(RuntimeValueResolver.resolveReference('p1.start')).toBeUndefined(); // 缺 coord 段
    expect(RuntimeValueResolver.resolveReference(42)).toBeUndefined();
    expect(RuntimeValueResolver.resolveReference(null)).toBeUndefined();
  });

  it('resolveNumeric: numbers pass, refs resolve, numeric strings parse, junk falls back', () => {
    seedMarker('p1.end', 320, 40);
    seedMarker('var.delay', 750, 0);
    expect(RuntimeValueResolver.resolveNumeric(123, -1)).toBe(123);
    expect(RuntimeValueResolver.resolveNumeric('p1.end.x', -1)).toBe(320);
    expect(RuntimeValueResolver.resolveNumeric('var.delay', -1)).toBe(750);
    expect(RuntimeValueResolver.resolveNumeric('3.5', -1)).toBe(3.5);
    expect(RuntimeValueResolver.resolveNumeric('not-a-number', -1)).toBe(-1);
    expect(RuntimeValueResolver.resolveNumeric('var.missing', -1)).toBe(-1);
    expect(RuntimeValueResolver.resolveNumeric(undefined, 9)).toBe(9);
  });
});
