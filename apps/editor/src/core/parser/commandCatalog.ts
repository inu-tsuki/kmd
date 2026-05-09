import { effectManager } from "../effects/EffectManager";
import { styleManager } from "../effects/StyleManager";
import { layoutManager } from "../layout/LayoutManager";
import { stageManager } from "../stage/StageManager";
import type { CommandFamily, ParsedCommand } from "./types";

export interface CommandRegistryView {
  has(name: string): boolean;
  getFamily(name: string): CommandFamily;
  getMetadata(name: string): Record<string, unknown> | undefined;
}

export interface CommandSemanticInfo {
  family: CommandFamily;
  targetType: "char" | "group" | "both" | "container" | "unknown";
  containerCompatible: boolean;
  supportsBroadcast: boolean;
  known: boolean;
}

export function createRuntimeCommandRegistryView(): CommandRegistryView {
  return {
    has(name: string) {
      return (
        styleManager.has(name) ||
        effectManager.has(name) ||
        layoutManager.has(name) ||
        stageManager.has(name)
      );
    },
    getFamily(name: string): CommandFamily {
      if (styleManager.has(name)) return "style";
      if (effectManager.has(name)) return "effect";
      if (layoutManager.has(name)) return "layout";
      if (stageManager.has(name)) return "stage";
      return "unknown";
    },
    getMetadata(name: string) {
      const family = this.getFamily(name);
      if (family === "style") return styleManager.getMetadata(name) as Record<string, unknown> | undefined;
      if (family === "effect") return effectManager.getMetadata(name) as Record<string, unknown> | undefined;
      return undefined;
    },
  };
}

export const runtimeCommandRegistryView = createRuntimeCommandRegistryView();

export function resolveCommandFamily(name: string, registryView: CommandRegistryView = runtimeCommandRegistryView): CommandFamily {
  return registryView.getFamily(name);
}

export function getCommandSemanticInfo(
  name: string,
  registryView: CommandRegistryView = runtimeCommandRegistryView,
): CommandSemanticInfo {
  const family = resolveCommandFamily(name, registryView);
  if (!registryView.has(name) || family === "unknown") {
    return {
      family: "unknown",
      targetType: "unknown",
      containerCompatible: false,
      supportsBroadcast: false,
      known: false,
    };
  }

  if (family === "layout") {
    return {
      family,
      targetType: "container",
      containerCompatible: true,
      supportsBroadcast: false,
      known: true,
    };
  }

  if (family === "stage") {
    return {
      family,
      targetType: "container",
      containerCompatible: true,
      supportsBroadcast: false,
      known: true,
    };
  }

  const meta = registryView.getMetadata(name);
  const targetType = (meta?.targetType as CommandSemanticInfo["targetType"] | undefined) ?? (family === "style" ? "char" : "unknown");

  return {
    family,
    targetType,
    containerCompatible: targetType === "group" || targetType === "both",
    supportsBroadcast: true,
    known: true,
  };
}

export function attachCommandFamily<T extends { name: string }>(
  command: T,
  registryView: CommandRegistryView = runtimeCommandRegistryView,
): T & Pick<ParsedCommand, "family"> {
  return {
    ...command,
    family: resolveCommandFamily(command.name, registryView),
  };
}
