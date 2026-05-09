import * as monaco from 'monaco-editor';
import { effectManager } from '../effects/EffectManager';
import { styleManager } from '../effects/StyleManager';
import { stageManager } from '../stage/StageManager';
import { layoutManager } from '../layout/LayoutManager';
import { parser } from '../parser/Parser';
import { getKmdGrammar, createTmTokensProvider } from './tmGrammarLoader';

// 定义语义 Token 类别
const tokenTypes = ['function', 'variable', 'keyword', 'string', 'number', 'operator', 'type', 'namespace', 'method'];
const tokenModifiers = ['declaration', 'documentation'];
const legend = { tokenTypes, tokenModifiers };

let isRegistered = false;

export const registerKMDLanguage = async () => {
  if (isRegistered) return;
  isRegistered = true;

  monaco.languages.register({ id: 'kmd' });

  // --- 1. TM grammar (replaces Monarch) ---
  const grammar = await getKmdGrammar();
  if (grammar) {
    monaco.languages.setTokensProvider('kmd', createTmTokensProvider(grammar));
  }

  // --- 2. 语义着色 ---
  monaco.languages.registerDocumentSemanticTokensProvider('kmd', {
    getLegend: () => legend,
    provideDocumentSemanticTokens: (model) => {
      const text = model.getValue();
      const result = parser.parse(text);
      const SemanticTokensBuilder = (monaco.languages as any).SemanticTokensBuilder;
      if (!SemanticTokensBuilder) return { data: new Uint32Array(), edits: [] };
      // Note: We are currently building the data array manually below, so builder is not strictly needed here
      // if we follow the manual pattern.

      const tokens: Array<{line: number, start: number, length: number, type: number}> = [];

      result.paragraphs.forEach((p) => {
        p.tokens.forEach(t => {
            if (t.line === undefined || !t.range) return;
            let type = -1;
            if ((t as any).isSugar) type = tokenTypes.indexOf('keyword');
            else if ((t as any).isPipe) type = tokenTypes.indexOf('operator');

            if (type !== -1) {
                tokens.push({ line: t.line, start: t.range.start, length: t.range.end - t.range.start, type });
            }
        });
      });

      tokens.sort((a, b) => a.line !== b.line ? a.line - b.line : a.start - b.start);

      const data = new Uint32Array(tokens.length * 5);
      let lastLine = 0;
      let lastStart = 0;

      for (let i = 0; i < tokens.length; i++) {
        const token = tokens[i]!;
        const deltaLine = token.line - lastLine;
        const deltaStart = deltaLine === 0 ? token.start - lastStart : token.start;
        data[i * 5] = deltaLine;
        data[i * 5 + 1] = deltaStart;
        data[i * 5 + 2] = token.length;
        data[i * 5 + 3] = token.type;
        data[i * 5 + 4] = 0;
        lastLine = token.line;
        lastStart = token.start;
      }
      return { data, edits: [] };
    },
    releaseDocumentSemanticTokens: () => {}
  });

  // --- 3. 主题与补全 ---
  monaco.editor.defineTheme('kmd-theme', {
    base: 'vs-dark',
    inherit: true,
    rules: [
      { token: 'operator.at', foreground: 'FFD700', fontStyle: 'bold' }, 
      { token: 'keyword.operator', foreground: 'FF7F50' },               
      { token: 'string.quote', foreground: 'CE9178' },                   
      { token: 'string.escape', foreground: 'D7BA7D', fontStyle: 'bold' }, 
      { token: 'keyword.prefix', foreground: '569CD6', fontStyle: 'italic' }, 
      { token: 'keyword.quantifier', foreground: 'C586C0' },             
      { token: 'variable.predefined', foreground: '4FC1FF' },            
      { token: 'keyword.header', foreground: '6A9955', fontStyle: 'bold' },
      { token: 'keyword.scene-clear', foreground: 'FF6B6B', fontStyle: 'bold' },
      { token: 'keyword.frontmatter.delimiter', foreground: '808080', fontStyle: 'italic' },
      { token: 'function', foreground: 'DCDCAA' },                       
      { token: 'variable.parameter', foreground: '9CDCFE' },
      { token: 'delimiter.parenthesis', foreground: 'ABB2BF' },
      { token: 'keyword.level', foreground: 'CE9178', fontStyle: 'italic' },
    ],
    colors: { 'editor.background': '#1E1E1E' }
  });

  monaco.languages.registerCompletionItemProvider('kmd', {
    triggerCharacters: ['.', ' ', '@', '(', ':'],
    provideCompletionItems: (model, position) => {
      const fullText = model.getValue();
      const lineContent = model.getLineContent(position.lineNumber);
      const word = model.getWordUntilPosition(position);
      const textBefore = lineContent.substring(0, position.column - 1);

      const markerRegex = /mark(?:Start|End|LineStart|LineEnd|Char)?\((['"]?)([a-zA-Z0-9_]+)\1\)/g;
      const docMarkers = new Set<string>();
      let m; while ((m = markerRegex.exec(fullText)) !== null) if (m[2]) docMarkers.add(m[2]);
      const varRegex = /^\s*([a-zA-Z0-9_]+):/gm;
      const docVars = new Set<string>();
      while ((m = varRegex.exec(fullText)) !== null) if (m[1]) docVars.add(m[1]);

      const suggestions: monaco.languages.CompletionItem[] = [];
      const range = {
        startLineNumber: position.lineNumber, endLineNumber: position.lineNumber,
        startColumn: word.startColumn, endColumn: word.endColumn,
      };

      if (textBefore.endsWith(':')) {
        ['char', 'group', 'block'].forEach(level => {
          suggestions.push({
            label: level,
            kind: monaco.languages.CompletionItemKind.Keyword,
            insertText: level,
            range
          });
        });
        return { suggestions };
      }

      const openParenIdx = textBefore.lastIndexOf('(');
      const closeParenIdx = textBefore.lastIndexOf(')');
      if (openParenIdx > closeParenIdx) {
          docMarkers.forEach(label => suggestions.push({ label, kind: monaco.languages.CompletionItemKind.Variable, insertText: label, range }));
          docVars.forEach(v => suggestions.push({ label: `var.${v}`, kind: monaco.languages.CompletionItemKind.Variable, insertText: `var.${v}`, range }));
          return { suggestions };
      }

      const allEffects = Object.keys((effectManager as any).registry);
      const allStyles = Object.keys((styleManager as any).registry);
      const allStage = Array.from((stageManager as any).registry.keys()) as string[];
      const allLayout = Object.keys((layoutManager as any).registry || {});

      if (textBefore.endsWith('f.')) {
        allEffects.concat(allStyles).forEach(name => suggestions.push({ label: name, kind: monaco.languages.CompletionItemKind.Function, insertText: name, range }));
      } else if (textBefore.endsWith('cam.')) {
        allStage.filter(s => s.startsWith('cam.')).forEach(name => {
          const shortName = name.substring(4);
          suggestions.push({ label: shortName, kind: monaco.languages.CompletionItemKind.Function, insertText: shortName, range });
        });
      } else if (textBefore.includes('@')) {
        const list = Array.from(new Set([...allEffects, ...allStyles, ...allStage, ...allLayout]));
        list.forEach(name => suggestions.push({ label: name, kind: monaco.languages.CompletionItemKind.Method, insertText: name, range }));
        if (!textBefore.endsWith('.')) suggestions.push({ label: 'f.', kind: monaco.languages.CompletionItemKind.Keyword, insertText: 'f.', range, command: { id: 'editor.action.triggerSuggest', title: '' } });
      }
      return { suggestions };
    },
  });

  monaco.languages.setLanguageConfiguration('kmd', {
    autoClosingPairs: [
      { open: '{', close: '}' }, { open: '(', close: ')' },
      { open: '[', close: ']' }, { open: '*', close: '*' },
      { open: '"', close: '"' }, { open: "'", close: "'" },
    ],
    brackets: [['{', '}'], ['[', ']'], ['(', ')']],
  });
};
