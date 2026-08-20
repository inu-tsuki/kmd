import { effectManager } from "../../effects/EffectManager";
import { styleManager } from "../../effects/StyleManager";
import { layoutManager } from "../../layout/LayoutManager";
import { stageManager } from "../../stage/StageManager";
import type {
  ScopeCommandFamily,
  ScopeCommandMatch,
  ScopeCommandRegistryView,
} from "./types";

export function createStaticScopeCommandRegistryView(
  entries: readonly ScopeCommandMatch[],
): ScopeCommandRegistryView {
  const normalized = normalizeEntries(entries);
  const byName = new Map<string, ScopeCommandMatch[]>();
  for (const entry of normalized) {
    const matches = byName.get(entry.name) ?? [];
    matches.push(entry);
    byName.set(entry.name, matches);
  }

  return {
    find(name: string): readonly ScopeCommandMatch[] {
      return byName.get(name) ?? [];
    },
    list(): readonly ScopeCommandMatch[] {
      return normalized;
    },
  };
}

export function createRuntimeScopeCommandRegistryView(): ScopeCommandRegistryView {
  return {
    find(name: string): readonly ScopeCommandMatch[] {
      return collectRuntimeEntries().filter((entry) => entry.name === name);
    },
    list(): readonly ScopeCommandMatch[] {
      return collectRuntimeEntries();
    },
  };
}

function collectRuntimeEntries(): ScopeCommandMatch[] {
  const entries: ScopeCommandMatch[] = [];
  appendManagerEntries(entries, "style", styleManager.getRegisteredNames(), (name) => styleManager.getMetadata(name));
  appendManagerEntries(entries, "effect", effectManager.getRegisteredNames(), (name) => effectManager.getMetadata(name));
  appendManagerEntries(entries, "layout", layoutManager.getRegisteredNames(), (name) => layoutManager.getMetadata(name) ?? undefined);
  appendManagerEntries(entries, "stage", stageManager.getRegisteredNames(), (name) => stageManager.getCommandMetadata(name) ?? undefined);
  return normalizeEntries(entries);
}

function appendManagerEntries(
  target: ScopeCommandMatch[],
  family: ScopeCommandFamily,
  names: readonly string[],
  metadata: (name: string) => unknown,
): void {
  for (const name of names) {
    const value = metadata(name);
    target.push({
      name,
      family,
      ...(isMetadata(value) ? { metadata: value } : {}),
    });
  }
}

function normalizeEntries(entries: readonly ScopeCommandMatch[]): ScopeCommandMatch[] {
  const deduplicated = new Map<string, ScopeCommandMatch>();
  for (const entry of entries) {
    deduplicated.set(`${entry.name}\u0000${entry.family}`, { ...entry });
  }
  return [...deduplicated.values()].sort((left, right) => (
    left.name.localeCompare(right.name) || left.family.localeCompare(right.family)
  ));
}

function isMetadata(value: unknown): value is Readonly<Record<string, unknown>> {
  return value !== null && typeof value === "object";
}

export const runtimeScopeCommandRegistryView = createRuntimeScopeCommandRegistryView();
