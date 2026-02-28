// 定义通用的参数字典
export type EffectParams = Record<string, any>;

/**
 * KMD 文件头元数据
 */
export interface KMDMetadata {
  title?: string;
  author?: string;
  mode?: "stage" | "scroll" | "page";
  designWidth?: number;
  designHeight?: number;
  fontSize?: number;
  lineHeight?: number;
  speed?: number;
  variables?: Record<string, any>;
}

export interface EffectConfig {
  name: string;
  params: EffectParams;
  level?: "char" | "group" | "block";
  blocking?: boolean;
  line?: number; // 新增：源码行号
  range?: { start: number; end: number }; // 新增：源码列范围
}

export interface KMDToken {
  content: string;
  effects: EffectConfig[];
  commands: string[];
  params: EffectParams;
  layoutInstructions: LayoutInstruction[];
  isSceneClear?: boolean; 
  range?: { start: number; end: number }; 
  line?: number; 
  sugar?: Array<{
    charIdx?: number;
    name: string;
    level: "char" | "group" | "block";
    params: Record<string, any>;
  }>;
  startTime?: number; // 新增：相对于段落开始的预估时间 (ms)
  duration?: number;  // 新增：该 Token 的展示时长 (ms)
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

export interface LayoutInstruction {
  type: string;
  params: Record<string, any>;
  blocking?: boolean;
  level?: "char" | "group" | "block";
  line?: number;
  range?: { start: number; end: number };
}

/**
 * 完整解析结果
 */
export interface KMDParseResult {
  metadata: KMDMetadata;
  paragraphs: KMDParagraphData[];
  rawParagraphs: string[]; 
}

export interface KMDParagraphData {
  blockOptions: BlockOptions;
  tokens: KMDToken[];
  globalEffects: EffectConfig[];
  estimatedDuration?: number; 
  absStartTime?: number;      
  lineOffset?: number;        
  snapshot?: any; // KmdSnapshot (Any to avoid circular dep)
}

/**
 * Scanner 返回结果
 */
export interface KMDScanResult {
  tokens: KMDToken[];
  globalEffects: EffectConfig[];
  blockOptions: BlockOptions;
}
