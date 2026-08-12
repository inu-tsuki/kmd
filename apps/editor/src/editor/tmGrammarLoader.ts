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

// Monaco 的 TokensProvider 只能为每段文本返回一个 token 名。保留最具体的 TM scope，
// 使标准 VS Code tokenColors 中的通用 selector（如 keyword.operator）和 KMD 专用
// selector（如 keyword.operator.at.kmd）都能通过 Monaco 的点分层级匹配。
function scopeToToken(scopes: string[]): string {
  for (let i = scopes.length - 1; i >= 0; i--) {
    const s = scopes[i]!;
    if (s !== 'source.kmd') return s;
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
