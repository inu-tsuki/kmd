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
}

export interface KMDToken {
  content: string;
  effects: EffectConfig[];
  commands: string[];
  params: EffectParams;
  layoutInstructions: LayoutInstruction[];
  isSceneClear?: boolean; // 新增：是否是场景清除指令 (---)
  range?: { start: number; end: number }; // 【新增】该 Token 在行内的起止位置
  line?: number; // 【新增】该 Token 所在的行号
  sugar?: Array<{
    charIdx?: number;
    name: string;
    level: "char" | "group" | "block";
    params: Record<string, any>;
  }>;
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
}

/**
 * 完整解析结果
 */
export interface KMDParseResult {
  metadata: KMDMetadata;
  paragraphs: KMDParagraphData[];
  rawParagraphs: string[]; // 新增：保存原始字符串片段
}

export interface KMDParagraphData {
  blockOptions: BlockOptions;
  tokens: KMDToken[];
  globalEffects: EffectConfig[];
}
