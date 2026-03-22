import type { KMDParseResult, KMDParagraphData } from "./types";
import { effectManager } from "../effects/EffectManager";
import { styleManager } from "../effects/StyleManager";
import { layoutManager } from "../layout/LayoutManager";
import { stageManager } from "../stage/StageManager";
import { KMDScanner } from "./KMDScanner";
import { KMDCommandParser } from "./KMDCommandParser";

export class KMDParser {
  private scanner = new KMDScanner();

  public parse(input: any): KMDParseResult {
    const result: KMDParseResult = { metadata: { variables: {} }, paragraphs: [], rawParagraphs: [] };
    if (typeof input !== 'string') return result;

    try {
      const allLines = input.replace(/\r\n/g, "\n").split("\n");

      // 1. 提取 Metadata (寻找 --- ... ---)
      let currentLineIdx = 0;
      if (allLines.length > 0 && allLines[0]?.trim() === "---") {
        let endIdx = -1;
        for (let i = 1; i < allLines.length; i++) {
          const line = allLines[i];
          if (line !== undefined && line.trim() === "---") { endIdx = i; break; }
        }
        if (endIdx !== -1) {
          const metaLines = allLines.slice(1, endIdx);
          this.parseMetadata(metaLines.join("\n"), result.metadata);
          currentLineIdx = endIdx + 1;
        }
      }

      // 2. 逐行聚合成段落，同时保持行号
      let currentBlockLines: string[] = [];
      let blockStartLine = -1;

      for (let i = currentLineIdx; i < allLines.length; i++) {
        const line = allLines[i];
        if (line === undefined) continue;

        if (line.trim() === "") {
          if (currentBlockLines.length > 0) {
            // 提交段落（过滤纯注释等空段落）
            const raw = currentBlockLines.join("\n");
            const pData = this.parseParagraph(raw, blockStartLine);
            if (pData.tokens.length > 0 || pData.globalEffects.length > 0) {
              result.rawParagraphs.push(raw);
              result.paragraphs.push(pData);
            }
            currentBlockLines = [];
            blockStartLine = -1;
          }
        } else {
          if (blockStartLine === -1) blockStartLine = i;
          currentBlockLines.push(line);
        }
      }

      if (currentBlockLines.length > 0) {
        const raw = currentBlockLines.join("\n");
        const pData = this.parseParagraph(raw, blockStartLine);
        if (pData.tokens.length > 0 || pData.globalEffects.length > 0) {
          result.rawParagraphs.push(raw);
          result.paragraphs.push(pData);
        }
      }

      return result;
    } catch (e: any) {
      console.error("[KMD Global Parser Error]", e);
      return result;
    }
  }

  private parseMetadata(metaStr: string, metadata: any) {
    let inVar = false;
    metaStr.split("\n").forEach(line => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("//")) return;
      if (trimmed === "var:") { inVar = true; return; }

      const colonIdx = line.indexOf(":");
      if (colonIdx !== -1) {
        const key = line.substring(0, colonIdx).trim();
        const val = line.substring(colonIdx + 1).trim();
        const parsed = KMDCommandParser.autoConvert(val);
        const indentMatch = line.match(/^\s*/);
        const indent = indentMatch ? indentMatch[0].length : 0;
        if (inVar && indent >= 2) {
          if (metadata.variables) metadata.variables[key] = parsed;
        } else {
          inVar = false;
          metadata[key] = parsed;
        }
      }
    });
  }

  public parseParagraph(input: string, startLine: number = 0): KMDParagraphData {
    // 关键重构：Parser 不再进行任何裁剪，将原始段落字符串完整交给 Scanner
    // 这保证了 Scanner 内部的 i 索引绝对对应物理行号
    const { tokens, globalEffects, blockOptions } = this.scanner.scan(input, startLine);

    return {
      blockOptions,
      tokens,
      globalEffects,
      lineOffset: startLine // 此时 lineOffset 就是 startLine，因为没做任何内部裁剪
    };
  }

  public validate(input: string): { message: string; line: number }[] {
    const errors: { message: string; line: number }[] = [];
    try {
      const result = this.parse(input);
      const check = (name: string, line: number) => {
        // 支持命名空间检查 (如 cam.zoom)
        const isKnown = (n: string) =>
          effectManager.has(n) || styleManager.has(n) ||
          layoutManager.has(n) || stageManager.has(n);

        let valid = isKnown(name);
        if (!valid && name.includes('.')) {
          const parts = name.split('.');
          // 如果是 cam.move，检查 cam 命名空间是否存在
          const namespace = parts[0];
          if (namespace !== undefined) {
            valid = isKnown(namespace);
          }
        }

        if (!valid) {
          errors.push({
            message: `未知指令: "${name}"`,
            line: line + 1 // Monaco 是 1-based
          });
        }
      };

      result.paragraphs.forEach((p) => {
        // 校验全局指令
        p.globalEffects.forEach(eff => {
          // 全局指令的行号目前不太好精确确定，先用段落第一个 token 的行号或 blockStartLine
          const line = p.tokens[0]?.line ?? 0;
          check(eff.name, line);
        });

        p.tokens.forEach(token => {
          const line = token.line ?? 0;
          token.effects.forEach((eff) => check(eff.name, line));
          token.layoutInstructions.forEach((instr) => check(instr.type, line));
        });
      });
    } catch (e: any) {
      errors.push({ message: `语法错误: ${e.message}`, line: 1 });
    }
    return errors;
  }
}

export const parser = new KMDParser();