import { Registry, INITIAL } from 'vscode-textmate';
import { createOnigScanner, createOnigString, loadWASM } from 'vscode-oniguruma';
import type { IGrammar, StateStack } from 'vscode-textmate';
import type * as monaco from 'monaco-editor';
import kmdGrammarJson from '@kmd/language/syntaxes/kmd.tmLanguage.json';
import onigurumaWasmUrl from 'vscode-oniguruma/release/onig.wasm?url';

let grammarPromise: Promise<IGrammar | null> | null = null;

export async function getKmdGrammar(): Promise<IGrammar | null> {
  if (grammarPromise) return grammarPromise;
  grammarPromise = (async () => {
    const wasmBinary = await fetch(onigurumaWasmUrl).then(r => r.arrayBuffer());
    await loadWASM(wasmBinary);
    const registry = new Registry({
      onigLib: Promise.resolve({ createOnigScanner, createOnigString }),
      loadGrammar: async (scopeName) =>
        scopeName === 'source.kmd' ? (kmdGrammarJson as any) : null,
    });
    return registry.loadGrammar('source.kmd');
  })();
  return grammarPromise;
}

// Monaco IState wrapper — vscode-textmate StateStack is immutable, reference equality suffices
class TmState implements monaco.languages.IState {
  readonly stack: StateStack;
  constructor(stack: StateStack) { this.stack = stack; }
  clone(): monaco.languages.IState { return new TmState(this.stack); }
  equals(other: monaco.languages.IState): boolean {
    return other instanceof TmState && this.stack === other.stack;
  }
}

// TM scope → Monaco token name — keeps existing kmd-theme rules intact
function scopeToToken(scopes: string[]): string {
  for (let i = scopes.length - 1; i >= 0; i--) {
    const s = scopes[i]!;
    if (s.includes('keyword.operator.at')) return 'operator.at';
    if (s.includes('keyword.operator.advance')) return 'keyword.operator';
    if (s.includes('keyword.operator.speed')) return 'keyword.operator';
    if (s.includes('keyword.operator.pause')) return 'keyword.operator';
    if (s.includes('keyword.operator.async')) return 'keyword.operator';
    if (s.includes('keyword.control')) return 'keyword.operator';
    if (s.includes('markup.heading')) return 'keyword.header';
    if (s.includes('punctuation.definition.heading')) return 'keyword.header';
    if (s.includes('keyword.control.scene-clear')) return 'keyword.scene-clear';
    if (s.includes('punctuation.definition.frontmatter')) return 'keyword.frontmatter.delimiter';
    if (s.includes('entity.name.tag')) return 'type.identifier';
    if (s.includes('storage.modifier.level')) return 'keyword.level';
    if (s.includes('keyword.other.effect-prefix')) return 'keyword.prefix';
    if (s.includes('keyword.other.namespace')) return 'keyword.prefix';
    if (s.includes('variable.parameter')) return 'variable.parameter';
    if (s.includes('variable.other')) return 'variable.predefined';
    if (s.includes('constant.numeric')) return 'number';
    if (s.includes('string.quoted')) return 'string.quote';
    if (s.includes('string.unquoted')) return 'string';
    if (s.includes('markup.bold')) return 'string.strong';
    if (s.includes('markup.italic')) return 'string.italic';
    if (s.includes('entity.name.function')) return 'function';
    if (s.includes('punctuation.definition')) return 'delimiter.parenthesis';
    if (s.includes('comment')) return 'comment';
    if (s.includes('constant.character.escape')) return 'string.escape';
  }
  return '';
}

export function createTmTokensProvider(grammar: IGrammar): monaco.languages.TokensProvider {
  return {
    getInitialState: () => new TmState(INITIAL),
    tokenize(line: string, state: monaco.languages.IState) {
      const stack = state instanceof TmState ? state.stack : INITIAL;
      const result = grammar.tokenizeLine(line, stack);
      return {
        tokens: result.tokens.map(t => ({
          startIndex: t.startIndex,
          scopes: scopeToToken(t.scopes),
        })),
        endState: new TmState(result.ruleStack),
      };
    },
  };
}
