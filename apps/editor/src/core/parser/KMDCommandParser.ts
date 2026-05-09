import type { EffectConfig, LayoutInstruction, EffectParams } from "./types";

export class KMDCommandParser {
  public static isVisual(str: string): boolean {
    return str.startsWith("f.") || str.startsWith(".");
  }

  public static parseParams(paramStr: string): EffectParams {
    const result: EffectParams = {};
    if (!paramStr) return result;
    const parts = paramStr.split(",").map(p => p.trim());
    parts.forEach((part, index) => {
      const eqIdx = part.indexOf("=");
      if (eqIdx !== -1) {
        result[part.substring(0, eqIdx).trim()] = this.autoConvert(part.substring(eqIdx + 1).trim());
      } else {
        result[index] = this.autoConvert(part);
      }
    });
    return result;
  }

  public static autoConvert(val: string): any {
    if (val.startsWith("var.")) return val;
    if (val === "true") return true;
    if (val === "false") return false;
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) return val.slice(1, -1);
    const num = parseFloat(val);
    if (isNaN(num)) return val;
    if (val.endsWith("ms")) return num / 1000;
    if (val.endsWith("s") && !val.endsWith("ms")) return num;
    if (/^-?\d+(\.\d+)?$/.test(val)) return num;
    return val;
  }

  public static parseEffectChain(chainStr: string): EffectConfig[] {
    const results: EffectConfig[] = [];
    if (!chainStr.trim()) return results;
    
    // 移除起始的 f. 或 .
    let str = chainStr;
    if (str.startsWith("f.")) str = str.substring(2);
    else if (str.startsWith(".")) str = str.substring(1);

    // 核心修正：保护 cam. 等命名空间不被点链拆分逻辑破坏
    // 我们暂时将 cam. 替换为占位符
    str = str.replace(/cam\./g, "NAMESPACE_CAM_DOT_");

    // 稳健拆分点链
    const parts: string[] = [];
    let current = "";
    let depth = 0;
    for (let i = 0; i < str.length; i++) {
        const c = str[i];
        if (c === '(') depth++;
        else if (c === ')') depth--;
        
        if (c === '.' && depth === 0) {
            if (current) parts.push(current);
            current = "";
        } else {
            current += c;
        }
    }
    if (current) parts.push(current);

    parts.forEach(p => {
        // 还原占位符
        const cleanPart = p.replace(/NAMESPACE_CAM_DOT_/g, "cam.");
        const regex = /([a-zA-Z0-9_\-.]+)(?::(char|group|block))?(?:\(([^)]*)\))?(!)?/;
        const m = cleanPart.match(regex);
        if (m) {
            results.push({
                name: m[1]!,
                level: (m[2] as any) || undefined,
                params: this.parseParams(m[3] || ""),
                blocking: !!m[4]
            });
        }
    });
    return results;
  }

  public static parseInstruction(instrStr: string): LayoutInstruction {
    const chain = this.parseEffectChain(instrStr);
    if (chain.length > 0 && chain[0]) {
        return {
            type: chain[0].name,
            params: chain[0].params,
            blocking: chain[0].blocking
        };
    }
    return { type: "unknown", params: {} };
  }
}