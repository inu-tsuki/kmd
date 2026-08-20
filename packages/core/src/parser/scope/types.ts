import type { DiagnosticSeverity, SourceRange } from "../../types/diagnostics";
import type {
  ArgAst,
  BeatAst,
  ChainExpressionAst,
  ClauseMemberAst,
  CommandMemberAst,
  ConnectorAst,
  ErrorNodeAst,
  IdentifierAst,
  ReferenceMemberAst,
  SentenceAst,
  SyntaxNodeBase,
} from "../chainSyntax/types";

export interface ScriptPosition {
  /** Absolute UTF-16 offset in the original document. */
  offset: number;
}

export type ScopeDefinitionKind = "macro" | "object" | "var" | "state";
export type ScopeDefinitionLevel = "scene" | "document";
export type ScopeDefinitionSource = "definition" | "fence" | "frontmatter";

export interface ScopeDefinition<TPayload = unknown> {
  name: string;
  qualifiedName: string;
  kind: ScopeDefinitionKind;
  level: ScopeDefinitionLevel;
  visibleFrom: ScriptPosition;
  visibleUntil: ScriptPosition;
  payload: TPayload;
  declarationRange: SourceRange;
  source: ScopeDefinitionSource;
}

export type ScopeCommandFamily = "style" | "effect" | "layout" | "stage";

export interface ScopeCommandMatch {
  name: string;
  family: ScopeCommandFamily;
  metadata?: Readonly<Record<string, unknown>>;
}

/**
 * B0.2 needs every registry match. A fixed-priority getFamily() result cannot
 * represent D21 conflicts and therefore is deliberately absent from this API.
 */
export interface ScopeCommandRegistryView {
  find(name: string): readonly ScopeCommandMatch[];
  list(): readonly ScopeCommandMatch[];
}

export type ScopeDiagnosticCode =
  | "scope-duplicate-definition"
  | "scope-invalid-definition-interval"
  | "scope-name-conflicts-builtin"
  | "scope-name-conflicts-command"
  | "scope-command-family-conflict"
  | "scope-name-out-of-scope"
  | "scope-unknown-name"
  | "scope-unknown-command"
  | "scope-bare-layout-deprecated"
  | "selector-group-count-mismatch"
  | "selector-content-not-found"
  | "selector-content-ambiguous"
  | "selector-ordinal-out-of-range"
  | "selector-invalid-ordinal"
  | "selector-invalid-accessor"
  | "selector-constructor-argument";

export interface ScopeDiagnostic {
  code: ScopeDiagnosticCode;
  severity: DiagnosticSeverity;
  message: string;
  range: SourceRange;
}

export interface BuiltinSubject {
  kind: "builtin";
  name: "cam" | "flow" | "var" | "bg";
}

export interface DefinitionSubject {
  kind: "definition";
  definition: ScopeDefinition;
}

export interface CommandHeadSubject {
  kind: "command-head";
  command: ScopeCommandMatch;
}

export type NamedScopeEntity = BuiltinSubject | DefinitionSubject | CommandHeadSubject;

export type ScopeResolution =
  | {
    status: "resolved";
    entity: NamedScopeEntity;
    diagnostics: ScopeDiagnostic[];
  }
  | {
    status: "unresolved";
    reason: "conflict" | "out-of-scope" | "unknown";
    diagnostics: ScopeDiagnostic[];
  };

export interface BraceGroupInput {
  id: string | number;
  text: string;
  range: SourceRange;
}

export type SpatialValueType = "point" | "domain";
export type SelectorAccessor = "line" | "start" | "end";

export type SpatialSelector =
  | {
    kind: "line";
    valueType: "domain";
    source: "explicit-dot" | "implicit-command";
    range: SourceRange;
  }
  | {
    kind: "brace-group";
    valueType: "domain";
    mode: "sequence" | "content";
    group: BraceGroupInput | null;
    query: string | null;
    occurrence: number | null;
    range: SourceRange;
  }
  | {
    kind: "relative-line";
    valueType: "domain";
    direction: "prev" | "next";
    range: SourceRange;
  }
  | {
    kind: "definition";
    valueType: "domain";
    definition: ScopeDefinition;
    range: SourceRange;
  }
  | {
    kind: "mark";
    valueType: "point";
    argument: ArgAst;
    range: SourceRange;
  }
  | {
    kind: "range";
    valueType: "domain";
    from: ArgAst;
    to: ArgAst;
    range: SourceRange;
  }
  | {
    kind: "access";
    valueType: SpatialValueType;
    accessor: SelectorAccessor;
    target: SpatialSelector;
    range: SourceRange;
  };

export type ResolvedSubject =
  | {
    kind: "selector";
    selector: SpatialSelector;
  }
  | BuiltinSubject
  | DefinitionSubject;

export interface ResolvedCommand {
  name: string;
  family: ScopeCommandFamily | null;
  /** Registry metadata is carried forward so later stages never re-run lookup. */
  metadata?: Readonly<Record<string, unknown>>;
  source: IdentifierAst | CommandMemberAst;
  diagnostics: ScopeDiagnostic[];
}

export interface ResolvedCommandMember {
  type: "resolved-command-member";
  source: CommandMemberAst;
  role: "predicate" | "selector-constructor" | "selector-accessor";
  command: ResolvedCommand | null;
}

export interface MacroExpansionOrigin {
  kind: "macro-expansion";
  macroName: string | null;
  definitionRange: SourceRange | null;
  referenceRange: SourceRange;
  expansionId: string;
  localTimelineId: string;
}

export interface ResolvedClauseMember {
  type: "resolved-clause-member";
  source: ClauseMemberAst;
  sentence: ResolvedSentence;
  /** Present only for the synthetic atomic clause created by B0.4 expansion. */
  origin?: MacroExpansionOrigin;
}

export interface ResolvedReferenceMember {
  type: "resolved-reference-member";
  source: ReferenceMemberAst;
}

export interface ResolvedErrorMember {
  type: "resolved-error-member";
  source: ErrorNodeAst;
}

export type ResolvedMember =
  | ResolvedCommandMember
  | ResolvedClauseMember
  | ResolvedReferenceMember
  | ResolvedErrorMember;

export interface ResolvedBeat {
  source: BeatAst;
  connectorBefore: ConnectorAst | null;
  members: ResolvedMember[];
}

export interface ResolvedSentence {
  source: SentenceAst;
  subject: ResolvedSubject | null;
  commandHead: ResolvedCommand | null;
  beats: ResolvedBeat[];
  diagnostics: ScopeDiagnostic[];
}

export interface ResolvedExpression {
  source: ChainExpressionAst;
  sentences: ResolvedSentence[];
  diagnostics: ScopeDiagnostic[];
}

export interface SubjectResolutionContext {
  at?: ScriptPosition;
  braceGroups?: readonly BraceGroupInput[];
}

export interface ScopeDefinitionInput<TPayload = unknown> {
  name: string;
  kind: ScopeDefinitionKind;
  level: ScopeDefinitionLevel;
  visibleFrom: ScriptPosition;
  visibleUntil: ScriptPosition;
  payload: TPayload;
  declarationRange: SourceRange;
  source: ScopeDefinitionSource;
}

export interface DefinitionSentenceInput<TPayload = unknown> {
  sentence: SentenceAst;
  visibleUntil: ScriptPosition;
  payload?: TPayload;
}

export function nodeRange(node: SyntaxNodeBase): SourceRange {
  return { start: node.range.start, end: node.range.end };
}
