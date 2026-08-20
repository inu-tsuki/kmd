import type { SourceRange } from './diagnostics';

export type EffectParams = Record<string, unknown>;
export type CommandLevel = 'char' | 'group' | 'block' | 'bg';

/**
 * Runtime effect request consumed by the established record/replay helpers.
 * Phase B parser and semantic layers use their own typed AST and do not emit
 * this shape as a parser intermediate representation.
 */
export interface EffectConfig {
  name: string;
  params: EffectParams;
  level?: CommandLevel;
  blocking?: boolean;
  line?: number;
  range?: SourceRange;
}
