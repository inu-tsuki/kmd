import { parseChainSyntax } from "../chainSyntax/ChainSyntaxParser";
import { parseLiteral } from "../chainSyntax/LiteralParser";
import type { ChainDiagnostic } from "../chainSyntax/types";
import { scanContent } from "../content/ContentScanner";
import type { ContentDiagnostic } from "../content/types";
import { parseExpression } from "../expression/ExpressionParser";
import type { ExpressionDiagnostic } from "../expression/types";
import type {
  BracketOpenerAst,
  DocumentAnchorContentLine,
  DocumentAst,
  DocumentBracketLine,
  DocumentCommandAst,
  DocumentContentLine,
  DocumentDiagnostic,
  DocumentInteractiveLine,
  DocumentInteractiveOutcomeAst,
  DocumentLineAst,
  DocumentRenderableLine,
  DocumentRoutingAst,
  DocumentRoutingBranchAst,
  DocumentSourceLine,
  FenceAst,
  ParagraphAst,
  ParagraphPresenceAst,
  SceneAst,
} from "./types";

interface FenceDraft {
  id: string;
  name: string;
  sceneIndex: number;
  depth: number;
  parentFenceId: string | null;
  openRange: { start: number; end: number };
  contentStart: number;
  coveredLineRanges: Array<{ start: number; end: number }>;
}

interface ParagraphDraft {
  prefixLines: DocumentBracketLine[];
  bodyLines: DocumentRenderableLine[];
}

interface SceneDraft {
  index: number;
  start: number;
  lines: DocumentLineAst[];
  fences: FenceAst[];
  paragraphs: ParagraphAst[];
  paragraph: ParagraphDraft;
}

interface SlicePart {
  text: string;
  start: number;
  end: number;
}

const IDENTIFIER = /^[A-Za-z_\p{L}][A-Za-z0-9_\-\p{L}\p{N}]*$/u;

/**
 * B2 文档结构入口。该解析器拥有 frontmatter、场景、围栏、锚点、块前缀和段落切分，
 * 正文及链句交给 ContentScanner 与 ChainSyntaxParser，避免结构层重新解释内容语法。
 */
export class DocumentParser {
  public parse(source: string): DocumentAst {
    const sourceLines = splitSourceLines(source);
    const diagnostics: DocumentDiagnostic[] = [];
    const contentDiagnostics: ContentDiagnostic[] = [];
    const expressionDiagnostics: ExpressionDiagnostic[] = [];
    const chainDiagnostics: ChainDiagnostic[] = [];
    const lines: DocumentLineAst[] = [];
    const scenes: SceneAst[] = [];
    const frontmatter = frontmatterInterval(sourceLines);
    const bodyStartIndex = frontmatter?.endLineIndex === undefined
      ? 0
      : frontmatter.endLineIndex + 1;

    for (let index = 0; index < bodyStartIndex; index += 1) {
      const line = sourceLines[index]!;
      lines.push({ ...line, type: "frontmatter-line" });
    }

    const emptyParagraph = (): ParagraphDraft => ({ prefixLines: [], bodyLines: [] });
    let scene: SceneDraft = {
      index: 0,
      start: sourceLines[bodyStartIndex]?.range.start ?? source.length,
      lines: [],
      fences: [],
      paragraphs: [],
      paragraph: emptyParagraph(),
    };
    const fenceStack: FenceDraft[] = [];
    let fenceSequence = 0;

    const finalizeFence = (
      draft: FenceDraft,
      contentEnd: number,
      closeRange: { start: number; end: number } | null,
    ): FenceAst => ({
      type: "fence",
      id: draft.id,
      name: draft.name,
      sceneIndex: draft.sceneIndex,
      depth: draft.depth,
      parentFenceId: draft.parentFenceId,
      openRange: { ...draft.openRange },
      closeRange: closeRange === null ? null : { ...closeRange },
      contentRange: { start: draft.contentStart, end: contentEnd },
      coveredLineRanges: draft.coveredLineRanges.map((range) => ({ ...range })),
      closed: closeRange !== null,
    });

    const resetParagraph = (): void => {
      scene.paragraph = emptyParagraph();
    };

    const reportDanglingPrefixes = (): void => {
      for (const prefix of scene.paragraph.prefixLines) {
        diagnostics.push({
          code: "document-dangling-paragraph-prefix",
          severity: "error",
          message: "Paragraph prefix must be immediately followed by paragraph content.",
          range: { ...prefix.range },
        });
      }
    };

    const finalizeParagraph = (): void => {
      const draft = scene.paragraph;
      if (draft.bodyLines.length === 0) {
        if (draft.prefixLines.length > 0) reportDanglingPrefixes();
        resetParagraph();
        return;
      }
      const first = draft.prefixLines[0] ?? draft.bodyLines[0]!;
      const last = draft.bodyLines.at(-1)!;
      const paragraph: ParagraphAst = {
        type: "paragraph",
        id: `paragraph:${scene.index}:${scene.paragraphs.length}:${first.range.start}`,
        sceneIndex: scene.index,
        index: scene.paragraphs.length,
        range: { start: first.range.start, end: last.range.end },
        prefixLines: [...draft.prefixLines],
        bodyLines: [...draft.bodyLines],
        options: draft.prefixLines.flatMap((line) => line.options.map((entry) => ({
          ...entry,
          range: { ...entry.range },
        }))),
        presence: draft.prefixLines.flatMap((line) => line.presence === null
          ? []
          : [clonePresence(line.presence)]),
        openers: draft.prefixLines.flatMap((line) => line.opener === null
          ? []
          : [cloneOpener(line.opener)]),
      };
      scene.paragraphs.push(paragraph);
      resetParagraph();
    };

    const closeOpenFencesAtSceneEnd = (boundaryStart: number): void => {
      while (fenceStack.length > 0) {
        const draft = fenceStack.pop()!;
        diagnostics.push({
          code: "document-fence-crosses-scene",
          severity: "error",
          message: `Fence "${draft.name}" must close before the scene boundary.`,
          range: { ...draft.openRange },
        });
        scene.fences.push(finalizeFence(draft, boundaryStart, null));
      }
    };

    const finalizeScene = (end: number): void => {
      finalizeParagraph();
      scene.fences.sort((left, right) => (
        left.openRange.start - right.openRange.start || left.depth - right.depth
      ));
      scenes.push({
        type: "scene",
        id: `scene:${scene.index}:${scene.start}`,
        index: scene.index,
        range: { start: scene.start, end },
        lines: scene.lines,
        fences: scene.fences,
        paragraphs: scene.paragraphs,
      });
    };

    const activeFenceIds = (): string[] => fenceStack.map((fence) => fence.id);
    const coverByActiveFences = (line: DocumentSourceLine): void => {
      for (const fence of fenceStack) fence.coveredLineRanges.push({ ...line.range });
    };
    const appendLine = (line: DocumentLineAst): void => {
      scene.lines.push(line);
      lines.push(line);
    };
    const endParagraphBeforeStructure = (): void => {
      finalizeParagraph();
    };

    for (let index = bodyStartIndex; index < sourceLines.length; index += 1) {
      const line = sourceLines[index]!;
      const trimmed = line.raw.trim();

      if (trimmed === "---") {
        endParagraphBeforeStructure();
        closeOpenFencesAtSceneEnd(line.range.start);
        // 场景分隔行位于两个场景之间，只进入文档行表，避免任一 SceneAst 错误持有边界。
        lines.push({ ...line, type: "scene-boundary-line" });
        finalizeScene(line.range.start);
        scene = {
          index: scene.index + 1,
          start: line.fullRange.end,
          lines: [],
          fences: [],
          paragraphs: [],
          paragraph: emptyParagraph(),
        };
        continue;
      }

      if (trimmed === ":::") {
        endParagraphBeforeStructure();
        const draft = fenceStack.pop() ?? null;
        if (draft === null) {
          diagnostics.push({
            code: "document-stray-fence-close",
            severity: "error",
            message: "Fence close has no matching open fence in this scene.",
            range: { ...line.range },
          });
        } else {
          scene.fences.push(finalizeFence(draft, line.range.start, line.range));
        }
        appendLine({
          ...line,
          type: "fence-close-line",
          fenceId: draft?.id ?? null,
          depth: fenceStack.length,
        });
        continue;
      }

      if (trimmed.startsWith(":::")) {
        endParagraphBeforeStructure();
        const name = trimmed.slice(3).trim();
        if (!IDENTIFIER.test(name)) {
          diagnostics.push({
            code: "document-invalid-fence-line",
            severity: "error",
            message: "Fence open line must contain exactly one valid name after ':::'.",
            range: { ...line.range },
          });
          appendLine({ ...line, type: "fence-error-line" });
          continue;
        }

        const id = `fence:${scene.index}:${fenceSequence}:${line.range.start}`;
        fenceSequence += 1;
        const draft: FenceDraft = {
          id,
          name,
          sceneIndex: scene.index,
          depth: fenceStack.length,
          parentFenceId: fenceStack.at(-1)?.id ?? null,
          openRange: { ...line.range },
          contentStart: line.fullRange.end,
          coveredLineRanges: [],
        };
        fenceStack.push(draft);
        appendLine({
          ...line,
          type: "fence-open-line",
          fenceId: id,
          name,
          depth: draft.depth,
        });
        continue;
      }

      if (trimmed.startsWith("//")) {
        // Comment-only lines stay in the document line table for source
        // navigation, but they neither render nor split the surrounding
        // paragraph. Fence coverage also excludes them from text selectors.
        appendLine({
          ...line,
          type: "comment-line",
          activeFenceIds: activeFenceIds(),
        });
        continue;
      }

      if (trimmed.length === 0) {
        coverByActiveFences(line);
        appendLine({ ...line, type: "blank-line", activeFenceIds: activeFenceIds() });
        finalizeParagraph();
        continue;
      }

      if (trimmed.startsWith("#")) {
        coverByActiveFences(line);
        const anchor = parseAnchorLine(
          line,
          activeFenceIds(),
          diagnostics,
          contentDiagnostics,
          expressionDiagnostics,
          chainDiagnostics,
        );
        if (anchor === null) {
          endParagraphBeforeStructure();
          appendLine({
            ...line,
            type: "structure-error-line",
            family: "anchor",
            activeFenceIds: activeFenceIds(),
          });
          continue;
        }
        if (anchor.type === "anchor-line") {
          endParagraphBeforeStructure();
          appendLine(anchor);
          continue;
        }
        if (scene.paragraph.bodyLines.length > 0) finalizeParagraph();
        appendLine(anchor);
        scene.paragraph.bodyLines.push(anchor);
        continue;
      }

      if (trimmed.startsWith("->")) {
        coverByActiveFences(line);
        endParagraphBeforeStructure();
        const goto = parseGotoLine(line, activeFenceIds(), diagnostics);
        appendLine(goto ?? {
          ...line,
          type: "structure-error-line",
          family: "goto",
          activeFenceIds: activeFenceIds(),
        });
        continue;
      }

      if (trimmed.startsWith("[")) {
        coverByActiveFences(line);
        if (isInteractiveBracketCandidate(trimmed)) {
          endParagraphBeforeStructure();
          const interactive = parseInteractiveLine(
            line,
            activeFenceIds(),
            diagnostics,
          );
          appendLine(interactive ?? {
            ...line,
            type: "structure-error-line",
            family: "interactive",
            activeFenceIds: activeFenceIds(),
          });
          continue;
        }
        if (scene.paragraph.bodyLines.length > 0) finalizeParagraph();
        const bracket = parseBracketLine(
          line,
          activeFenceIds(),
          diagnostics,
          expressionDiagnostics,
          chainDiagnostics,
        );
        if (bracket === null) {
          endParagraphBeforeStructure();
          appendLine({
            ...line,
            type: "structure-error-line",
            family: "bracket",
            activeFenceIds: activeFenceIds(),
          });
          continue;
        }
        appendLine(bracket);
        if (bracket.slot === "routing") {
          endParagraphBeforeStructure();
        } else {
          scene.paragraph.prefixLines.push(bracket);
        }
        continue;
      }

      coverByActiveFences(line);
      const content = parseContentLine(
        line,
        activeFenceIds(),
        contentDiagnostics,
        expressionDiagnostics,
        chainDiagnostics,
      );
      appendLine(content);
      scene.paragraph.bodyLines.push(content);
    }

    while (fenceStack.length > 0) {
      const draft = fenceStack.pop()!;
      diagnostics.push({
        code: "document-unclosed-fence",
        severity: "error",
        message: `Fence "${draft.name}" is missing its closing ':::'.`,
        range: { ...draft.openRange },
      });
      scene.fences.push(finalizeFence(draft, source.length, null));
    }
    finalizeScene(source.length);

    return {
      type: "document",
      raw: source,
      range: { start: 0, end: source.length },
      frontmatterRange: frontmatter === null
        ? null
        : {
            start: sourceLines[frontmatter.startLineIndex]!.range.start,
            end: sourceLines[frontmatter.endLineIndex]!.fullRange.end,
          },
      scenes,
      lines,
      diagnostics,
      contentDiagnostics,
      expressionDiagnostics,
      chainDiagnostics,
    };
  }
}

export function parseDocumentStructure(source: string): DocumentAst {
  return new DocumentParser().parse(source);
}

function parseAnchorLine(
  line: DocumentSourceLine,
  fenceIds: string[],
  diagnostics: DocumentDiagnostic[],
  contentDiagnostics: ContentDiagnostic[],
  expressionDiagnostics: ExpressionDiagnostic[],
  chainDiagnostics: ChainDiagnostic[],
): Extract<DocumentLineAst, { type: "anchor-line" | "anchor-content-line" }> | null {
  const leading = line.raw.search(/\S/u);
  const trimmed = line.raw.trim();
  if (/^#{2,6}(?:\s|$)/u.test(trimmed)) {
    diagnostics.push({
      code: "document-heading-level-not-supported",
      severity: "error",
      message: "Heading levels '##' through '######' are not part of the Phase B anchor grammar.",
      range: { ...line.range },
    });
    return null;
  }
  const match = /^#\s+(.+)$/u.exec(trimmed);
  if (match === null) {
    diagnostics.push({
      code: "document-invalid-anchor-line",
      severity: "error",
      message: "Anchor line must use '# name' or '# name @ chain'.",
      range: { ...line.range },
    });
    return null;
  }

  const rest = match[1]!;
  const at = findTopLevelCharacter(rest, "@");
  const namePart = (at < 0 ? rest : rest.slice(0, at)).trim();
  if (!IDENTIFIER.test(namePart)) {
    diagnostics.push({
      code: "document-invalid-anchor-line",
      severity: "error",
      message: "Anchor name must be one identifier without whitespace.",
      range: { ...line.range },
    });
    return null;
  }
  const nameIndex = line.raw.indexOf(namePart, Math.max(0, leading));
  const nameRange = {
    start: line.range.start + nameIndex,
    end: line.range.start + nameIndex + namePart.length,
  };
  if (at < 0) {
    return {
      ...line,
      type: "anchor-line",
      activeFenceIds: [...fenceIds],
      name: namePart,
      nameRange,
    };
  }

  const scan = scanContent(namePart, nameRange.start);
  contentDiagnostics.push(...scan.diagnostics);
  expressionDiagnostics.push(...scan.expressionDiagnostics);
  const atInLine = line.raw.indexOf("@", nameIndex + namePart.length);
  const command = parseCommand(line, atInLine, chainDiagnostics);
  const anchor: DocumentAnchorContentLine = {
    ...line,
    type: "anchor-content-line",
    activeFenceIds: [...fenceIds],
    name: namePart,
    nameRange,
    body: namePart,
    bodyRange: { ...nameRange },
    inline: scan.nodes,
    command,
  };
  return anchor;
}

function parseGotoLine(
  line: DocumentSourceLine,
  fenceIds: string[],
  diagnostics: DocumentDiagnostic[],
): Extract<DocumentLineAst, { type: "goto-line" }> | null {
  const trimmed = line.raw.trim();
  const match = /^->\s+#([^\s]+)$/u.exec(trimmed);
  const target = match?.[1] ?? "";
  if (!IDENTIFIER.test(target)) {
    diagnostics.push({
      code: "document-invalid-goto-line",
      severity: "error",
      message: "Goto line must contain exactly one valid '#name' target.",
      range: { ...line.range },
    });
    return null;
  }
  const targetIndex = line.raw.lastIndexOf(target);
  return {
    ...line,
    type: "goto-line",
    activeFenceIds: [...fenceIds],
    target,
    targetRange: {
      start: line.range.start + targetIndex,
      end: line.range.start + targetIndex + target.length,
    },
  };
}

function isInteractiveBracketCandidate(source: string): boolean {
  if (!source.startsWith("[")) return false;
  const inner = source.slice(1).trimStart();
  return /^game(?:\s|\()/u.test(inner);
}

function parseInteractiveLine(
  line: DocumentSourceLine,
  fenceIds: string[],
  diagnostics: DocumentDiagnostic[],
): DocumentInteractiveLine | null {
  const trimmed = line.raw.trim();
  if (!trimmed.endsWith("]") || findMatchingBracket(trimmed) !== trimmed.length - 1) {
    diagnostics.push({
      code: "document-invalid-interactive-line",
      severity: "error",
      message: "Interactive line must contain one complete '[game(...)]' payload and no trailing text.",
      range: { ...line.range },
    });
    return null;
  }

  const innerRaw = trimmed.slice(1, -1);
  const inner = trimSlice(innerRaw, 0, innerRaw.length);
  const trimmedStart = line.raw.indexOf(trimmed);
  const innerBase = line.range.start + trimmedStart + 1;
  const payloadBase = innerBase + inner.start;
  const head = /^game\s*\(/u.exec(inner.text);
  if (head === null) {
    diagnostics.push(invalidInteractiveLine(inner, payloadBase));
    return null;
  }

  const openParen = head[0].lastIndexOf("(");
  const closeParen = findMatchingParen(inner.text, openParen);
  if (closeParen < 0) {
    diagnostics.push(invalidInteractiveLine(inner, payloadBase));
    return null;
  }
  if (closeParen + 1 < inner.text.length && !/\s/u.test(inner.text[closeParen + 1]!)) {
    diagnostics.push(invalidInteractiveLine(inner, payloadBase));
    return null;
  }

  const moduleSlice = trimSlice(inner.text, openParen + 1, closeParen);
  const moduleLiteral = parseLiteral(moduleSlice.text, payloadBase + moduleSlice.start);
  if (
    moduleLiteral.diagnostics.length > 0
    || moduleLiteral.value.type !== "string-literal"
    || !IDENTIFIER.test(moduleLiteral.value.value)
  ) {
    diagnostics.push({
      code: "document-invalid-interactive-line",
      severity: "error",
      message: "game() requires one quoted logical module identifier.",
      range: {
        start: payloadBase + moduleSlice.start,
        end: payloadBase + moduleSlice.end,
      },
    });
    return null;
  }

  const outcomeSource = trimSlice(inner.text, closeParen + 1, inner.text.length);
  if (outcomeSource.text.length === 0) {
    diagnostics.push({
      code: "document-invalid-interactive-line",
      severity: "error",
      message: "Interactive line requires at least one outcome branch.",
      range: { start: payloadBase, end: payloadBase + inner.text.length },
    });
    return null;
  }

  const outcomes = parseInteractiveOutcomes(
    outcomeSource.text,
    payloadBase + outcomeSource.start,
    diagnostics,
  );
  if (fenceIds.length > 0 || hasInteractiveMixedStructure(outcomeSource.text)) {
    diagnostics.push({
      code: "interactive-mixed-structure",
      severity: "error",
      message: "Interactive lines cannot mix selection fences, routing conditions, paragraph options, or opener sentences in C2 v1.",
      range: { ...line.range },
    });
  }

  return {
    ...line,
    type: "interactive-line",
    activeFenceIds: [...fenceIds],
    moduleId: moduleLiteral.value.value,
    moduleIdRange: { ...moduleLiteral.value.range },
    outcomes,
  };
}

function parseInteractiveOutcomes(
  source: string,
  baseOffset: number,
  diagnostics: DocumentDiagnostic[],
): DocumentInteractiveOutcomeAst[] {
  const parts = splitTopLevel(source, "|");
  const outcomes: DocumentInteractiveOutcomeAst[] = [];
  const seen = new Map<string, { start: number; end: number }>();
  let fallbackRange: { start: number; end: number } | null = null;

  for (const [index, part] of parts.entries()) {
    const arrow = findTopLevelArrow(part.text);
    if (arrow < 0) {
      diagnostics.push(invalidInteractiveBranch(part, baseOffset));
      continue;
    }
    const left = trimSlice(part.text, 0, arrow);
    const right = trimSlice(part.text, arrow + 2, part.text.length);
    const targetMatch = /^#([^\s]+)$/u.exec(right.text);
    const target = targetMatch?.[1] ?? "";
    if (!IDENTIFIER.test(target)) {
      diagnostics.push(invalidInteractiveBranch(part, baseOffset));
      continue;
    }

    const branchRange = { start: baseOffset + part.start, end: baseOffset + part.end };
    const leftRange = {
      start: baseOffset + part.start + left.start,
      end: baseOffset + part.start + left.end,
    };
    const rightHash = right.text.indexOf("#");
    const targetStart = baseOffset + part.start + right.start + rightHash + 1;

    if (left.text === "else") {
      if (fallbackRange !== null) {
        diagnostics.push({
          code: "interactive-duplicate-fallback",
          severity: "error",
          message: "Interactive line can contain at most one else fallback.",
          range: leftRange,
        });
      } else {
        fallbackRange = leftRange;
      }
      if (index !== parts.length - 1) diagnostics.push(invalidInteractiveBranch(part, baseOffset));
      outcomes.push({
        kind: "else",
        raw: part.text,
        range: branchRange,
        outcome: null,
        outcomeRange: null,
        target,
        targetRange: { start: targetStart, end: targetStart + target.length },
      });
      continue;
    }

    if (!IDENTIFIER.test(left.text)) {
      diagnostics.push(invalidInteractiveBranch(part, baseOffset));
      continue;
    }
    if (seen.has(left.text)) {
      diagnostics.push({
        code: "interactive-duplicate-outcome",
        severity: "error",
        message: `Interactive outcome "${left.text}" is declared more than once.`,
        range: leftRange,
      });
    } else {
      seen.set(left.text, leftRange);
    }
    outcomes.push({
      kind: "outcome",
      raw: part.text,
      range: branchRange,
      outcome: left.text,
      outcomeRange: leftRange,
      target,
      targetRange: { start: targetStart, end: targetStart + target.length },
    });
  }
  return outcomes;
}

function hasInteractiveMixedStructure(source: string): boolean {
  return splitTopLevel(source, "|").some((part) => {
    if (topLevelEqualsIndex(part.text) >= 0 || part.text.includes("@")) return true;
    const arrow = findTopLevelArrow(part.text);
    if (arrow < 0) return false;
    const left = trimSlice(part.text, 0, arrow).text;
    if (/^(?:if|else\s+if)(?:\s|$)/u.test(left)) return true;
    return left !== "else" && splitTopLevelWhitespace(left).length > 1;
  });
}

function invalidInteractiveLine(part: SlicePart, baseOffset: number): DocumentDiagnostic {
  return {
    code: "document-invalid-interactive-line",
    severity: "error",
    message: "Interactive line must use 'game(\"module-id\") outcome -> #target | else -> #target'.",
    range: { start: baseOffset + part.start, end: baseOffset + part.end },
  };
}

function invalidInteractiveBranch(part: SlicePart, baseOffset: number): DocumentDiagnostic {
  return {
    code: "document-invalid-interactive-branch",
    severity: "error",
    message: "Interactive branch must use 'outcome -> #target' or a final 'else -> #target'.",
    range: { start: baseOffset + part.start, end: baseOffset + part.end },
  };
}

function parseBracketLine(
  line: DocumentSourceLine,
  fenceIds: string[],
  diagnostics: DocumentDiagnostic[],
  expressionDiagnostics: ExpressionDiagnostic[],
  chainDiagnostics: ChainDiagnostic[],
): DocumentBracketLine | null {
  const trimmed = line.raw.trim();
  if (!trimmed.endsWith("]") || findMatchingBracket(trimmed) !== trimmed.length - 1) {
    diagnostics.push({
      code: "document-invalid-bracket-line",
      severity: "error",
      message: "Bracket structure line must contain one complete '[...]' payload and no trailing text.",
      range: { ...line.range },
    });
    return null;
  }
  const innerRaw = trimmed.slice(1, -1);
  const inner = trimSlice(innerRaw, 0, innerRaw.length);
  if (inner.text.length === 0) {
    diagnostics.push({
      code: "document-invalid-bracket-line",
      severity: "error",
      message: "Bracket structure line cannot be empty.",
      range: { ...line.range },
    });
    return null;
  }
  const trimmedStart = line.raw.indexOf(trimmed);
  const innerBase = line.range.start + trimmedStart + 1;
  const payloadBase = innerBase + inner.start;

  if (findTopLevelArrow(inner.text) >= 0) {
    const optionLike = splitTopLevelWhitespace(inner.text).some((part) => (
      topLevelEqualsIndex(part.text) >= 0
    ));
    if (optionLike) {
      diagnostics.push({
        code: "document-routing-mixed-slot",
        severity: "error",
        message: "Routing bracket line cannot contain paragraph options or an opener sentence.",
        range: { start: payloadBase, end: payloadBase + inner.text.length },
      });
    }
    const routing = parseRouting(inner.text, payloadBase, diagnostics, expressionDiagnostics);
    return {
      ...line,
      type: "bracket-line",
      activeFenceIds: [...fenceIds],
      slot: "routing",
      options: [],
      presence: null,
      opener: null,
      routing,
    };
  }

  if (/^if(?:\s|$)/u.test(inner.text)) {
    const expressionPart = trimSlice(inner.text, 2, inner.text.length);
    const parsed = parseExpression(expressionPart.text, payloadBase + expressionPart.start);
    expressionDiagnostics.push(...parsed.diagnostics);
    const presence: ParagraphPresenceAst = {
      raw: expressionPart.text,
      range: {
        start: payloadBase + expressionPart.start,
        end: payloadBase + expressionPart.end,
      },
      expression: parsed.expression,
      diagnostics: parsed.diagnostics,
    };
    return {
      ...line,
      type: "bracket-line",
      activeFenceIds: [...fenceIds],
      slot: "paragraph-prefix",
      options: [],
      presence,
      opener: null,
      routing: null,
    };
  }

  const parts = splitTopLevelWhitespace(inner.text);
  const options: DocumentBracketLine["options"] = [];
  let openerStart = inner.text.length;
  for (const part of parts) {
    const equals = topLevelEqualsIndex(part.text);
    if (equals < 0) {
      openerStart = part.start;
      break;
    }
    const key = part.text.slice(0, equals).trim();
    const rawValue = part.text.slice(equals + 1).trim();
    if (!IDENTIFIER.test(key) || rawValue.length === 0) {
      diagnostics.push({
        code: "document-invalid-bracket-line",
        severity: "error",
        message: "Paragraph option must use a valid 'key=value' entry.",
        range: { start: payloadBase + part.start, end: payloadBase + part.end },
      });
      continue;
    }
    options.push({
      key,
      value: parseOptionValue(rawValue),
      range: { start: payloadBase + part.start, end: payloadBase + part.end },
    });
  }

  let opener: BracketOpenerAst | null = null;
  if (openerStart < inner.text.length) {
    const openerPart = trimSlice(inner.text, openerStart, inner.text.length);
    const parsed = parseChainSyntax(openerPart.text, payloadBase + openerPart.start);
    chainDiagnostics.push(...parsed.diagnostics);
    opener = {
      raw: openerPart.text,
      range: {
        start: payloadBase + openerPart.start,
        end: payloadBase + openerPart.end,
      },
      expression: parsed.expression,
      diagnostics: parsed.diagnostics,
    };
  }
  if (options.length === 0 && opener === null) {
    diagnostics.push({
      code: "document-invalid-bracket-line",
      severity: "error",
      message: "Bracket line requires a paragraph option, a presence condition, or an opener sentence.",
      range: { ...line.range },
    });
    return null;
  }
  return {
    ...line,
    type: "bracket-line",
    activeFenceIds: [...fenceIds],
    slot: "paragraph-prefix",
    options,
    presence: null,
    opener,
    routing: null,
  };
}

function parseRouting(
  source: string,
  baseOffset: number,
  diagnostics: DocumentDiagnostic[],
  expressionDiagnostics: ExpressionDiagnostic[],
): DocumentRoutingAst {
  const parts = splitTopLevel(source, "|");
  const branches: DocumentRoutingBranchAst[] = [];
  for (const [index, part] of parts.entries()) {
    const arrow = findTopLevelArrow(part.text);
    if (arrow < 0) {
      diagnostics.push(invalidRouting(part, baseOffset));
      continue;
    }
    const left = trimSlice(part.text, 0, arrow);
    const right = trimSlice(part.text, arrow + 2, part.text.length);
    const targetMatch = /^#([^\s]+)$/u.exec(right.text);
    const target = targetMatch?.[1] ?? "";
    if (!IDENTIFIER.test(target)) {
      diagnostics.push(invalidRouting(part, baseOffset));
      continue;
    }
    const rightHash = right.text.indexOf("#");
    const targetLocalStart = part.start + right.start + rightHash + 1;
    const branchBase = baseOffset + part.start;

    if (left.text === "else") {
      if (index !== parts.length - 1) diagnostics.push(invalidRouting(part, baseOffset));
      branches.push({
        kind: "else",
        raw: part.text,
        range: { start: branchBase, end: baseOffset + part.end },
        condition: null,
        conditionDiagnostics: [],
        target,
        targetRange: {
          start: baseOffset + targetLocalStart,
          end: baseOffset + targetLocalStart + target.length,
        },
      });
      continue;
    }

    const conditionPrefix = left.text.startsWith("else if ")
      ? "else if ".length
      : left.text.startsWith("if ")
        ? "if ".length
        : -1;
    if (conditionPrefix < 0) {
      diagnostics.push(invalidRouting(part, baseOffset));
      continue;
    }
    const conditionPart = trimSlice(left.text, conditionPrefix, left.text.length);
    const conditionOffset = branchBase + left.start + conditionPart.start;
    const parsed = parseExpression(conditionPart.text, conditionOffset);
    expressionDiagnostics.push(...parsed.diagnostics);
    branches.push({
      kind: "condition",
      raw: part.text,
      range: { start: branchBase, end: baseOffset + part.end },
      condition: parsed.expression,
      conditionDiagnostics: parsed.diagnostics,
      target,
      targetRange: {
        start: baseOffset + targetLocalStart,
        end: baseOffset + targetLocalStart + target.length,
      },
    });
  }
  return {
    raw: source,
    range: { start: baseOffset, end: baseOffset + source.length },
    branches,
  };
}

function invalidRouting(part: SlicePart, baseOffset: number): DocumentDiagnostic {
  return {
    code: "document-invalid-routing-branch",
    severity: "error",
    message: "Routing branch must use 'if condition -> #target', 'else if condition -> #target', or 'else -> #target'.",
    range: { start: baseOffset + part.start, end: baseOffset + part.end },
  };
}

function parseContentLine(
  line: DocumentSourceLine,
  fenceIds: string[],
  contentDiagnostics: ContentDiagnostic[],
  expressionDiagnostics: ExpressionDiagnostic[],
  chainDiagnostics: ChainDiagnostic[],
): DocumentContentLine {
  const at = findTopLevelCharacter(line.raw, "@");
  const bodyEnd = at < 0 ? line.raw.trimEnd().length : line.raw.slice(0, at).trimEnd().length;
  const body = line.raw.slice(0, bodyEnd);
  const scan = scanContent(body, line.range.start);
  contentDiagnostics.push(...scan.diagnostics);
  expressionDiagnostics.push(...scan.expressionDiagnostics);
  return {
    ...line,
    type: "content-line",
    activeFenceIds: [...fenceIds],
    body,
    bodyRange: { start: line.range.start, end: line.range.start + bodyEnd },
    inline: scan.nodes,
    command: parseCommand(line, at, chainDiagnostics),
  };
}

function parseCommand(
  line: DocumentSourceLine,
  at: number,
  chainDiagnostics: ChainDiagnostic[],
): DocumentCommandAst | null {
  if (at < 0) return null;
  const slice = trimSlice(line.raw, at + 1, line.raw.length);
  if (slice.text.length === 0) {
    chainDiagnostics.push({
      code: "chain-unexpected-token",
      severity: "error",
      message: "Command delimiter '@' must be followed by a command expression.",
      range: {
        start: line.range.start + at,
        end: line.range.start + at + 1,
      },
    });
    return null;
  }
  const range = {
    start: line.range.start + slice.start,
    end: line.range.start + slice.end,
  };
  const parsed = parseChainSyntax(slice.text, range.start);
  chainDiagnostics.push(...parsed.diagnostics);
  return {
    raw: slice.text,
    range,
    expression: parsed.expression,
    diagnostics: parsed.diagnostics,
  };
}

function clonePresence(presence: ParagraphPresenceAst): ParagraphPresenceAst {
  return {
    ...presence,
    range: { ...presence.range },
    diagnostics: presence.diagnostics.map((entry) => ({ ...entry, range: { ...entry.range } })),
  };
}

function cloneOpener(opener: BracketOpenerAst): BracketOpenerAst {
  return {
    ...opener,
    range: { ...opener.range },
    diagnostics: opener.diagnostics.map((entry) => ({ ...entry, range: { ...entry.range } })),
  };
}

function splitSourceLines(source: string): DocumentSourceLine[] {
  if (source.length === 0) return [];
  const lines: DocumentSourceLine[] = [];
  let position = 0;
  let index = 0;
  while (position < source.length) {
    const lineStart = position;
    while (position < source.length && source[position] !== "\n" && source[position] !== "\r") {
      position += 1;
    }
    const contentEnd = position;
    if (source[position] === "\r" && source[position + 1] === "\n") position += 2;
    else if (position < source.length) position += 1;
    lines.push({
      index,
      raw: source.slice(lineStart, contentEnd),
      range: { start: lineStart, end: contentEnd },
      fullRange: { start: lineStart, end: position },
    });
    index += 1;
  }
  return lines;
}

function frontmatterInterval(lines: readonly DocumentSourceLine[]): {
  startLineIndex: number;
  endLineIndex: number;
} | null {
  if (lines[0]?.raw.trim() !== "---") return null;
  for (let index = 1; index < lines.length; index += 1) {
    if (lines[index]!.raw.trim() === "---") {
      return { startLineIndex: 0, endLineIndex: index };
    }
  }
  return null;
}

function findMatchingBracket(source: string): number {
  let depth = 0;
  let quote: string | null = null;
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index]!;
    if (char === "\\") {
      index += 1;
      continue;
    }
    if (quote !== null) {
      if (char === quote) quote = null;
      continue;
    }
    if (char === "'" || char === '"') quote = char;
    else if (char === "[") depth += 1;
    else if (char === "]") {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return -1;
}

function findMatchingParen(source: string, openIndex: number): number {
  let depth = 0;
  let quote: string | null = null;
  for (let index = openIndex; index < source.length; index += 1) {
    const char = source[index]!;
    if (char === "\\") {
      index += 1;
      continue;
    }
    if (quote !== null) {
      if (char === quote) quote = null;
      continue;
    }
    if (char === "'" || char === '"') quote = char;
    else if (char === "(") depth += 1;
    else if (char === ")") {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return -1;
}

function findTopLevelArrow(source: string): number {
  let parenDepth = 0;
  let quote: string | null = null;
  for (let index = 0; index < source.length - 1; index += 1) {
    const char = source[index]!;
    if (char === "\\") {
      index += 1;
      continue;
    }
    if (quote !== null) {
      if (char === quote) quote = null;
      continue;
    }
    if (char === "'" || char === '"') quote = char;
    else if (char === "(") parenDepth += 1;
    else if (char === ")") parenDepth = Math.max(0, parenDepth - 1);
    else if (char === "-" && source[index + 1] === ">" && parenDepth === 0) return index;
  }
  return -1;
}

function findTopLevelCharacter(source: string, expected: string): number {
  let parenDepth = 0;
  let braceDepth = 0;
  let bracketDepth = 0;
  let quote: string | null = null;
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index]!;
    if (char === "\\") {
      index += 1;
      continue;
    }
    if (quote !== null) {
      if (char === quote) quote = null;
      continue;
    }
    if (char === "'" || char === '"') quote = char;
    else if (char === "(") parenDepth += 1;
    else if (char === ")") parenDepth = Math.max(0, parenDepth - 1);
    else if (char === "{") braceDepth += 1;
    else if (char === "}") braceDepth = Math.max(0, braceDepth - 1);
    else if (char === "[") bracketDepth += 1;
    else if (char === "]") bracketDepth = Math.max(0, bracketDepth - 1);
    else if (char === expected && parenDepth === 0 && braceDepth === 0 && bracketDepth === 0) {
      if (expected === "|" && (source[index - 1] === "|" || source[index + 1] === "|")) continue;
      return index;
    }
  }
  return -1;
}

function splitTopLevel(source: string, separator: string): SlicePart[] {
  const parts: SlicePart[] = [];
  let start = 0;
  while (start <= source.length) {
    const relative = findTopLevelCharacter(source.slice(start), separator);
    const end = relative < 0 ? source.length : start + relative;
    parts.push(trimSlice(source, start, end));
    if (relative < 0) break;
    start = end + 1;
  }
  return parts;
}

function splitTopLevelWhitespace(source: string): SlicePart[] {
  const parts: SlicePart[] = [];
  let start = 0;
  let index = 0;
  let parenDepth = 0;
  let quote: string | null = null;
  while (index < source.length) {
    const char = source[index]!;
    if (char === "\\") {
      index += 2;
      continue;
    }
    if (quote !== null) {
      if (char === quote) quote = null;
      index += 1;
      continue;
    }
    if (char === "'" || char === '"') quote = char;
    else if (char === "(") parenDepth += 1;
    else if (char === ")") parenDepth = Math.max(0, parenDepth - 1);
    else if (/\s/u.test(char) && parenDepth === 0) {
      const part = trimSlice(source, start, index);
      if (part.text.length > 0) parts.push(part);
      while (index < source.length && /\s/u.test(source[index]!)) index += 1;
      start = index;
      continue;
    }
    index += 1;
  }
  const part = trimSlice(source, start, source.length);
  if (part.text.length > 0) parts.push(part);
  return parts;
}

function topLevelEqualsIndex(source: string): number {
  let parenDepth = 0;
  let quote: string | null = null;
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index]!;
    if (char === "\\") {
      index += 1;
      continue;
    }
    if (quote !== null) {
      if (char === quote) quote = null;
      continue;
    }
    if (char === "'" || char === '"') quote = char;
    else if (char === "(") parenDepth += 1;
    else if (char === ")") parenDepth = Math.max(0, parenDepth - 1);
    else if (char === "=" && parenDepth === 0) return index;
  }
  return -1;
}

function trimSlice(source: string, start: number, end: number): SlicePart {
  let trimmedStart = start;
  let trimmedEnd = end;
  while (trimmedStart < trimmedEnd && /\s/u.test(source[trimmedStart]!)) trimmedStart += 1;
  while (trimmedEnd > trimmedStart && /\s/u.test(source[trimmedEnd - 1]!)) trimmedEnd -= 1;
  return { text: source.slice(trimmedStart, trimmedEnd), start: trimmedStart, end: trimmedEnd };
}

function parseOptionValue(source: string): unknown {
  if ((source.startsWith('"') && source.endsWith('"'))
    || (source.startsWith("'") && source.endsWith("'"))) {
    return source.slice(1, -1);
  }
  if (source === "true") return true;
  if (source === "false") return false;
  const numeric = Number(source);
  return Number.isFinite(numeric) && source.length > 0 ? numeric : source;
}
