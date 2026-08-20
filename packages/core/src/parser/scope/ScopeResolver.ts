import type { SourceRange } from "../../types/diagnostics";
import type { DefinitionIndex } from "./DefinitionIndex";
import type {
  ScopeCommandMatch,
  ScopeCommandRegistryView,
  ScopeDiagnostic,
  ScopeResolution,
  ScriptPosition,
} from "./types";

export const BUILTIN_SUBJECTS = ["cam", "flow", "var", "bg"] as const;

export class ScopeResolver {
  private readonly builtins: ReadonlySet<string>;
  private readonly definitions: DefinitionIndex;
  private readonly registry: ScopeCommandRegistryView;

  constructor(
    definitions: DefinitionIndex,
    registry: ScopeCommandRegistryView,
    builtins: readonly (typeof BUILTIN_SUBJECTS)[number][] = BUILTIN_SUBJECTS,
  ) {
    this.definitions = definitions;
    this.registry = registry;
    this.builtins = new Set(builtins);
  }

  public resolve(name: string, at: ScriptPosition, range: SourceRange): ScopeResolution {
    const definitions = this.definitions.named(name);
    const builtin = this.builtins.has(name);
    const commands = uniqueMatches(this.registry.find(name));
    const conflicts = this.conflictDiagnostics(name, definitions.length, builtin, commands, range);

    if (conflicts.length > 0) {
      return { status: "unresolved", reason: "conflict", diagnostics: conflicts };
    }

    if (definitions.length === 1) {
      const visible = this.definitions.visible(name, at);
      if (visible.length === 1) {
        return {
          status: "resolved",
          entity: { kind: "definition", definition: visible[0]! },
          diagnostics: [],
        };
      }
      return {
        status: "unresolved",
        reason: "out-of-scope",
        diagnostics: [{
          code: "scope-name-out-of-scope",
          severity: "error",
          message: `Name "${name}" exists, but its scene interval does not include this position.`,
          range: { ...range },
        }],
      };
    }

    if (builtin) {
      return {
        status: "resolved",
        entity: { kind: "builtin", name: name as "cam" | "flow" | "var" | "bg" },
        diagnostics: [],
      };
    }

    if (commands.length === 1) {
      return {
        status: "resolved",
        entity: { kind: "command-head", command: commands[0]! },
        diagnostics: [],
      };
    }

    return {
      status: "unresolved",
      reason: "unknown",
      diagnostics: [{
        code: "scope-unknown-name",
        severity: "error",
        message: `Name "${name}" is not defined, built in, or registered as a command.`,
        range: { ...range },
      }],
    };
  }

  public resolveCommand(name: string, range: SourceRange): {
    match: ScopeCommandMatch | null;
    diagnostics: ScopeDiagnostic[];
  } {
    const matches = uniqueMatches(this.registry.find(name));
    if (matches.length === 1) {
      return { match: matches[0]!, diagnostics: [] };
    }
    if (matches.length > 1) {
      return {
        match: null,
        diagnostics: [commandConflictDiagnostic(name, matches, range)],
      };
    }
    return {
      match: null,
      diagnostics: [{
        code: "scope-unknown-command",
        severity: "error",
        message: `Command "${name}" is not registered.`,
        range: { ...range },
      }],
    };
  }

  public audit(): readonly ScopeDiagnostic[] {
    const diagnostics = [...this.definitions.diagnosticsSnapshot()];
    const commandGroups = groupRegistryEntries(this.registry.list());

    for (const [name, matches] of commandGroups) {
      if (matches.length > 1) {
        diagnostics.push(commandConflictDiagnostic(name, matches, zeroRange()));
      }
    }

    for (const definition of this.definitions.all()) {
      const builtin = this.builtins.has(definition.name);
      const commands = commandGroups.get(definition.name) ?? [];
      if (builtin) {
        diagnostics.push({
          code: "scope-name-conflicts-builtin",
          severity: "error",
          message: `Definition "${definition.name}" conflicts with a built-in subject.`,
          range: { ...definition.declarationRange },
        });
      }
      if (commands.length > 0) {
        diagnostics.push({
          code: "scope-name-conflicts-command",
          severity: "error",
          message: `Definition "${definition.name}" conflicts with registered command family ${formatFamilies(commands)}.`,
          range: { ...definition.declarationRange },
        });
      }
    }

    return diagnostics;
  }

  private conflictDiagnostics(
    name: string,
    definitionCount: number,
    builtin: boolean,
    commands: readonly ScopeCommandMatch[],
    range: SourceRange,
  ): ScopeDiagnostic[] {
    const diagnostics: ScopeDiagnostic[] = [];
    if (definitionCount > 1) {
      diagnostics.push({
        code: "scope-duplicate-definition",
        severity: "error",
        message: `Name "${name}" has multiple definitions; KMD does not permit shadowing.`,
        range: { ...range },
      });
    }
    if (definitionCount > 0 && builtin) {
      diagnostics.push({
        code: "scope-name-conflicts-builtin",
        severity: "error",
        message: `Name "${name}" conflicts with a built-in subject.`,
        range: { ...range },
      });
    }
    if (definitionCount > 0 && commands.length > 0) {
      diagnostics.push({
        code: "scope-name-conflicts-command",
        severity: "error",
        message: `Name "${name}" conflicts with registered command family ${formatFamilies(commands)}.`,
        range: { ...range },
      });
    }
    if (commands.length > 1) {
      diagnostics.push(commandConflictDiagnostic(name, commands, range));
    }
    return diagnostics;
  }
}

function groupRegistryEntries(entries: readonly ScopeCommandMatch[]): Map<string, ScopeCommandMatch[]> {
  const groups = new Map<string, ScopeCommandMatch[]>();
  for (const entry of uniqueMatches(entries)) {
    const matches = groups.get(entry.name) ?? [];
    matches.push(entry);
    groups.set(entry.name, matches);
  }
  return groups;
}

function uniqueMatches(matches: readonly ScopeCommandMatch[]): ScopeCommandMatch[] {
  const unique = new Map<string, ScopeCommandMatch>();
  for (const match of matches) {
    unique.set(`${match.name}\u0000${match.family}`, match);
  }
  return [...unique.values()].sort((left, right) => left.family.localeCompare(right.family));
}

function commandConflictDiagnostic(
  name: string,
  matches: readonly ScopeCommandMatch[],
  range: SourceRange,
): ScopeDiagnostic {
  return {
    code: "scope-command-family-conflict",
    severity: "error",
    message: `Command "${name}" is registered in multiple families: ${formatFamilies(matches)}.`,
    range: { ...range },
  };
}

function formatFamilies(matches: readonly ScopeCommandMatch[]): string {
  return [...new Set(matches.map((match) => match.family))].sort().join(", ");
}

function zeroRange(): SourceRange {
  return { start: 0, end: 0 };
}
