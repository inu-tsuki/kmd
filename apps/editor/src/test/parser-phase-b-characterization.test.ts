import { describe, expect, it } from 'vitest';
import { KMDCommandParser } from '@kmd/core/parser/KMDCommandParser';
import { KMDParser } from '@kmd/core/parser/Parser';

describe('Phase B gate characterization: expected legacy value coercion', () => {
  it.each([
    ['+1', '+1'],
    ['.5', '.5'],
    ['1e3', '1e3'],
    ['-0.5', -0.5],
    ['1s', 1],
    ['1e3s', 1000],
    ['1e3ms', 1],
    ['1E-2s', 0.01],
    ['1E-2ms', 0.00001],
  ])('records autoConvert(%s) as %j', (raw, expected) => {
    expect(KMDCommandParser.autoConvert(raw)).toEqual(expected);
  });

  it('records quoted strings as raw inner text without escape decoding', () => {
    expect(KMDCommandParser.autoConvert('"a\\n"')).toBe('a\\n');
    expect(KMDCommandParser.autoConvert('"a\\"b"')).toBe('a\\"b');
  });

});

describe('Phase B gate characterization: known/current accidental gaps', () => {
  it('records malformed 1ss being accidentally coerced to number', () => {
    expect(KMDCommandParser.autoConvert('1ss')).toBe(1);
  });

  it('records the flat comma/equal splitter corrupting nested and quoted commas', () => {
    expect(KMDCommandParser.parseParams('fn(1, nested(2, 3)), label="a,b", expr=a=b')).toEqual({
      0: 'fn(1',
      1: 'nested(2',
      2: '3))',
      4: 'b"',
      label: '"a',
      expr: 'a=b',
    });
  });
  it('records quoted // being truncated by the current non-quote-aware comment scanner', () => {
    const paragraph = new KMDParser().parse('text @ f.wave(label="a // b")').paragraphs[0]!;
    const chain = paragraph.ast?.lines[0]?.commandChains[0];

    expect(paragraph.ast?.lines[0]?.raw).toBe('text @ f.wave(label="a');
    expect(chain?.commands[0]?.params).toEqual({});
    expect(chain?.range).toEqual({ start: 7, end: 22 });
  });

  it('records inline |(click) using the legacy parseParams path', () => {
    const paragraph = new KMDParser().parse('A|(click)B').paragraphs[0]!;
    const pause = paragraph.ast?.lines[0]?.body.find((node) => node.type === 'pause');
    const pipe = paragraph.tokens.find((token) => token.isPipe);

    expect(pause).toMatchObject({
      type: 'pause',
      params: { 0: 'click' },
      range: { start: 1, end: 9 },
    });
    expect(pipe).toMatchObject({ params: {}, isPipe: true, range: { start: 1, end: 9 } });
  });

  it('records block options being pre-split and ranges losing two columns of indentation', () => {
    const paragraph = new KMDParser().parse('  [.wave .red align=center] AB').paragraphs[0]!;

    expect(paragraph.ast?.blockOptions).toMatchObject([
      { type: 'block-option-command', chain: { raw: '.wave' }, range: { start: 1, end: 6 } },
      { type: 'block-option-command', chain: { raw: '.red' }, range: { start: 7, end: 11 } },
      { type: 'block-option-value', key: 'align', value: 'center', range: { start: 12, end: 24 } },
    ]);
    expect(paragraph.tokens[0]?.content).toBe('AB');
    expect(paragraph.tokens[0]?.range).toEqual({ start: 0, end: 2 });
  });

  it('records command-only diagnostics being dropped with the empty runtime paragraph', () => {
    const result = new KMDParser().parse('@ f.notInstalled()');

    expect(result.paragraphs).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });
});

describe('Phase B adoption targets: intentionally not current behavior', () => {
  it.fails('will reject malformed 1ss instead of preserving the legacy accidental numeric coercion', () => {
    expect(KMDCommandParser.autoConvert('1ss')).toBe('1ss');
  });

  it.fails('will retain a command-only diagnostic even when no runtime paragraph is projected', () => {
    const result = new KMDParser().parse('@ f.notInstalled()');
    expect(result.diagnostics).toMatchObject([
      { code: 'unknown-command', line: 0 },
    ]);
  });
});
