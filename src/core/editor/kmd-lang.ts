import * as monaco from 'monaco-editor';
import { effectManager } from '../effects/EffectManager';
import { styleManager } from '../effects/StyleManager';
import { stageManager } from '../stage/StageManager';
import { layoutManager } from '../layout/LayoutManager';
import { parser } from '../parser/Parser';

// 定义语义 Token 类别
const tokenTypes = ['function', 'variable', 'keyword', 'string', 'number', 'operator', 'type', 'namespace', 'method'];
const tokenModifiers = ['declaration', 'documentation'];
const legend = { tokenTypes, tokenModifiers };

let isRegistered = false;

export const registerKMDLanguage = () => {
  if (isRegistered) return;
  isRegistered = true;

  monaco.languages.register({ id: 'kmd' });

  // --- 1. Monarch 语法定义 ---
  monaco.languages.setMonarchTokensProvider('kmd', {
    defaultToken: '',
    tokenPostfix: '.kmd',

    tokenizer: {
      // root: 初始分发器 — 仅决定是进入 frontmatter 还是 body
      root: [
        [/^---$/, { token: 'keyword.frontmatter.delimiter', switchTo: '@frontmatter' }],
        [/.*/, { token: '@rematch', switchTo: '@body' }],
      ],

      // frontmatter: YAML 元数据区域，关闭后进入 body（不可再回到 frontmatter）
      frontmatter: [
        [/^---$/, { token: 'keyword.frontmatter.delimiter', switchTo: '@body' }],
        [/^\s*[a-zA-Z0-9_]+(?=:)/, 'type.identifier'],
        [/[:]/, 'operator'],
        [/.*$/, 'string'],
      ],

      // body: 正文状态 — 所有 KMD 语法规则，--- 仅作为 scene-clear
      body: [
        // 1.1 最高优先级：转义符
        [/\\./, 'string.escape'],

        // 1.2 结构符号
        [/^---$/, 'keyword.scene-clear'],
        [/\/\/.*$/, 'comment'],
        [/^#\s.*$/, 'keyword.header'],
        [/{/, { token: 'delimiter.curly', next: '@braceContent' }],
        [/^\[/, { token: 'delimiter.square', next: '@bracketContent' }],

        // 1.3 指令入口
        [/@$/, 'operator.at'],                                       // 裸 @ — 不进入 commandChain
        [/@/, { token: 'operator.at', next: '@commandChain' }],

        // 1.4 节奏糖 (Go, Wait, Speed)
        [/>>>|>>|>/, 'keyword.operator'],
        [/[!~^]/, 'keyword.operator'],
        [/\|/, { token: 'keyword.operator', next: '@pipeParams' }],

        // 1.5 文字装饰
        [/\*\*.*?\*\*/, 'string.strong'],
        [/\*.*?\*/, 'string.italic'],
        [/var\.[a-zA-Z0-9_]+/, 'variable.predefined'],
      ],

      braceContent: [
        [/\\./, 'string.escape'], 
        [/}/, { token: 'delimiter.curly', next: '@pop' }],
        [/\*\*.*?\*\*/, 'string.strong'],
        [/\*.*?\*/, 'string.italic'],
        [/>>>|>>|>/, 'keyword.operator'],
        [/[!~^]/, 'keyword.operator'],
        [/\|/, { token: 'keyword.operator', next: '@pipeParams' }],
        [/./, 'string.quote'], 
      ],

      pipeParams: [
        [/\(/, { token: 'delimiter.parenthesis', next: '@parameters' }],
        [/$/, '', '@pop'], 
        ['', '', '@pop'],  
      ],

      bracketContent: [
        [/\]/, { token: 'delimiter.square', next: '@pop' }],
        [/f\./, 'keyword.prefix'], 
        [/cam\./, 'keyword.prefix'], 
        [/[a-zA-Z0-9_]+(?==)/, 'type.identifier'], 
        [/=/, 'operator'],
        [/@/, 'operator.at'],                      
        [/[a-zA-Z0-9_\.]+(?=\()/, 'function'],     
        [/[a-zA-Z0-9_\.]+/, 'variable'],
        [/[!~^]/, 'keyword.operator'],
        [/\|/, { token: 'keyword.operator', next: '@pipeParams' }],
        [/\(/, { token: 'delimiter.parenthesis', next: '@parameters' }],
        [/\s+/, 'white'],
        [/$/, '', '@pop'], 
      ],

      // 指令链持续到行尾
      commandChain: [
        [/f\./, 'keyword.prefix'], 
        [/cam\./, 'keyword.prefix'], 
        [/^\./, 'punctuation'], 
        [/[a-zA-Z0-9_]+(?:\.[a-zA-Z0-9_]+)*/, 'function'], 
        [/\(/, { token: 'delimiter.parenthesis', next: '@parameters' }],
        [/\./, 'punctuation'], 
        [/[:]/, { token: 'punctuation', next: '@levelSuffix' }],
        
        // 【关键修复 1.2-1.8】在指令链中也能识别 @ 和 节奏糖
        [/@/, 'operator.at'],
        [/>>>|>>|>/, 'keyword.operator'],
        [/[!~^]/, 'keyword.operator'],
        
        [/\s+/, 'white'], 

        // 【关键修复】如果遇到不属于指令的字符（如中文），强行回退到 root
        // 允许常见的指令字符，包括点号和冒号
        [/[^a-zA-Z0-9_().\s,\|!|>|~|^: \t]/, { token: '@rematch', next: '@pop' }],

        [/$/, '', '@pop'], 
      ],

      levelSuffix: [
        [/(char|group|block)\b/, 'keyword.level'],
        ['', '', '@pop'], 
      ],

      parameters: [
        [/\)/, { token: 'delimiter.parenthesis', next: '@pop' }],
        [/[a-zA-Z0-9_]+(?==)/, 'variable.parameter'], 
        [/=/, 'operator'],
        [/var\.[a-zA-Z0-9_]+/, 'variable.predefined'],
        [/(\d+(?:\.\d+)?)(ms|self|s|em|px|%)/, ['number', 'keyword.quantifier']],
        [/\d+(?:\.\d+)?/, 'number'],
        [/'[^']*'/, 'string'],
        [/"[^"]*"/, 'string'],
        [/,/, 'punctuation'],
        [/[a-zA-Z0-9_]+/, 'variable'], 

        // 参数内部也支持 rematch
        [/[^a-zA-Z0-9_().\s,='": \t]/, { token: '@rematch', next: '@pop' }],

        [/$/, '', '@popall'], 
      ],
    },
  });

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
