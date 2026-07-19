// Frontmatter 写回回归套件（支柱 3 / 收编 frontmatter-writeback-test.ts）。
//
// 收编自 src/frontmatter-writeback-test.ts，行为保持——断言与复刻逻辑搬进 vitest runner。
// 规范 docs/knowledge/language/frontmatter-schema.md §5 W1–W4。
// 不依赖 Pinia store 实例（避免 DOM/FS），直接复用 core parser 共享逻辑，复刻
// editorStore.syncConfigFromText / updateFrontMatter 的纯逻辑做断言。

import { describe, it, expect } from 'vitest';
import {
  extractFrontMatterBlock,
  serializeFrontMatter,
  setField,
  getField,
  serializeUIValue,
  UI_FRONTMATTER_KEYS,
} from '../core/parser/frontmatter';
import { parser } from '../core/parser/Parser';

interface CanvasConfig {
  mode: string;
  width: number;
  height: number;
  bgColor: string;
  fontColor: string;
  fontFamily: string;
}

const DEFAULT_CFG: CanvasConfig = {
  mode: 'stage',
  width: 1920,
  height: 1080,
  bgColor: '#000000',
  fontColor: '#ffffff',
  fontFamily: 'Sasara Regular',
};

// 等价于 syncConfigFromText：从文本读 6 个 UI 字段进 canvasConfig（取 autoConvert 解析值）。
function syncConfigFromText(text: string, cfg: CanvasConfig): CanvasConfig & { speed?: number } {
  const next = { ...cfg };
  const block = extractFrontMatterBlock(text);
  if (!block) return next;
  const lines = block.lines;
  const mode = getField(lines, 'mode');
  if (mode !== undefined) next.mode = mode;
  const designWidth = getField(lines, 'designWidth');
  if (designWidth !== undefined) next.width = designWidth;
  const designHeight = getField(lines, 'designHeight');
  if (designHeight !== undefined) next.height = designHeight;
  const bgColor = getField(lines, 'bgColor');
  if (bgColor !== undefined) next.bgColor = bgColor;
  const fontColor = getField(lines, 'fontColor');
  if (fontColor !== undefined) next.fontColor = fontColor;
  const fontFamily = getField(lines, 'fontFamily');
  if (fontFamily !== undefined) next.fontFamily = fontFamily;
  return next;
}

// 等价于 updateFrontMatter：合并式写回 6 个 UI 键，未动行原样保留。
function updateFrontMatter(text: string, cfg: CanvasConfig): string {
  const block = extractFrontMatterBlock(text);
  const uiValues: Record<string, any> = {
    mode: cfg.mode,
    designWidth: cfg.width,
    designHeight: cfg.height,
    bgColor: cfg.bgColor,
    fontColor: cfg.fontColor,
    fontFamily: cfg.fontFamily,
  };

  if (block) {
    let lines = block.lines;
    for (const key of UI_FRONTMATTER_KEYS) {
      if (getField(lines, key) !== uiValues[key]) {
        lines = setField(lines, key, uiValues[key]);
      }
    }
    const fmText = serializeFrontMatter(lines);
    return block.body.length > 0
      ? `---\n${fmText}\n---\n${block.body}`
      : `---\n${fmText}\n---`;
  }
  const fmText = UI_FRONTMATTER_KEYS
    .map((key) => `${key}: ${serializeUIValue(key, uiValues[key])}`)
    .join('\n');
  return `---\n${fmText}\n---\n\n${text}`;
}

const ORIGINAL_WITH_FM =
  '---\n' +
  'title: 演示脚本\n' +
  'mode: scroll\n' +
  'speed: 1.5\n' +
  'designWidth: 1920\n' +
  'designHeight: 1080\n' +
  'bgColor: "#0a0a1a"\n' +
  'fontColor: "#ffffff"\n' +
  'fontFamily: Noto Sans\n' +
  '// 这是作者注释,不能丢\n' +
  'kmdVersion: 0.1\n' +
  'var:\n' +
  '  hue: 200\n' +
  '  name: "demo"\n' +
  '---\n' +
  '\n' +
  '正文第一行\n' +
  '正文第二行\n';

describe('frontmatter writeback (W1–W4)', () => {
  describe('[a] UI 改 mode，frontmatter 其余内容逐字节保留', () => {
    const cfg = syncConfigFromText(ORIGINAL_WITH_FM, DEFAULT_CFG);
    const changedCfg = { ...cfg, mode: 'stage' };
    const rewritten = updateFrontMatter(ORIGINAL_WITH_FM, changedCfg);
    const origBlock = extractFrontMatterBlock(ORIGINAL_WITH_FM)!;
    const newBlock = extractFrontMatterBlock(rewritten)!;
    const fmText = serializeFrontMatter(newBlock.lines);

    it('sync reads mode=scroll, designWidth=1920, bgColor unquoted', () => {
      expect(cfg.mode).toBe('scroll');
      expect(cfg.width).toBe(1920);
      expect(cfg.height).toBe(1080);
      expect(cfg.bgColor).toBe('#0a0a1a');
      // canvasConfig 不持有 speed（非 UI 字段）
      expect((cfg as any).speed).toBeUndefined();
    });

    it('frontmatter line count unchanged; only mode line changed to stage', () => {
      expect(newBlock.lines.length).toBe(origBlock.lines.length);
      let modeLineChanged = false;
      for (let i = 0; i < origBlock.lines.length; i++) {
        const a = origBlock.lines[i]!.raw;
        const b = newBlock.lines[i]!.raw;
        if (a === b) continue;
        expect(a.startsWith('mode: ') && b.startsWith('mode: ')).toBe(true);
        expect(b).toBe('mode: stage');
        modeLineChanged = true;
      }
      expect(modeLineChanged).toBe(true);
    });

    it('body preserved byte-for-byte', () => {
      expect(newBlock.body).toBe(origBlock.body);
    });

    it('comments, unknown fields, title, speed, var block all preserved (W1/W3)', () => {
      expect(fmText).toContain('// 这是作者注释,不能丢');
      expect(fmText).toContain('kmdVersion: 0.1');
      expect(fmText).toContain('title: 演示脚本');
      expect(fmText).toContain('speed: 1.5');
      expect(fmText).toContain('var:');
      expect(fmText).toContain('  hue: 200');
      expect(fmText).toContain('  name: "demo"');
    });

    it('re-sync is idempotent: reads mode=stage, bgColor unchanged (W3)', () => {
      const reSynced = syncConfigFromText(rewritten, DEFAULT_CFG);
      expect(reSynced.mode).toBe('stage');
      expect(reSynced.bgColor).toBe('#0a0a1a');
    });
  });

  describe('[b] 无 frontmatter 文档，UI 修改后插入新块 (W2)', () => {
    const noFm = '正文第一行\n\n正文第二行\n';
    const cfg = { ...DEFAULT_CFG, mode: 'page', width: 1080, height: 1920 };
    const rewritten = updateFrontMatter(noFm, cfg);
    const parts = rewritten.split('\n---\n', 2);
    const fmText = parts[0]!.replace(/^---\n/, '');
    const fmLines = fmText.split('\n');

    it('inserts opening + closing separators with 6 UI fields', () => {
      expect(rewritten.startsWith('---\n')).toBe(true);
      expect(parts.length).toBe(2);
      expect(fmLines.length).toBe(6);
    });

    it('new block carries all UI values', () => {
      expect(fmLines.some((l) => l === 'mode: page')).toBe(true);
      expect(fmLines.some((l) => l === 'designWidth: 1080')).toBe(true);
      expect(fmLines.some((l) => l === 'designHeight: 1920')).toBe(true);
      expect(fmLines.some((l) => l === 'bgColor: "#000000"')).toBe(true);
      expect(fmLines.some((l) => l === 'fontColor: "#ffffff"')).toBe(true);
      expect(fmLines.some((l) => l === 'fontFamily: Sasara Regular')).toBe(true);
    });

    it('body preserved after new block with separator empty line', () => {
      expect(parts[1]).toBe('\n正文第一行\n\n正文第二行\n');
    });

    it('re-sync reads inserted values', () => {
      const reSynced = syncConfigFromText(rewritten, DEFAULT_CFG);
      expect(reSynced.mode).toBe('page');
      expect(reSynced.width).toBe(1080);
      expect(reSynced.height).toBe(1920);
    });
  });

  describe('[c] syncConfigFromText 与 core parseMetadata 一致', () => {
    const src =
      '---\n' +
      'title: 一致性测试\n' +
      'mode: stage\n' +
      'designWidth: 1280\n' +
      'designHeight: 720\n' +
      'speed: 2\n' +
      'bgColor: "#112233"\n' +
      "fontColor: '#fff'\n" +
      'fontFamily: Noto Sans\n' +
      'maxWidth: 800\n' +
      'kmdVersion: 0.2\n' +
      '// 注释行\n' +
      'var:\n' +
      '  hue: 180\n' +
      '  scale: 1.5\n' +
      '---\n' +
      '正文\n';

    // coreMeta 运行时含 bgColor/fontColor/fontFamily/kmdVersion（frontmatter parseMetadata 读入），
    // 但 KMDMetadata 类型声明缺这些字段（生产侧类型债，本任务不顺手改——见 docs/planning/
    // architecture-health-check-2026-07.md 处方 10 globalThis.KmdRuntimeConfig schema 同源问题）。
    // 此处 cast 为 any 以访问，断言的是运行时行为而非类型完整性。
    const coreMeta = parser.parse(src).metadata as any;
    const storeCfg = syncConfigFromText(src, DEFAULT_CFG);

    it('6 UI fields agree between store-side sync and core parseMetadata', () => {
      expect(storeCfg.mode).toBe(coreMeta.mode);
      expect(storeCfg.width).toBe(coreMeta.designWidth);
      expect(storeCfg.height).toBe(coreMeta.designHeight);
      expect(storeCfg.bgColor).toBe(coreMeta.bgColor);
      expect(storeCfg.fontColor).toBe(coreMeta.fontColor);
      expect(storeCfg.fontFamily).toBe(coreMeta.fontFamily);
    });

    it('core reads non-UI fields (title, speed, maxWidth, kmdVersion)', () => {
      expect(coreMeta.title).toBe('一致性测试');
      expect(coreMeta.speed).toBe(2);
      expect(coreMeta.maxWidth).toBe(800);
      expect(coreMeta.kmdVersion).toBe(0.2);
    });

    it('core produces variables object with correct shape', () => {
      expect(coreMeta.variables && typeof coreMeta.variables === 'object').toBe(true);
      expect(coreMeta.variables?.hue).toBe(180);
      expect(coreMeta.variables?.scale).toBe(1.5);
    });

    it('empty-frontmatter doc: store keeps defaults, core does not set mode', () => {
      const emptySrc = '仅正文\n';
      const emptyCore = parser.parse(emptySrc).metadata;
      const emptyStore = syncConfigFromText(emptySrc, DEFAULT_CFG);
      expect(emptyStore.mode).toBe(DEFAULT_CFG.mode);
      expect(emptyCore.mode).toBeUndefined();
    });
  });
});