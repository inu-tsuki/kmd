import { KMDCommandParser } from "./KMDCommandParser";
import { attachCommandFamily, runtimeCommandRegistryView, type CommandRegistryView } from "./commandCatalog";
import type {
  BlockOptionAst,
  BlockOptionCommandAst,
  BlockOptionValueAst,
  CommandChainAst,
  CommandPrefix,
  InlineMark,
  InlineNodeAst,
  ParagraphAst,
  ParagraphLineAst,
  ParsedCommand,
  ParserDiagnostic,
  PauseNodeAst,
  SugarNodeAst,
  TextNodeAst,
} from "./types";

type InlineParseState = {
  pos: number;
  marks: Set<InlineMark>;
};

export class KmdAstParser {
  private braceIdCounter = 0;

  /**
   * Syntax-only paragraph frontend.
   * It preserves source structure as AST nodes and source ranges, but does not decide
   * final command scope or runtime track routing.
   */
  public parseParagraph(
    source: string,
    lineOffset: number,
    diagnostics: ParserDiagnostic[],
    registryView: CommandRegistryView = runtimeCommandRegistryView,
  ): ParagraphAst {
    const lines = source.split("\n");
    const blockOptions: BlockOptionAst[] = [];
    const astLines: ParagraphLineAst[] = [];
    let hasProcessedBlockOptions = false;

    for (let idx = 0; idx < lines.length; idx++) {
      const originalLine = lines[idx] ?? "";
      let rawLine = originalLine;
      const line = lineOffset + idx;
      rawLine = this.stripComment(rawLine);

      if (this.isPureCommentLine(originalLine, rawLine)) {
        continue;
      }

      if (!hasProcessedBlockOptions && rawLine.trim().startsWith("[")) {
        const trimmed = rawLine.trim();
        const end = trimmed.indexOf("]");
        if (end !== -1) {
          blockOptions.push(...this.parseBlockOptions(trimmed.slice(1, end), line, diagnostics, registryView));
          rawLine = trimmed.slice(end + 1).trim();
          hasProcessedBlockOptions = true;
          if (!rawLine) {
            continue;
          }
        }
      }

      if (rawLine.trim() === "---") {
        astLines.push({
          type: "line",
          kind: "scene-clear",
          raw: rawLine,
          line,
          range: { start: 0, end: rawLine.length },
          heading: false,
          body: [],
          commandChains: [],
        });
        continue;
      }

      if (!rawLine.trim()) {
        astLines.push({
          type: "line",
          kind: "empty",
          raw: rawLine,
          line,
          range: { start: 0, end: rawLine.length },
          heading: false,
          body: [],
          commandChains: [],
        });
        continue;
      }

      const atIndex = this.findAtSymbol(rawLine);
      let bodyText = atIndex >= 0 ? rawLine.slice(0, atIndex).trimEnd() : rawLine.trimEnd();
      const commandText = atIndex >= 0 ? rawLine.slice(atIndex + 1) : "";

      if (atIndex >= 0 && !bodyText.trim() && !commandText.trim()) {
        astLines.push({
          type: "line",
          kind: "command-only",
          raw: rawLine,
          line,
          range: { start: 0, end: rawLine.length },
          heading: false,
          body: [],
          commandChains: [],
        });
        continue;
      }

      let heading = false;
      if (bodyText.trim().startsWith("# ")) {
        heading = true;
        bodyText = bodyText.trim().slice(2);
      }

      const state: InlineParseState = { pos: 0, marks: new Set() };
      const body = this.parseInline(bodyText, line, state, diagnostics);
      const commandChains = commandText.trim()
        ? this.parseCommandChains(commandText, line, atIndex + 1, diagnostics, registryView)
        : [];

      astLines.push({
        type: "line",
        kind: body.length > 0 ? "content" : "command-only",
        raw: rawLine,
        line,
        range: { start: 0, end: rawLine.length },
        heading,
        body,
        commandChains,
      });
    }

    return {
      type: "paragraph",
      lineOffset,
      source,
      blockOptions,
      lines: astLines,
    };
  }

  private parseBlockOptions(
    content: string,
    line: number,
    diagnostics: ParserDiagnostic[],
    registryView: CommandRegistryView = runtimeCommandRegistryView,
  ): BlockOptionAst[] {
    const parts = this.splitTopLevel(content);
    const results: BlockOptionAst[] = [];

    for (const part of parts) {
      if (part.text.includes("=")) {
        const eq = part.text.indexOf("=");
        const key = part.text.slice(0, eq).trim();
        const value = KMDCommandParser.autoConvert(part.text.slice(eq + 1).trim());
        const node: BlockOptionValueAst = {
          type: "block-option-value",
          key,
          value,
          line,
          range: { start: part.start + 1, end: part.end + 1 },
        };
        results.push(node);
        continue;
      }

      const chains = this.parseCommandChains(
        part.text,
        line,
        part.start + 1,
        diagnostics,
        registryView,
      );
      for (const chain of chains) {
        const node: BlockOptionCommandAst = {
          type: "block-option-command",
          chain,
          line,
          range: chain.range,
        };
        results.push(node);
      }
    }

    return results;
  }

  private parseCommandChains(
    input: string,
    line: number,
    offset: number,
    diagnostics: ParserDiagnostic[],
    registryView: CommandRegistryView = runtimeCommandRegistryView,
  ): CommandChainAst[] {
    const parts = this.splitTopLevel(input);
    return parts
      .filter((part) => part.text.trim().length > 0)
      .map((part) => {
        const prefix = this.detectPrefix(part.text);
        const commands = KMDCommandParser.parseEffectChain(part.text).map((command) => {
          const enriched: ParsedCommand = attachCommandFamily({
            ...command,
            raw: part.text,
            prefix,
          }, registryView);
          if (enriched.family === "unknown") {
            diagnostics.push({
              severity: "warning",
              message: `Unknown command "${enriched.name}"`,
              line,
              range: { start: offset + part.start, end: offset + part.end },
              code: "unknown-command",
            });
          }
          return enriched;
        });

        return {
          type: "command-chain",
          prefix,
          raw: part.text,
          commands,
          line,
          range: { start: offset + part.start, end: offset + part.end },
        };
      });
  }

  private parseInline(
    input: string,
    line: number,
    state: InlineParseState,
    diagnostics: ParserDiagnostic[],
    stopChar?: string,
    activeGroupId?: number,
  ): InlineNodeAst[] {
    // Recursive inline parser shared by top-level body text and brace groups.
    // It preserves marks, group identity, and source ranges; semantic routing happens later in lowering.ts.
    const nodes: InlineNodeAst[] = [];
    let textBuffer = "";
    let textStart = state.pos;

    const flushText = () => {
      if (!textBuffer) return;
      const node: TextNodeAst = {
        type: "text",
        text: textBuffer,
        marks: Array.from(state.marks),
        groupId: activeGroupId,
        line,
        range: { start: textStart, end: state.pos },
      };
      nodes.push(node);
      textBuffer = "";
      textStart = state.pos;
    };

    while (state.pos < input.length) {
      const char = input[state.pos]!;
      if (stopChar && char === stopChar) {
        break;
      }

      if (char === "\\") {
        state.pos++;
        if (state.pos < input.length) {
          textBuffer += input[state.pos];
          state.pos++;
        }
        continue;
      }

      if (char === "*" && input[state.pos + 1] === "*") {
        flushText();
        if (state.marks.has("bold")) state.marks.delete("bold");
        else state.marks.add("bold");
        state.pos += 2;
        textStart = state.pos;
        continue;
      }

      if (char === "*" && !state.marks.has("bold")) {
        flushText();
        if (state.marks.has("italic")) state.marks.delete("italic");
        else state.marks.add("italic");
        state.pos += 1;
        textStart = state.pos;
        continue;
      }

      if (char === "{") {
        flushText();
        const groupStart = state.pos;
        state.pos++;
        const groupId = ++this.braceIdCounter;
        const children = this.parseInline(input, line, state, diagnostics, "}", groupId);
        if (state.pos < input.length && input[state.pos] === "}") {
          state.pos++;
        } else {
          diagnostics.push({
            severity: "warning",
            message: "Unclosed brace group",
            line,
            range: { start: groupStart, end: state.pos },
            code: "unclosed-group",
          });
        }
        nodes.push({
          type: "group",
          groupId,
          children,
          line,
          range: { start: groupStart, end: state.pos },
        });
        textStart = state.pos;
        continue;
      }

      if (char === "|") {
        flushText();
        const start = state.pos;
        state.pos++;
        let params = "";
        if (input[state.pos] === "(") {
          state.pos++;
          while (state.pos < input.length && input[state.pos] !== ")" && (!stopChar || input[state.pos] !== stopChar)) {
            params += input[state.pos];
            state.pos++;
          }
          if (input[state.pos] === ")") state.pos++;
        }
        const node: PauseNodeAst = {
          type: "pause",
          params: KMDCommandParser.parseParams(params || "0.5s"),
          groupId: activeGroupId,
          line,
          range: { start, end: state.pos },
        };
        nodes.push(node);
        textStart = state.pos;
        continue;
      }

      if (char === ">" || char === "~" || char === "^") {
        flushText();
        const start = state.pos;
        const node = this.parseSugar(input, line, state, activeGroupId);
        nodes.push(node);
        textStart = state.pos;
        if (node.range.start === start && node.range.end === start) {
          state.pos++;
        }
        continue;
      }

      textBuffer += char;
      state.pos++;
    }

    flushText();
    return nodes;
  }

  private parseSugar(
    input: string,
    line: number,
    state: InlineParseState,
    groupId?: number,
  ): SugarNodeAst {
    const start = state.pos;
    const char = input[state.pos]!;
    if (char === ">") {
      let count = 0;
      while (state.pos < input.length && input[state.pos] === ">") {
        count++;
        state.pos++;
      }
      return {
        type: "sugar",
        name: "go",
        level: count >= 3 ? "block" : count === 2 ? "group" : "char",
        params: {},
        groupId,
        line,
        range: { start, end: state.pos },
      };
    }

    state.pos++;
    return {
      type: "sugar",
      name: char === "~" ? "slow" : "fast",
      level: "char",
      params: {},
      groupId,
      line,
      range: { start, end: state.pos },
    };
  }

  private splitTopLevel(input: string): Array<{ text: string; start: number; end: number }> {
    const parts: Array<{ text: string; start: number; end: number }> = [];
    let current = "";
    let depth = 0;
    let start = 0;

    for (let idx = 0; idx < input.length; idx++) {
      const char = input[idx]!;
      if (char === "(") depth++;
      else if (char === ")") depth = Math.max(0, depth - 1);

      if (char === " " && depth === 0) {
        const trimmed = current.trim();
        if (trimmed) {
          const leading = current.indexOf(trimmed);
          parts.push({
            text: trimmed,
            start: start + Math.max(leading, 0),
            end: idx,
          });
        }
        current = "";
        start = idx + 1;
      } else {
        current += char;
      }
    }

    const trimmed = current.trim();
    if (trimmed) {
      const leading = current.indexOf(trimmed);
      parts.push({
        text: trimmed,
        start: start + Math.max(leading, 0),
        end: input.length,
      });
    }

    return parts;
  }

  private stripComment(line: string): string {
    const commentIdx = line.indexOf("//");
    if (commentIdx !== -1 && (commentIdx === 0 || line[commentIdx - 1] === " ")) {
      return line.substring(0, commentIdx).trimEnd();
    }
    return line;
  }

  private isPureCommentLine(originalLine: string, strippedLine: string): boolean {
    return strippedLine.length === 0 && originalLine.trimStart().startsWith("//");
  }

  private findAtSymbol(line: string): number {
    let depth = 0;
    for (let idx = 0; idx < line.length; idx++) {
      const char = line[idx]!;
      if (char === "\\") {
        idx++;
        continue;
      }
      if (char === "{") depth++;
      else if (char === "}") depth = Math.max(0, depth - 1);
      else if (char === "@" && depth === 0) return idx;
    }
    return -1;
  }

  private detectPrefix(text: string): CommandPrefix {
    if (text.startsWith("f.")) return "f";
    if (text.startsWith(".")) return "dot";
    return "bare";
  }
}
