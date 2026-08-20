import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { compileKmdDocument } from '@kmd/core/compiler/KmdDocumentCompiler';

const FIXTURES = join(import.meta.dirname, '__fixtures__');

function fixture(path: string): string {
  return readFileSync(join(FIXTURES, path), 'utf-8').replace(/\r\n/gu, '\n');
}

describe('Phase B production compiler', () => {
  it('composes document, state, macro, semantic, option, control and graph lowering', () => {
    const source = fixture('b2/b2-design-probe.kmd')
      .replace('# truth @ .powerIn', '# truth');
    const compiled = compileKmdDocument(source);

    expect(compiled.schemaVersion).toBe(1);
    expect(compiled.options).toMatchObject({ mode: 'stage' });
    expect(compiled.scope.storeInitials).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: expect.objectContaining({ qualifiedName: 'var.trust' }), value: 4 }),
      expect.objectContaining({ key: expect.objectContaining({ qualifiedName: 'var.route' }), value: 'truth' }),
    ]));
    expect(compiled.control.anchors.map((entry) => entry.name)).toEqual([
      'start', 'truth', 'lie', 'end',
    ]);
    expect(compiled.graph.nodes.length).toBeGreaterThan(1);
    expect(compiled.graph.defaultPath.length).toBeGreaterThan(0);
    expect(compiled.scenes[0]?.paragraphs[0]?.options).toMatchObject({ speed: 80 });

    const conditionalLine = compiled.scenes
      .flatMap((scene) => scene.paragraphs)
      .flatMap((paragraph) => paragraph.lines)
      .find((line) => line.content.some((node) => node.type === 'bound-expr-span'));
    expect(conditionalLine).toBeDefined();
    expect(compiled.diagnostics.filter((entry) => entry.severity === 'error')).toEqual([]);
    expect(compiled.complete).toBe(true);
  });

  it('expands macro references before semantic IR and retains object mutation seeds', () => {
    const compiled = compileKmdDocument(fixture('b0-4/b0-4-design-probe.kmd'));
    const serializedScenes = JSON.stringify(compiled.scenes);

    expect(serializedScenes).not.toContain('resolved-reference-member');
    expect(serializedScenes).not.toContain('semantic-deferred-member');
    expect(compiled.scope.definitions.map((entry) => `${entry.kind}:${entry.name}`)).toEqual(
      expect.arrayContaining(['macro:heading', 'object:hero']),
    );
    expect(compiled.scope.objectMutations.map((entry) => entry.operation)).toEqual([
      'replace', 'upsert', 'remove',
    ]);
    expect(compiled.diagnostics.filter((entry) => entry.severity === 'error')).toEqual([]);
    expect(compiled.complete).toBe(true);
  });

  it('uses unique D21 command families for gray style and grayscale effect', () => {
    const compiled = compileKmdDocument([
      '{灰色文字} @ {}.gray',
      '{灰度滤镜} @ {}.grayscale',
      '@ bg.grayscale',
    ].join('\n'));
    const commands = compiled.analysis.inspector.commands.map((entry) => ({
      name: entry.name,
      family: entry.family,
    }));

    expect(commands).toEqual(expect.arrayContaining([
      { name: 'gray', family: 'style' },
      { name: 'grayscale', family: 'effect' },
    ]));
    expect(compiled.diagnostics.some((entry) => entry.code === 'scope-command-family-conflict')).toBe(false);
    expect(compiled.complete).toBe(true);
  });
});
