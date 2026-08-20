import type { SourceRange } from "../../types/diagnostics";
import type { ChainDiagnostic, ChainExpressionAst } from "../chainSyntax/types";
import type { ContentDiagnostic, ContentNodeAst } from "../content/types";
import type { ExpressionAst, ExpressionDiagnostic } from "../expression/types";
import type { OptionPatchEntry } from "../options/types";
import type { ScopeDefinition, ScopeDiagnostic } from "../scope/types";

export type DocumentDiagnosticCode =
  | "document-invalid-fence-line"
  | "document-stray-fence-close"
  | "document-unclosed-fence"
  | "document-fence-crosses-scene"
  | "document-invalid-anchor-line"
  | "document-heading-level-not-supported"
  | "document-invalid-goto-line"
  | "document-invalid-bracket-line"
  | "document-routing-mixed-slot"
  | "document-invalid-routing-branch"
  | "document-invalid-interactive-line"
  | "document-invalid-interactive-branch"
  | "interactive-duplicate-outcome"
  | "interactive-duplicate-fallback"
  | "interactive-mixed-structure"
  | "document-dangling-paragraph-prefix";

export interface DocumentDiagnostic {
  code: DocumentDiagnosticCode;
  severity: "error";
  message: string;
  range: SourceRange;
}

export interface DocumentSourceLine {
  index: number;
  raw: string;
  range: SourceRange;
  fullRange: SourceRange;
}

export interface DocumentCommandAst {
  raw: string;
  range: SourceRange;
  expression: ChainExpressionAst;
  diagnostics: ChainDiagnostic[];
}

export interface DocumentContentLine extends DocumentSourceLine {
  type: "content-line";
  activeFenceIds: string[];
  body: string;
  bodyRange: SourceRange;
  inline: ContentNodeAst[];
  command: DocumentCommandAst | null;
}

export interface DocumentAnchorLine extends DocumentSourceLine {
  type: "anchor-line";
  activeFenceIds: string[];
  name: string;
  nameRange: SourceRange;
}

export interface DocumentAnchorContentLine extends DocumentSourceLine {
  type: "anchor-content-line";
  activeFenceIds: string[];
  name: string;
  nameRange: SourceRange;
  body: string;
  bodyRange: SourceRange;
  inline: ContentNodeAst[];
  command: DocumentCommandAst | null;
}

export interface DocumentBlankLine extends DocumentSourceLine {
  type: "blank-line";
  activeFenceIds: string[];
}

export interface DocumentCommentLine extends DocumentSourceLine {
  type: "comment-line";
  activeFenceIds: string[];
}

export interface DocumentSceneBoundaryLine extends DocumentSourceLine {
  type: "scene-boundary-line";
}

export interface DocumentFenceOpenLine extends DocumentSourceLine {
  type: "fence-open-line";
  fenceId: string;
  name: string;
  depth: number;
}

export interface DocumentFenceCloseLine extends DocumentSourceLine {
  type: "fence-close-line";
  fenceId: string | null;
  depth: number;
}

export interface DocumentFenceErrorLine extends DocumentSourceLine {
  type: "fence-error-line";
}

export interface DocumentStructureErrorLine extends DocumentSourceLine {
  type: "structure-error-line";
  family: "anchor" | "goto" | "bracket" | "interactive";
  activeFenceIds: string[];
}

export interface DocumentFrontmatterLine extends DocumentSourceLine {
  type: "frontmatter-line";
}

export interface ParagraphPresenceAst {
  raw: string;
  range: SourceRange;
  expression: ExpressionAst;
  diagnostics: ExpressionDiagnostic[];
}

export interface BracketOpenerAst {
  raw: string;
  range: SourceRange;
  expression: ChainExpressionAst;
  diagnostics: ChainDiagnostic[];
}

export interface DocumentRoutingBranchAst {
  kind: "condition" | "else";
  raw: string;
  range: SourceRange;
  condition: ExpressionAst | null;
  conditionDiagnostics: ExpressionDiagnostic[];
  target: string;
  targetRange: SourceRange;
}

export interface DocumentRoutingAst {
  raw: string;
  range: SourceRange;
  branches: DocumentRoutingBranchAst[];
}

export interface DocumentBracketLine extends DocumentSourceLine {
  type: "bracket-line";
  activeFenceIds: string[];
  slot: "paragraph-prefix" | "routing";
  options: OptionPatchEntry[];
  presence: ParagraphPresenceAst | null;
  opener: BracketOpenerAst | null;
  routing: DocumentRoutingAst | null;
}

export interface DocumentInteractiveOutcomeAst {
  kind: "outcome" | "else";
  raw: string;
  range: SourceRange;
  outcome: string | null;
  outcomeRange: SourceRange | null;
  target: string;
  targetRange: SourceRange;
}

export interface DocumentInteractiveLine extends DocumentSourceLine {
  type: "interactive-line";
  activeFenceIds: string[];
  moduleId: string;
  moduleIdRange: SourceRange;
  outcomes: DocumentInteractiveOutcomeAst[];
}

export interface DocumentGotoLine extends DocumentSourceLine {
  type: "goto-line";
  activeFenceIds: string[];
  target: string;
  targetRange: SourceRange;
}

export type DocumentRenderableLine = DocumentContentLine | DocumentAnchorContentLine;

export type DocumentLineAst =
  | DocumentContentLine
  | DocumentAnchorLine
  | DocumentAnchorContentLine
  | DocumentBlankLine
  | DocumentCommentLine
  | DocumentSceneBoundaryLine
  | DocumentFenceOpenLine
  | DocumentFenceCloseLine
  | DocumentFenceErrorLine
  | DocumentStructureErrorLine
  | DocumentBracketLine
  | DocumentInteractiveLine
  | DocumentGotoLine
  | DocumentFrontmatterLine;

export interface FenceAst {
  type: "fence";
  id: string;
  name: string;
  sceneIndex: number;
  depth: number;
  parentFenceId: string | null;
  openRange: SourceRange;
  closeRange: SourceRange | null;
  contentRange: SourceRange;
  coveredLineRanges: SourceRange[];
  closed: boolean;
}

export interface ParagraphAst {
  type: "paragraph";
  id: string;
  sceneIndex: number;
  index: number;
  range: SourceRange;
  prefixLines: DocumentBracketLine[];
  bodyLines: DocumentRenderableLine[];
  options: OptionPatchEntry[];
  presence: ParagraphPresenceAst[];
  openers: BracketOpenerAst[];
}

export interface SceneAst {
  type: "scene";
  id: string;
  index: number;
  range: SourceRange;
  lines: DocumentLineAst[];
  fences: FenceAst[];
  paragraphs: ParagraphAst[];
}

export interface DocumentAst {
  type: "document";
  raw: string;
  range: SourceRange;
  frontmatterRange: SourceRange | null;
  scenes: SceneAst[];
  lines: DocumentLineAst[];
  diagnostics: DocumentDiagnostic[];
  contentDiagnostics: ContentDiagnostic[];
  expressionDiagnostics: ExpressionDiagnostic[];
  chainDiagnostics: ChainDiagnostic[];
}

export interface FenceObjectBinding {
  type: "fence-object-binding";
  fenceId: string;
  sceneIndex: number;
  contentRange: SourceRange;
  coveredLineRanges: SourceRange[];
}

export interface FenceDefinitionResult {
  definitions: ScopeDefinition<FenceObjectBinding>[];
  diagnostics: DocumentDiagnostic[];
  scopeDiagnostics: readonly ScopeDiagnostic[];
  complete: boolean;
}
