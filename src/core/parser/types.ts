import type {
  DiagnosticEvent,
  DiagnosticSeverity,
  SourceRange,
} from "../types";

export type EffectParams = Record<string, any>;
export type CommandLevel = "char" | "group" | "block";
export type CommandPrefix = "f" | "dot" | "bare";
export type CommandFamily = "effect" | "style" | "layout" | "stage" | "unknown";
export type CommandScope = "token" | "line" | "paragraph";
export type InlineMark = "bold" | "italic";
export type { DiagnosticSeverity, SourceRange };

export interface SourceLocation {
  line: number;
  range: SourceRange;
}

export interface ParserDiagnostic extends DiagnosticEvent {
  line: number;
}

export interface KMDMetadata {
  title?: string;
  author?: string;
  mode?: "stage" | "scroll" | "page";
  designWidth?: number;
  designHeight?: number;
  fontSize?: number;
  lineHeight?: number;
  maxWidth?: number;
  speed?: number;
  variables?: Record<string, any>;
}

export interface EffectConfig {
  name: string;
  params: EffectParams;
  level?: CommandLevel;
  blocking?: boolean;
  line?: number;
  range?: SourceRange;
}

export interface LayoutInstruction {
  type: string;
  params: Record<string, any>;
  blocking?: boolean;
  level?: CommandLevel;
  lineScope?: "pre" | "post";
  line?: number;
  range?: SourceRange;
}

export interface KMDToken {
  content: string;
  effects: EffectConfig[];
  commands: string[];
  params: EffectParams;
  layoutInstructions: LayoutInstruction[];
  isSceneClear?: boolean;
  isSugar?: boolean;
  isPipe?: boolean;
  isBraced?: boolean;
  braceGroupId?: number;
  range?: SourceRange;
  line?: number;
  sugar?: Array<{
    charIdx?: number;
    name: string;
    level: CommandLevel;
    params: Record<string, any>;
  }>;
  startTime?: number;
  duration?: number;
}

export type KMDLine = KMDToken[];

export interface BlockOptions {
  indent?: number;
  align?: "left" | "center" | "right";
  lineHeight?: number;
  letterSpacing?: number;
  maxWidth?: number;
  fontSize?: number;
  mode?: "normal" | "fade" | "instant" | "jump";
  speed?: number;
}

export interface ParsedCommand extends EffectConfig {
  prefix: CommandPrefix;
  family: CommandFamily;
  raw: string;
}

export interface CommandChainAst {
  type: "command-chain";
  prefix: CommandPrefix;
  raw: string;
  commands: ParsedCommand[];
  line: number;
  range: SourceRange;
}

export interface BlockOptionValueAst {
  type: "block-option-value";
  key: string;
  value: any;
  line: number;
  range: SourceRange;
}

export interface BlockOptionCommandAst {
  type: "block-option-command";
  chain: CommandChainAst;
  line: number;
  range: SourceRange;
}

export type BlockOptionAst = BlockOptionValueAst | BlockOptionCommandAst;

export interface TextNodeAst {
  type: "text";
  text: string;
  marks: InlineMark[];
  groupId?: number;
  line: number;
  range: SourceRange;
}

export interface GroupNodeAst {
  type: "group";
  groupId: number;
  children: InlineNodeAst[];
  line: number;
  range: SourceRange;
}

export interface SugarNodeAst {
  type: "sugar";
  name: "go" | "slow" | "fast";
  level: CommandLevel;
  params: EffectParams;
  groupId?: number;
  line: number;
  range: SourceRange;
}

export interface PauseNodeAst {
  type: "pause";
  params: EffectParams;
  groupId?: number;
  line: number;
  range: SourceRange;
}

export type InlineNodeAst = TextNodeAst | GroupNodeAst | SugarNodeAst | PauseNodeAst;

export interface ParagraphLineAst {
  type: "line";
  kind: "content" | "empty" | "scene-clear" | "command-only";
  raw: string;
  line: number;
  range: SourceRange;
  heading: boolean;
  body: InlineNodeAst[];
  commandChains: CommandChainAst[];
}

export interface ParagraphAst {
  type: "paragraph";
  lineOffset: number;
  source: string;
  blockOptions: BlockOptionAst[];
  lines: ParagraphLineAst[];
}

export interface KMDInlineIR {
  kind: "text" | "sugar" | "pause" | "newline" | "scene-clear";
  line: number;
  range: SourceRange;
  content: string;
  effects: EffectConfig[];
  commands: string[];
  params: EffectParams;
  layoutInstructions: LayoutInstruction[];
  sugar: Array<{
    charIdx?: number;
    name: string;
    level: CommandLevel;
    params: Record<string, any>;
  }>;
  isSceneClear?: boolean;
  isSugar?: boolean;
  isPipe?: boolean;
  isBraced?: boolean;
  braceGroupId?: number;
}

export interface ParagraphIR {
  blockOptions: BlockOptions;
  inline: KMDInlineIR[];
  paragraphEffects: EffectConfig[];
  diagnostics: ParserDiagnostic[];
}

export interface KMDParagraphData {
  blockOptions: BlockOptions;
  tokens: KMDToken[];
  globalEffects: EffectConfig[];
  lineOffset?: number;
  estimatedDuration?: number;
  absStartTime?: number;
  snapshot?: any;
  ast?: ParagraphAst;
  ir?: ParagraphIR;
  diagnostics?: ParserDiagnostic[];
}

export interface KMDParseResult {
  metadata: KMDMetadata;
  paragraphs: KMDParagraphData[];
  rawParagraphs: string[];
  diagnostics?: ParserDiagnostic[];
}

export interface KMDScanResult {
  tokens: KMDToken[];
  globalEffects: EffectConfig[];
  blockOptions: BlockOptions;
}

export interface ParserAstTransform {
  name: string;
  run(paragraph: ParagraphAst, diagnostics: ParserDiagnostic[]): ParagraphAst;
}

export interface ParserIrTransform {
  name: string;
  run(ir: ParagraphIR, diagnostics: ParserDiagnostic[]): ParagraphIR;
}
