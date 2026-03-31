import { KMDCommandParser } from "./KMDCommandParser";
import { KmdAstParser } from "./AstParser";
import { buildParagraphData } from "./lowering";
import { getCommandSemanticInfo } from "./commandCatalog";
import { applyAstTransforms, builtInAstTransforms, builtInIrTransforms } from "./transforms";
import type {
  KMDParseResult,
  KMDParagraphData,
  ParserAstTransform,
  ParserDiagnostic,
  ParserIrTransform,
} from "./types";

export class KMDParser {
  private astParser = new KmdAstParser();
  private astTransforms: ParserAstTransform[] = [...builtInAstTransforms];
  private irTransforms: ParserIrTransform[] = [...builtInIrTransforms];

  public registerAstTransform(transform: ParserAstTransform) {
    this.astTransforms.push(transform);
  }

  public registerIrTransform(transform: ParserIrTransform) {
    this.irTransforms.push(transform);
  }

  public parse(input: any): KMDParseResult {
    const result: KMDParseResult = {
      metadata: { variables: {} },
      paragraphs: [],
      rawParagraphs: [],
      diagnostics: [],
    };
    if (typeof input !== "string") return result;

    try {
      const allLines = input.replace(/\r\n/g, "\n").split("\n");
      let currentLineIdx = 0;

      if (allLines.length > 0 && allLines[0]?.trim() === "---") {
        let endIdx = -1;
        for (let idx = 1; idx < allLines.length; idx++) {
          if (allLines[idx]?.trim() === "---") {
            endIdx = idx;
            break;
          }
        }
        if (endIdx !== -1) {
          this.parseMetadata(allLines.slice(1, endIdx).join("\n"), result.metadata);
          currentLineIdx = endIdx + 1;
        }
      }

      let currentBlockLines: string[] = [];
      let blockStartLine = -1;

      for (let idx = currentLineIdx; idx < allLines.length; idx++) {
        const line = allLines[idx];
        if (line === undefined) continue;

        if (line.trim() === "") {
          if (currentBlockLines.length > 0) {
            const raw = currentBlockLines.join("\n");
            const paragraph = this.parseParagraph(raw, blockStartLine);
            if (paragraph.tokens.length > 0 || paragraph.globalEffects.length > 0) {
              result.rawParagraphs.push(raw);
              result.paragraphs.push(paragraph);
              result.diagnostics?.push(...(paragraph.diagnostics || []));
            }
            currentBlockLines = [];
            blockStartLine = -1;
          }
          continue;
        }

        if (blockStartLine === -1) blockStartLine = idx;
        currentBlockLines.push(line);
      }

      if (currentBlockLines.length > 0) {
        const raw = currentBlockLines.join("\n");
        const paragraph = this.parseParagraph(raw, blockStartLine);
        if (paragraph.tokens.length > 0 || paragraph.globalEffects.length > 0) {
          result.rawParagraphs.push(raw);
          result.paragraphs.push(paragraph);
          result.diagnostics?.push(...(paragraph.diagnostics || []));
        }
      }

      return result;
    } catch (error: any) {
      console.error("[KMD Global Parser Error]", error);
      result.diagnostics?.push({
        severity: "error",
        message: `Parser failure: ${error.message}`,
        line: 0,
        code: "parser-failure",
      });
      return result;
    }
  }

  private parseMetadata(metaStr: string, metadata: any) {
    let inVar = false;
    metaStr.split("\n").forEach((line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("//")) return;
      if (trimmed === "var:") {
        inVar = true;
        return;
      }

      const colonIdx = line.indexOf(":");
      if (colonIdx === -1) return;

      const key = line.substring(0, colonIdx).trim();
      const val = line.substring(colonIdx + 1).trim();
      const parsed = KMDCommandParser.autoConvert(val);
      const indentMatch = line.match(/^\s*/);
      const indent = indentMatch ? indentMatch[0].length : 0;

      if (inVar && indent >= 2) {
        metadata.variables ??= {};
        metadata.variables[key] = parsed;
      } else {
        inVar = false;
        metadata[key] = parsed;
      }
    });
  }

  /**
   * Paragraph parsing entry for the new parser pipeline.
   * This method orchestrates AST parsing, optional transforms, and AST -> IR lowering,
   * then returns a compatibility-shaped paragraph object for the current runtime.
   */
  public parseParagraph(input: string, startLine: number = 0): KMDParagraphData {
    const diagnostics: ParserDiagnostic[] = [];
    const ast = applyAstTransforms(
      this.astParser.parseParagraph(input, startLine, diagnostics),
      this.astTransforms,
      diagnostics,
    );
    const paragraph = buildParagraphData(ast, diagnostics, this.irTransforms);
    paragraph.lineOffset = startLine;
    return paragraph;
  }

  public validate(input: string): { message: string; line: number }[] {
    const result = this.parse(input);
    const errors: { message: string; line: number }[] = [];

    const pushUnknowns = (name: string, line: number) => {
      const info = getCommandSemanticInfo(name);
      if (!info.known) {
        errors.push({
          message: `Unknown command: "${name}"`,
          line: line + 1,
        });
      }
    };

    result.paragraphs.forEach((paragraph) => {
      paragraph.globalEffects.forEach((effect) => pushUnknowns(effect.name, effect.line ?? paragraph.lineOffset ?? 0));
      paragraph.tokens.forEach((token) => {
        const line = token.line ?? paragraph.lineOffset ?? 0;
        token.effects.forEach((effect) => pushUnknowns(effect.name, line));
        token.layoutInstructions.forEach((instruction) => pushUnknowns(instruction.type, line));
      });
      paragraph.diagnostics?.forEach((diagnostic) => {
        if (diagnostic.severity === "error") {
          errors.push({ message: diagnostic.message, line: diagnostic.line + 1 });
        }
      });
    });

    return errors;
  }
}

export const parser = new KMDParser();
