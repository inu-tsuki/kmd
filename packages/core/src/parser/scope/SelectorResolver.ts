import type {
  CommandMemberAst,
  SelectorSubjectAst,
} from "../chainSyntax/types";
import type {
  BraceGroupInput,
  ScopeDiagnostic,
  SelectorAccessor,
  SpatialSelector,
} from "./types";

export interface BracedSelectorResolution {
  selector: SpatialSelector;
  diagnostics: ScopeDiagnostic[];
  nextSequenceIndex: number;
  usedSequence: boolean;
}

export interface SelectorConstructionResult {
  selector: SpatialSelector | null;
  diagnostics: ScopeDiagnostic[];
}

export class SelectorResolver {
  public resolveBraced(
    subject: SelectorSubjectAst,
    groups: readonly BraceGroupInput[],
    sequenceIndex: number,
  ): BracedSelectorResolution {
    const content = subject.content.trim();
    if (content.length === 0) {
      return {
        selector: {
          kind: "brace-group",
          valueType: "domain",
          mode: "sequence",
          group: groups[sequenceIndex] ?? null,
          query: null,
          occurrence: null,
          range: { ...subject.range },
        },
        diagnostics: [],
        nextSequenceIndex: sequenceIndex + 1,
        usedSequence: true,
      };
    }

    const parsed = parseContentSelector(content);
    if (parsed.error !== null) {
      return {
        selector: {
          kind: "brace-group",
          valueType: "domain",
          mode: "content",
          group: null,
          query: parsed.query,
          occurrence: parsed.occurrence,
          range: { ...subject.range },
        },
        diagnostics: [{
          code: "selector-invalid-ordinal",
          severity: "error",
          message: parsed.error,
          range: { ...subject.range },
        }],
        nextSequenceIndex: sequenceIndex,
        usedSequence: false,
      };
    }

    const matches = groups.filter((group) => group.text.startsWith(parsed.query));
    const selection = selectContentMatch(matches, parsed.occurrence, parsed.query, subject.range);
    return {
      selector: {
        kind: "brace-group",
        valueType: "domain",
        mode: "content",
        group: selection.group,
        query: parsed.query,
        occurrence: parsed.occurrence,
        range: { ...subject.range },
      },
      diagnostics: selection.diagnostics,
      nextSequenceIndex: sequenceIndex,
      usedSequence: false,
    };
  }

  public validateSequenceCount(
    sequenceCount: number,
    groupCount: number,
    range: { start: number; end: number },
  ): ScopeDiagnostic[] {
    if (sequenceCount === 0 || sequenceCount === groupCount) {
      return [];
    }
    return [{
      code: "selector-group-count-mismatch",
      severity: "error",
      message: `Sequential selector count ${sequenceCount} does not match brace-group count ${groupCount}.`,
      range: { ...range },
    }];
  }

  public construct(member: CommandMemberAst): SelectorConstructionResult {
    if (member.name.name === "mark") {
      if (member.args.length !== 1) {
        return invalidConstructor(member, "mark() requires exactly one point name.");
      }
      return {
        selector: {
          kind: "mark",
          valueType: "point",
          argument: member.args[0]!,
          range: { ...member.range },
        },
        diagnostics: [],
      };
    }

    if (member.name.name === "range") {
      if (member.args.length !== 2) {
        return invalidConstructor(member, "range() requires exactly two point arguments.");
      }
      return {
        selector: {
          kind: "range",
          valueType: "domain",
          from: member.args[0]!,
          to: member.args[1]!,
          range: { ...member.range },
        },
        diagnostics: [],
      };
    }

    return { selector: null, diagnostics: [] };
  }

  public applyAccessor(
    selector: SpatialSelector,
    member: CommandMemberAst,
  ): SelectorConstructionResult {
    if (!isSelectorAccessorMember(member)) {
      return { selector: null, diagnostics: [] };
    }
    const accessor: SelectorAccessor = member.name.name;

    const required = accessor === "line" ? "point" : "domain";
    const result = accessor === "line" ? "domain" : "point";
    if (selector.valueType !== required) {
      return {
        selector,
        diagnostics: [{
          code: "selector-invalid-accessor",
          severity: "error",
          message: `Accessor .${accessor} requires a ${required} selector, but received ${selector.valueType}.`,
          range: { ...member.range },
        }],
      };
    }

    return {
      selector: {
        kind: "access",
        valueType: result,
        accessor,
        target: selector,
        range: { start: selector.range.start, end: member.range.end },
      },
      diagnostics: [],
    };
  }
}

export function isSelectorConstructorMember(member: CommandMemberAst): boolean {
  return member.op === null && (member.name.name === "mark" || member.name.name === "range");
}

export function isSelectorAccessorMember(member: CommandMemberAst): member is CommandMemberAst & {
  name: CommandMemberAst["name"] & { name: "line" | "start" | "end" };
} {
  return member.op === null
    && member.granularity === null
    && member.args.length === 0
    && !member.blocking
    && (member.name.name === "line" || member.name.name === "start" || member.name.name === "end");
}

function parseContentSelector(content: string): {
  query: string;
  occurrence: number | null;
  error: string | null;
} {
  const ordinal = /^(.*):([+-]?\d+)$/u.exec(content);
  if (ordinal === null) {
    return { query: content, occurrence: null, error: null };
  }

  const query = ordinal[1]!.trim();
  const occurrence = Number(ordinal[2]);
  if (query.length === 0 || !Number.isSafeInteger(occurrence) || occurrence < 1) {
    return {
      query,
      occurrence,
      error: "Content selector ordinals use a non-empty prefix followed by a positive integer, for example {text:2}.",
    };
  }
  return { query, occurrence, error: null };
}

function selectContentMatch(
  matches: readonly BraceGroupInput[],
  occurrence: number | null,
  query: string,
  range: { start: number; end: number },
): { group: BraceGroupInput | null; diagnostics: ScopeDiagnostic[] } {
  if (occurrence !== null) {
    const group = matches[occurrence - 1] ?? null;
    if (group !== null) {
      return { group, diagnostics: [] };
    }
    return {
      group: null,
      diagnostics: [{
        code: "selector-ordinal-out-of-range",
        severity: "error",
        message: `Content selector "${query}:${occurrence}" has only ${matches.length} matching brace group(s).`,
        range: { ...range },
      }],
    };
  }

  if (matches.length === 0) {
    return {
      group: null,
      diagnostics: [{
        code: "selector-content-not-found",
        severity: "error",
        message: `Content selector "${query}" does not match any brace group prefix.`,
        range: { ...range },
      }],
    };
  }
  if (matches.length > 1) {
    return {
      group: null,
      diagnostics: [{
        code: "selector-content-ambiguous",
        severity: "error",
        message: `Content selector "${query}" matches ${matches.length} brace groups; add an ordinal such as :2.`,
        range: { ...range },
      }],
    };
  }
  return { group: matches[0]!, diagnostics: [] };
}

function invalidConstructor(
  member: CommandMemberAst,
  message: string,
): SelectorConstructionResult {
  return {
    selector: null,
    diagnostics: [{
      code: "selector-constructor-argument",
      severity: "error",
      message,
      range: { ...member.range },
    }],
  };
}
