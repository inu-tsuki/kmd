import type {
  ArgAst,
  CommandMemberAst,
  IdentifierAst,
  RangeEndpointAst,
  ValueAst,
} from "../chainSyntax/types";
import type {
  ResolvedBeat,
  ResolvedCommand,
  ResolvedCommandMember,
  ResolvedExpression,
  ResolvedSentence,
} from "../scope/types";
import type {
  CommandArgumentUnit,
  CommandArgumentUnits,
} from "../../types/command";
import type {
  SemanticBeat,
  SemanticBoundArgument,
  SemanticBoundValue,
  SemanticClauseMember,
  SemanticCommandMember,
  SemanticConnector,
  SemanticDeferredMember,
  SemanticDiagnostic,
  SemanticLoweringResult,
  SemanticRangeEndpoint,
  SemanticSentence,
  SemanticSentenceLoweringOptions,
} from "./types";
import { bindNumberWithDefaultUnit } from "./valueBinding";

const COMMAND_ARGUMENT_UNITS = new Set<CommandArgumentUnit>([
  "number",
  "s",
  "ms",
  "char",
  "line",
  "self",
  "px",
  "deg",
]);

interface SentenceLowering {
  sentence: SemanticSentence;
  diagnostics: SemanticDiagnostic[];
  complete: boolean;
}

interface MemberLowering {
  member: SemanticCommandMember | SemanticDeferredMember;
  diagnostics: SemanticDiagnostic[];
  complete: boolean;
}

interface ArgumentUnitRead {
  units: CommandArgumentUnits | null;
  diagnostics: SemanticDiagnostic[];
}

/**
 * B0.3 semantic lowering consumes B0.2 resolution exactly once. It does not
 * query any runtime registry, create engine objects, or claim deferred B0.4/B1
 * references are final DocumentSemanticIR values.
 */
export class SemanticLowerer {
  public lowerExpression(expression: ResolvedExpression): SemanticLoweringResult {
    const sentences: SemanticSentence[] = [];
    const diagnostics: SemanticDiagnostic[] = [];
    let complete = expression.diagnostics.every((entry) => entry.severity !== "error");

    for (const source of expression.sentences) {
      const lowered = this.lowerSentence(source);
      sentences.push(lowered.sentence);
      diagnostics.push(...lowered.diagnostics);
      complete &&= lowered.complete;
    }

    return {
      sentences,
      diagnostics,
      upstreamDiagnostics: [...expression.diagnostics],
      complete,
    };
  }

  public lowerSentence(
    source: ResolvedSentence,
    options: SemanticSentenceLoweringOptions = {},
  ): SentenceLowering {
    const diagnostics: SemanticDiagnostic[] = [];
    let complete = source.diagnostics.every((entry) => entry.severity !== "error");

    const memberOperationAllowed = source.source.kind === "member-op"
      && options.allowMemberOperation === true;
    if (source.source.kind !== "predicate" && !memberOperationAllowed) {
      diagnostics.push({
        code: "semantic-sentence-kind-deferred",
        severity: "warning",
        message: `Sentence kind "${source.source.kind}" is owned by a later lowering stage.`,
        range: { ...source.source.range },
      });
      complete = false;
    }

    const beats = source.beats.map((beat) => this.lowerBeat(beat, diagnostics));
    let commandHeadInserted = false;
    if (source.commandHead !== null) {
      const commandHead = this.lowerCommand(
        source.commandHead,
        "command-head",
        source.commandHead.source,
      );
      diagnostics.push(...commandHead.diagnostics);
      complete &&= commandHead.complete;
      commandHeadInserted = true;
      if (beats.length === 0) {
        beats.push({ source: null, connectorBefore: null, members: [commandHead.member] });
      } else {
        beats[0]!.members.unshift(commandHead.member);
      }
    }

    for (const beat of beats) {
      for (const member of beat.members) {
        if (member.type === "semantic-deferred-member") complete = false;
        if (
          member.type === "semantic-command-member"
          && member.args.some((arg) => isDeferredOrInvalidValue(arg.value))
        ) {
          complete = false;
        }
        if (member.type === "semantic-clause-member") {
          complete &&= member.sentence.complete;
        }
      }
    }
    complete &&= diagnostics.every((entry) => entry.severity !== "error");

    const sentence: SemanticSentence = {
      source: source.source,
      subject: source.subject,
      commandHeadInserted,
      beats,
      diagnostics: [...diagnostics],
      complete,
    };
    return { sentence, diagnostics, complete };
  }

  private lowerBeat(
    source: ResolvedBeat,
    sentenceDiagnostics: SemanticDiagnostic[],
  ): SemanticBeat {
    const connectorBefore = source.connectorBefore === null
      ? null
      : this.lowerConnector(source.connectorBefore, sentenceDiagnostics);
    const members: SemanticBeat["members"] = [];

    for (const resolved of source.members) {
      if (resolved.type === "resolved-command-member") {
        if (resolved.role !== "predicate") continue;
        if (resolved.command === null) {
          const diagnostic = unresolvedCommandDiagnostic(
            resolved.source.name.name,
            resolved.source.range,
          );
          sentenceDiagnostics.push(diagnostic);
          members.push({
            type: "semantic-deferred-member",
            source: resolved.source,
            reason: "unresolved-command",
          });
          continue;
        }
        const lowered = this.lowerResolvedMember(resolved);
        sentenceDiagnostics.push(...lowered.diagnostics);
        members.push(lowered.member);
        continue;
      }

      if (resolved.type === "resolved-clause-member") {
        const nested = this.lowerSentence(resolved.sentence);
        sentenceDiagnostics.push(...nested.diagnostics);
        const canonicalize = hasTerminalExplicitBlocking(resolved.source.sentence)
          && !resolved.source.blocking;
        const clause: SemanticClauseMember = {
          type: "semantic-clause-member",
          sourceRange: { ...resolved.source.range },
          sentence: nested.sentence,
          granularity: resolved.source.granularity?.unit ?? null,
          blocking: resolved.source.blocking || canonicalize,
          canonicalization: canonicalize ? "inner-terminal-blocking-to-clause" : null,
          ...(resolved.origin === undefined ? {} : { origin: resolved.origin }),
        };
        members.push(clause);
        continue;
      }

      if (resolved.type === "resolved-reference-member") {
        sentenceDiagnostics.push({
          code: "semantic-reference-deferred",
          severity: "warning",
          message: "Reference expansion is deferred until B0.4 and is not final semantic IR yet.",
          range: { ...resolved.source.range },
        });
        members.push({
          type: "semantic-deferred-member",
          source: resolved.source,
          reason: "reference",
        });
        continue;
      }

      sentenceDiagnostics.push({
        code: "semantic-syntax-member-invalid",
        severity: "error",
        message: "The recovered syntax member cannot be lowered into an executable member.",
        range: { ...resolved.source.range },
      });
      members.push({
        type: "semantic-deferred-member",
        source: resolved.source,
        reason: "syntax-error",
      });
    }

    return {
      source: source.source,
      connectorBefore,
      members,
    };
  }

  private lowerResolvedMember(source: ResolvedCommandMember): MemberLowering {
    return this.lowerCommand(source.command!, "predicate", source.source);
  }

  private lowerCommand(
    command: ResolvedCommand,
    origin: SemanticCommandMember["origin"],
    syntax: CommandMemberAst | IdentifierAst,
  ): MemberLowering {
    if (command.name === "hold" || command.name === "ease") {
      return {
        member: {
          type: "semantic-deferred-member",
          source: syntax,
          reason: "legacy-timing-command",
        },
        diagnostics: [{
          code: "semantic-legacy-timing-command",
          severity: "error",
          message: `Legacy timing command "${command.name}" must be rewritten with a connector (-d-> or ~d~>).`,
          range: { ...syntax.range },
        }],
        complete: false,
      };
    }

    if (command.family === null) {
      return {
        member: {
          type: "semantic-deferred-member",
          source: syntax,
          reason: "unresolved-command",
        },
        diagnostics: [unresolvedCommandDiagnostic(command.name, syntax.range)],
        complete: false,
      };
    }

    const metadata = readArgumentUnits(command.metadata, syntax.range);
    const sourceArgs = syntax.type === "command-member" ? syntax.args : [];
    const args: SemanticBoundArgument[] = [];
    const diagnostics = [...metadata.diagnostics];
    let complete = metadata.diagnostics.length === 0;

    sourceArgs.forEach((arg, sourceIndex) => {
      const expectedUnit = expectedUnitForArgument(metadata.units, arg, sourceIndex);
      const bound = bindValue(arg.value, expectedUnit, diagnostics);
      args.push({
        source: arg,
        name: arg.name?.name ?? null,
        sourceIndex,
        expectedUnit,
        value: bound,
      });
      complete &&= !isDeferredOrInvalidValue(bound);
    });

    const explicitBlocking = syntax.type === "command-member" && syntax.blocking;
    const metadataBlocking = command.metadata?.blockingDefault === true;
    const member: SemanticCommandMember = {
      type: "semantic-command-member",
      source: syntax,
      origin,
      name: command.name,
      family: command.family,
      ...(command.metadata === undefined ? {} : { metadata: command.metadata }),
      operator: syntax.type === "command-member" ? syntax.op : null,
      args,
      granularity: syntax.type === "command-member"
        ? syntax.granularity?.unit ?? null
        : null,
      blocking: explicitBlocking || metadataBlocking,
      blockingOrigin: explicitBlocking
        ? "explicit"
        : metadataBlocking
          ? "metadata"
          : "none",
    };
    return { member, diagnostics, complete };
  }

  private lowerConnector(
    source: NonNullable<ResolvedBeat["connectorBefore"]>,
    diagnostics: SemanticDiagnostic[],
  ): SemanticConnector {
    if (source.duration.type !== "time-quantity") {
      diagnostics.push({
        code: "semantic-invalid-connector-duration",
        severity: "error",
        message: "Connector duration must be a valid time quantity.",
        range: { ...source.duration.range },
      });
      return {
        source,
        kind: source.kind,
        durationSeconds: null,
        easing: source.easing,
      };
    }

    const seconds = toSeconds(source.duration.value, source.duration.unit);
    if (seconds < 0) {
      diagnostics.push({
        code: "semantic-negative-connector-duration",
        severity: "error",
        message: "Connector duration cannot be negative.",
        range: { ...source.duration.range },
      });
      return {
        source,
        kind: source.kind,
        durationSeconds: null,
        easing: source.easing,
      };
    }

    return {
      source,
      kind: source.kind,
      durationSeconds: seconds,
      easing: source.easing,
    };
  }
}

function bindValue(
  source: ValueAst,
  expectedUnit: CommandArgumentUnit | null,
  diagnostics: SemanticDiagnostic[],
): SemanticBoundValue {
  switch (source.type) {
    case "number-literal":
      return bindNumberWithDefaultUnit(source.value, expectedUnit);
    case "time-quantity":
      return {
        type: "time",
        seconds: toSeconds(source.value, source.unit),
        sourceUnit: source.unit,
      };
    case "space-quantity":
      return { type: "space", value: source.value, unit: source.unit };
    case "angle-quantity":
      return { type: "angle", value: source.value, unit: source.unit };
    case "rate-quantity":
      return {
        type: "rate",
        value: source.value,
        ...(source.numeratorUnit === undefined
          ? {}
          : { numeratorUnit: source.numeratorUnit }),
        denominatorUnit: source.denominatorUnit,
      };
    case "relative-quantity":
      return {
        type: "relative",
        operator: source.operator,
        value: source.value,
        ...(expectedUnit === null ? {} : { unit: expectedUnit, defaultUnitApplied: true }),
      };
    case "string-literal":
      return { type: "string", value: source.value, quote: source.quote };
    case "bool-literal":
      return { type: "bool", value: source.value };
    case "event-literal":
      return {
        type: "event",
        event: source.event,
        ...(source.signal === undefined ? {} : { signal: source.signal }),
      };
    case "range-literal":
      return {
        type: "range",
        from: bindRangeEndpoint(source.from, expectedUnit, diagnostics),
        durationSeconds: source.duration === undefined
          ? null
          : toSeconds(source.duration.value, source.duration.unit),
        to: bindRangeEndpoint(source.to, expectedUnit, diagnostics),
      };
    case "name-ref":
    case "expression-slice":
      diagnostics.push({
        code: "semantic-value-deferred",
        severity: "warning",
        message: source.type === "name-ref"
          ? "Name value binding is deferred until B1."
          : "Expression evaluation is deferred until B1.",
        range: { ...source.range },
      });
      return {
        type: "deferred-value",
        reason: source.type,
        raw: source.raw,
        expectedUnit,
        sourceRange: { ...source.range },
      };
    case "invalid-value":
      diagnostics.push({
        code: "semantic-invalid-value",
        severity: "error",
        message: "Invalid syntax value cannot be bound.",
        range: { ...source.range },
      });
      return { type: "invalid-value", reason: source.reason, raw: source.raw };
  }
}

function bindRangeEndpoint(
  source: RangeEndpointAst,
  expectedUnit: CommandArgumentUnit | null,
  diagnostics: SemanticDiagnostic[],
): SemanticRangeEndpoint {
  const bound = bindValue(source, expectedUnit, diagnostics);
  if (
    bound.type === "number"
    || bound.type === "time"
    || bound.type === "space"
    || bound.type === "angle"
    || bound.type === "relative"
    || bound.type === "deferred-value"
  ) {
    return bound;
  }
  return {
    type: "deferred-value",
    reason: "expression-slice",
    raw: source.raw,
    expectedUnit,
    sourceRange: { ...source.range },
  };
}

function readArgumentUnits(
  metadata: Readonly<Record<string, unknown>> | undefined,
  range: { start: number; end: number },
): ArgumentUnitRead {
  const raw = metadata?.argumentUnits;
  if (raw === undefined) return { units: null, diagnostics: [] };
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return invalidMetadata(range);
  }

  const record = raw as Record<string, unknown>;
  if (!validPositionalUnits(record.positional) || !validNamedUnits(record.named)) {
    return invalidMetadata(range);
  }
  return {
    units: {
      ...(record.positional === undefined
        ? {}
        : { positional: record.positional as readonly (CommandArgumentUnit | null)[] }),
      ...(record.named === undefined
        ? {}
        : { named: record.named as Readonly<Record<string, CommandArgumentUnit>> }),
    },
    diagnostics: [],
  };
}

function validPositionalUnits(value: unknown): boolean {
  return value === undefined || (
    Array.isArray(value)
    && value.every((entry) => entry === null || COMMAND_ARGUMENT_UNITS.has(entry as CommandArgumentUnit))
  );
}

function validNamedUnits(value: unknown): boolean {
  return value === undefined || (
    value !== null
    && typeof value === "object"
    && !Array.isArray(value)
    && Object.values(value as Record<string, unknown>)
      .every((entry) => COMMAND_ARGUMENT_UNITS.has(entry as CommandArgumentUnit))
  );
}

function invalidMetadata(range: { start: number; end: number }): ArgumentUnitRead {
  return {
    units: null,
    diagnostics: [{
      code: "semantic-invalid-command-metadata",
      severity: "error",
      message: "Command argumentUnits metadata is malformed; bare numbers remain unbound.",
      range: { ...range },
    }],
  };
}

function expectedUnitForArgument(
  units: CommandArgumentUnits | null,
  source: ArgAst,
  sourceIndex: number,
): CommandArgumentUnit | null {
  if (units === null) return null;
  const named = source.name === null ? undefined : units.named?.[source.name.name];
  return named ?? units.positional?.[sourceIndex] ?? null;
}

function hasTerminalExplicitBlocking(sentence: ResolvedSentence["source"]): boolean {
  const finalBeat = sentence.beats.at(-1);
  const finalMember = finalBeat?.members.at(-1);
  return finalMember?.type === "command-member" && finalMember.blocking;
}

function toSeconds(value: number, unit: "s" | "ms"): number {
  return unit === "s" ? value : value / 1000;
}

function unresolvedCommandDiagnostic(
  name: string,
  range: { start: number; end: number },
): SemanticDiagnostic {
  return {
    code: "semantic-unresolved-command",
    severity: "error",
    message: `Command "${name}" has no unique resolved family.`,
    range: { ...range },
  };
}

function isDeferredOrInvalidValue(value: SemanticBoundValue): boolean {
  if (value.type === "deferred-value" || value.type === "invalid-value") return true;
  return value.type === "range" && (
    value.from.type === "deferred-value" || value.to.type === "deferred-value"
  );
}
