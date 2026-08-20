import type { GranularityUnit } from "../chainSyntax/types";
import type {
  RevealUnit,
  SemanticBeat,
  SemanticDeferredMember,
  SemanticExecutableMember,
  SemanticSentence,
  TimedBeat,
  TimedMemberInstance,
  TimedSentence,
  TimingDiagnostic,
  UnitRevealPlan,
} from "./types";

interface NormalizedRevealPlan {
  char: RevealUnit[];
  group: RevealUnit[];
  block: RevealUnit[];
}

/**
 * Maps semantic beats onto nominal time after layout has supplied unit reveal
 * positions. The result contains dependency ids only; actual completion time
 * remains a runtime concern and no GSAP/Pixi object is created here.
 */
export class ChainTimingLowerer {
  public lower(sentence: SemanticSentence, revealPlan: UnitRevealPlan): TimedSentence {
    const diagnostics: TimingDiagnostic[] = [];
    const plan = normalizeRevealPlan(revealPlan, sentence, diagnostics);
    const beats: TimedBeat[] = [];
    let nominalOffsetSeconds = 0;

    sentence.beats.forEach((beat, beatIndex) => {
      if (beatIndex > 0) {
        if (beat.connectorBefore?.durationSeconds === null || beat.connectorBefore === null) {
          diagnostics.push({
            code: "timing-invalid-connector",
            severity: "error",
            message: "A later beat requires a valid connector duration.",
            range: beat.source?.range ?? sentence.source.range,
          });
        } else {
          nominalOffsetSeconds += beat.connectorBefore.durationSeconds;
        }
      }

      const previousBlocking = beats.at(-1)?.instances.filter(isBlockingInstance) ?? [];
      const instances = this.instantiateBeat(
        beat,
        beatIndex,
        nominalOffsetSeconds,
        plan,
        previousBlocking,
        diagnostics,
      );
      beats.push({
        beatIndex,
        source: beat.source,
        connectorBefore: beat.connectorBefore,
        nominalOffsetSeconds,
        instances,
      });
    });

    return { source: sentence.source, beats, diagnostics };
  }

  private instantiateBeat(
    beat: SemanticBeat,
    beatIndex: number,
    nominalOffsetSeconds: number,
    plan: NormalizedRevealPlan,
    previousBlocking: readonly TimedMemberInstance[],
    diagnostics: TimingDiagnostic[],
  ): TimedMemberInstance[] {
    const instances: TimedMemberInstance[] = [];
    beat.members.forEach((member, memberIndex) => {
      if (member.type === "semantic-deferred-member") {
        diagnostics.push(deferredMemberDiagnostic(member));
        return;
      }

      const unitKind = member.granularity;
      if (unitKind === null) {
        instances.push(createInstance(
          member,
          beatIndex,
          memberIndex,
          0,
          null,
          null,
          nominalOffsetSeconds,
          previousBlocking,
        ));
        return;
      }

      const units = plan[unitKind];
      if (units.length === 0) {
        diagnostics.push({
          code: "timing-missing-reveal-plan",
          severity: "error",
          message: `Granularity :${unitKind} requires layout reveal units.`,
          range: memberRange(member),
        });
        return;
      }

      units.forEach((unit, unitIndex) => {
        instances.push(createInstance(
          member,
          beatIndex,
          memberIndex,
          unitIndex,
          unitKind,
          unit,
          nominalOffsetSeconds + unit.revealAtSeconds,
          previousBlocking,
        ));
      });
    });
    return instances;
  }
}

function createInstance(
  member: SemanticExecutableMember,
  beatIndex: number,
  memberIndex: number,
  unitIndex: number,
  unitKind: GranularityUnit | null,
  unit: RevealUnit | null,
  nominalStartSeconds: number,
  previousBlocking: readonly TimedMemberInstance[],
): TimedMemberInstance {
  const id = unit === null
    ? `b${beatIndex}:m${memberIndex}`
    : `b${beatIndex}:m${memberIndex}:u${unitIndex}`;
  const dependency = dependenciesFor(unitKind, unit?.id ?? null, previousBlocking);
  return {
    id,
    beatIndex,
    memberIndex,
    member,
    unitKind,
    unitId: unit?.id ?? null,
    nominalStartSeconds,
    dependencyMode: dependency.mode,
    dependsOnInstanceIds: dependency.ids,
  };
}

function dependenciesFor(
  unitKind: GranularityUnit | null,
  unitId: string | null,
  previousBlocking: readonly TimedMemberInstance[],
): { mode: TimedMemberInstance["dependencyMode"]; ids: string[] } {
  if (previousBlocking.length === 0) return { mode: "none", ids: [] };
  const canPairByUnit = unitKind !== null
    && unitId !== null
    && previousBlocking.every((instance) => instance.unitKind === unitKind);
  if (canPairByUnit) {
    const paired = previousBlocking
      .filter((instance) => instance.unitId === unitId)
      .map((instance) => instance.id);
    if (paired.length > 0) return { mode: "unit", ids: paired };
  }
  return { mode: "beat", ids: previousBlocking.map((instance) => instance.id) };
}

function normalizeRevealPlan(
  source: UnitRevealPlan,
  sentence: SemanticSentence,
  diagnostics: TimingDiagnostic[],
): NormalizedRevealPlan {
  return {
    char: normalizeRevealUnits("char", source.char, sentence, diagnostics),
    group: normalizeRevealUnits("group", source.group, sentence, diagnostics),
    block: normalizeRevealUnits("block", source.block, sentence, diagnostics),
  };
}

function normalizeRevealUnits(
  kind: GranularityUnit,
  source: readonly RevealUnit[],
  sentence: SemanticSentence,
  diagnostics: TimingDiagnostic[],
): RevealUnit[] {
  const seen = new Set<string>();
  const result: RevealUnit[] = [];
  for (const unit of source) {
    if (unit.id.length === 0 || !Number.isFinite(unit.revealAtSeconds) || unit.revealAtSeconds < 0) {
      diagnostics.push({
        code: "timing-invalid-reveal-unit",
        severity: "error",
        message: `Invalid ${kind} reveal unit; id must be non-empty and reveal time non-negative.`,
        range: { ...sentence.source.range },
      });
      continue;
    }
    if (seen.has(unit.id)) {
      diagnostics.push({
        code: "timing-duplicate-reveal-unit",
        severity: "error",
        message: `Duplicate ${kind} reveal unit id "${unit.id}".`,
        range: { ...sentence.source.range },
      });
      continue;
    }
    seen.add(unit.id);
    result.push({ ...unit });
  }
  return result;
}

function deferredMemberDiagnostic(member: SemanticDeferredMember): TimingDiagnostic {
  return {
    code: "timing-deferred-member",
    severity: "warning",
    message: `Deferred ${member.reason} member has no timing instance yet.`,
    range: { ...member.source.range },
  };
}

function isBlockingInstance(instance: TimedMemberInstance): boolean {
  return instance.member.blocking;
}

function memberRange(member: SemanticExecutableMember): { start: number; end: number } {
  return member.type === "semantic-command-member"
    ? { ...member.source.range }
    : { ...member.sourceRange };
}
