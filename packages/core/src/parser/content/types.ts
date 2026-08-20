import type { SourceRange } from "../../types/diagnostics";
import type { StateReadView } from "../../state/StateStore";
import type {
  BoundExpression,
  ExpressionAst,
  ExpressionDiagnostic,
  SpatialValueProvider,
} from "../expression/types";

export type ContentDiagnosticCode =
  | "content-unclosed-brace-group"
  | "content-unclosed-expression-span"
  | "content-unclosed-pause"
  | "content-empty-expression-span"
  | "content-conditional-branch-count"
  | "content-conditional-empty-text"
  | "content-match-empty-label"
  | "content-match-missing-fallback"
  | "content-interpolation-non-scalar"
  | "content-condition-non-boolean"
  | "content-match-non-scalar";

export interface ContentDiagnostic {
  code: ContentDiagnosticCode;
  severity: "error";
  message: string;
  range: SourceRange;
}

export type ContentMark = "bold" | "italic";

interface ContentNodeBase {
  raw: string;
  range: SourceRange;
}

export interface TextRunAst extends ContentNodeBase {
  type: "text-run";
  content: string;
  marks: ContentMark[];
}

export interface BraceGroupAst extends ContentNodeBase {
  type: "brace-group";
  children: ContentNodeAst[];
  closed: boolean;
}

export interface PauseCueAst extends ContentNodeBase {
  type: "pause-cue";
  parameter: string | null;
  parameterRange: SourceRange | null;
  closed: boolean;
}

export interface SugarCueAst extends ContentNodeBase {
  type: "sugar-cue";
  sugar: "slow" | "fast" | "go";
  level: "char" | "group" | "block";
}

export type InlineCaseValue = number | string | boolean;

export interface InlineTextBranch {
  text: string;
  range: SourceRange;
}

export interface InlineTextCase extends InlineTextBranch {
  label: InlineCaseValue;
  labelRange: SourceRange;
}

export type InlineTextExpressionAst =
  | {
      type: "inline-interpolation";
      expression: ExpressionAst;
    }
  | {
      type: "inline-conditional";
      condition: ExpressionAst;
      whenTrue: InlineTextBranch;
      whenFalse: InlineTextBranch;
    }
  | {
      type: "inline-match";
      discriminant: ExpressionAst;
      cases: InlineTextCase[];
      fallback: InlineTextBranch | null;
    };

export interface ExprSpanAst extends ContentNodeBase {
  type: "expr-span";
  marks: ContentMark[];
  expression: InlineTextExpressionAst;
  expressionDiagnostics: ExpressionDiagnostic[];
}

export type ContentNodeAst =
  | TextRunAst
  | BraceGroupAst
  | PauseCueAst
  | SugarCueAst
  | ExprSpanAst;

export interface ContentScanResult {
  nodes: ContentNodeAst[];
  diagnostics: ContentDiagnostic[];
  expressionDiagnostics: ExpressionDiagnostic[];
  complete: boolean;
}

export type BoundInlineTextExpression =
  | {
      type: "bound-inline-interpolation";
      expression: BoundExpression;
    }
  | {
      type: "bound-inline-conditional";
      condition: BoundExpression;
      whenTrue: InlineTextBranch;
      whenFalse: InlineTextBranch;
    }
  | {
      type: "bound-inline-match";
      discriminant: BoundExpression;
      cases: InlineTextCase[];
      fallback: InlineTextBranch | null;
    };

export interface BoundExprSpan extends ContentNodeBase {
  type: "bound-expr-span";
  marks: ContentMark[];
  expression: BoundInlineTextExpression;
}

export type BoundContentNode =
  | TextRunAst
  | {
      type: "bound-brace-group";
      raw: string;
      range: SourceRange;
      children: BoundContentNode[];
      closed: boolean;
    }
  | PauseCueAst
  | SugarCueAst
  | BoundExprSpan;

export interface ContentBindingResult {
  nodes: BoundContentNode[];
  diagnostics: ExpressionDiagnostic[];
  complete: boolean;
}

export type BakedContentNode =
  | TextRunAst
  | {
      type: "baked-brace-group";
      raw: string;
      range: SourceRange;
      children: BakedContentNode[];
      closed: boolean;
    }
  | PauseCueAst
  | SugarCueAst;

export interface ContentBakeContext {
  state: StateReadView;
  spatial?: SpatialValueProvider;
}

export interface ContentBakeResult {
  nodes: BakedContentNode[];
  text: string;
  diagnostics: Array<ContentDiagnostic | ExpressionDiagnostic>;
  complete: boolean;
}
