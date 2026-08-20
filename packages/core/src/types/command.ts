export type CommandArgumentUnit =
  | "number"
  | "s"
  | "ms"
  | "char"
  | "line"
  | "self"
  | "px"
  | "deg";

/**
 * Semantic argument defaults live with command metadata. Positional entries
 * use zero-based source order; named entries take precedence for named args.
 */
export interface CommandArgumentUnits {
  positional?: readonly (CommandArgumentUnit | null)[];
  named?: Readonly<Record<string, CommandArgumentUnit>>;
}
