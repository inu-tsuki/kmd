import type { CommandArgumentUnit } from "../../types/command";
import type { SemanticBoundValue } from "./types";

export function bindNumberWithDefaultUnit(
  value: number,
  expectedUnit: CommandArgumentUnit | null,
): SemanticBoundValue {
  if (expectedUnit === null || expectedUnit === "number") return { type: "number", value };
  if (expectedUnit === "s" || expectedUnit === "ms") {
    return {
      type: "time",
      seconds: expectedUnit === "s" ? value : value / 1000,
      sourceUnit: expectedUnit,
      defaultUnitApplied: true,
    };
  }
  if (expectedUnit === "deg") {
    return { type: "angle", value, unit: "deg", defaultUnitApplied: true };
  }
  return { type: "space", value, unit: expectedUnit, defaultUnitApplied: true };
}
