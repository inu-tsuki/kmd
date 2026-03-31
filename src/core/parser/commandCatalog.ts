import { effectManager } from "../effects/EffectManager";
import { styleManager } from "../effects/StyleManager";
import { layoutManager } from "../layout/LayoutManager";
import { stageManager } from "../stage/StageManager";
import type { CommandFamily, ParsedCommand } from "./types";

export interface CommandSemanticInfo {
  family: CommandFamily;
  targetType: "char" | "group" | "both" | "container" | "unknown";
  containerCompatible: boolean;
  supportsBroadcast: boolean;
  known: boolean;
}

export function resolveCommandFamily(name: string): CommandFamily {
  if (styleManager.has(name)) return "style";
  if (effectManager.has(name)) return "effect";
  if (layoutManager.has(name)) return "layout";
  if (stageManager.has(name)) return "stage";
  return "unknown";
}

export function getCommandSemanticInfo(name: string): CommandSemanticInfo {
  const family = resolveCommandFamily(name);
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

  if (family === "style") {
    const meta = styleManager.getMetadata(name);
    const targetType = meta?.targetType ?? "char";
    return {
      family,
      targetType,
      containerCompatible: targetType === "group" || targetType === "both",
      supportsBroadcast: true,
      known: true,
    };
  }

  if (family === "effect") {
    const meta = effectManager.getMetadata(name);
    const targetType = meta?.targetType ?? "unknown";
    return {
      family,
      targetType,
      containerCompatible: targetType === "group" || targetType === "both",
      supportsBroadcast: true,
      known: true,
    };
  }

  return {
    family: "unknown",
    targetType: "unknown",
    containerCompatible: false,
    supportsBroadcast: false,
    known: false,
  };
}

export function attachCommandFamily<T extends { name: string }>(command: T): T & Pick<ParsedCommand, "family"> {
  return {
    ...command,
    family: resolveCommandFamily(command.name),
  };
}
