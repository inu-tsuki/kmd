import type { SourceRange } from "../types/diagnostics";

export interface StatePointValue {
  type: "point";
  x: number;
  y: number;
}

export interface StateDomainValue {
  type: "domain";
  start: StatePointValue;
  end: StatePointValue;
}

export type StateScalarValue = number | string | boolean;
export type StateValue = StateScalarValue | StatePointValue | StateDomainValue;
export type StateLevel = "document" | "scene";

export interface StateKey {
  level: StateLevel;
  name: string;
  qualifiedName: string;
  declarationRange: SourceRange;
}

export interface StateEntry {
  key: StateKey;
  value: StateValue;
}

export interface StateInspectionEntry {
  level: StateLevel;
  name: string;
  qualifiedName: string;
  value: StateValue;
}

export interface StateSnapshot {
  schemaVersion: 1;
  document: Record<string, StateValue>;
}

export type StateDiagnosticCode =
  | "state-invalid-value"
  | "state-invalid-snapshot"
  | "state-key-level-mismatch"
  | "state-invalid-patch"
  | "state-write-not-permitted";

export interface StateDiagnostic {
  code: StateDiagnosticCode;
  severity: "error";
  message: string;
  key: string | null;
}

export interface StateMutationResult {
  ok: boolean;
  diagnostics: StateDiagnostic[];
}

export interface StateReadView {
  get(key: StateKey): StateValue | undefined;
}

/**
 * Runtime carrier for Phase B bound state keys. Document values participate in
 * checkpoint snapshots; scene values are rebuilt from the current scene's
 * assignment seeds whenever that scene is entered.
 */
export class StateStore implements StateReadView {
  private documentValues = new Map<string, StateValue>();
  private sceneValues = new Map<string, StateValue>();

  public constructor(initialDocumentEntries: readonly StateEntry[] = []) {
    for (const entry of initialDocumentEntries) {
      const result = this.set(entry.key, entry.value);
      if (!result.ok) {
        throw new TypeError(result.diagnostics[0]?.message ?? "Invalid initial state entry.");
      }
    }
  }

  public get(key: StateKey): StateValue | undefined {
    const source = key.level === "document" ? this.documentValues : this.sceneValues;
    const value = source.get(key.qualifiedName);
    return value === undefined ? undefined : cloneStateValue(value);
  }

  public has(key: StateKey): boolean {
    const source = key.level === "document" ? this.documentValues : this.sceneValues;
    return source.has(key.qualifiedName);
  }

  public set(key: StateKey, value: StateValue): StateMutationResult {
    if (!keyMatchesLevel(key)) {
      return {
        ok: false,
        diagnostics: [{
          code: "state-key-level-mismatch",
          severity: "error",
          message: `State key "${key.qualifiedName}" does not match level "${key.level}".`,
          key: key.qualifiedName,
        }],
      };
    }
    if (!isStateValue(value)) {
      return {
        ok: false,
        diagnostics: [{
          code: "state-invalid-value",
          severity: "error",
          message: `State key "${key.qualifiedName}" received a non-serializable value.`,
          key: key.qualifiedName,
        }],
      };
    }

    const target = key.level === "document" ? this.documentValues : this.sceneValues;
    target.set(key.qualifiedName, cloneStateValue(value));
    return { ok: true, diagnostics: [] };
  }

  /**
   * Validates the complete module patch against the trusted compiler-bound
   * write set before committing any document value. A declared document key
   * may not have a value yet when its first assignment occurs after the active
   * interactive node, so declaration permission must not depend on Map state.
   * This prevents a later invalid entry from exposing earlier writes to the
   * live graph state.
   */
  public applyDocumentPatchAtomic(
    patch: unknown,
    writableKeys: readonly StateKey[],
  ): StateMutationResult {
    const diagnostics: StateDiagnostic[] = [];
    const writableByName = new Map<string, StateKey>();
    for (const key of writableKeys) {
      if (
        key.level !== "document"
        || !keyMatchesLevel(key)
        || writableByName.has(key.name)
      ) {
        diagnostics.push({
          code: "state-write-not-permitted",
          severity: "error",
          message: `State key "${key.qualifiedName}" is not a unique compiler-bound document write target.`,
          key: key.qualifiedName,
        });
        continue;
      }
      writableByName.set(key.name, key);
    }
    if (!isPlainStatePatch(patch)) {
      diagnostics.push({
        code: "state-invalid-patch",
        severity: "error",
        message: "Document state patch must be a plain key-value object.",
        key: null,
      });
      return { ok: false, diagnostics };
    }

    const pending = new Map<string, StateValue>();
    for (const [name, value] of Object.entries(patch)) {
      const key = writableByName.get(name);
      if (key === undefined) {
        diagnostics.push({
          code: "state-write-not-permitted",
          severity: "error",
          message: `Document state patch cannot write undeclared or unauthorized key "${name}".`,
          key: name,
        });
        continue;
      }
      if (!isStateValue(value)) {
        diagnostics.push({
          code: "state-invalid-value",
          severity: "error",
          message: `Document state patch key "${name}" received a non-serializable value.`,
          key: key.qualifiedName,
        });
        continue;
      }
      pending.set(key.qualifiedName, cloneStateValue(value));
    }
    if (diagnostics.length > 0) return { ok: false, diagnostics };

    for (const [qualifiedName, value] of pending) {
      this.documentValues.set(qualifiedName, value);
    }
    return { ok: true, diagnostics: [] };
  }

  public enterScene(entries: readonly StateEntry[] = []): StateMutationResult {
    const next = new Map<string, StateValue>();
    const diagnostics: StateDiagnostic[] = [];
    for (const entry of entries) {
      if (entry.key.level !== "scene" || !keyMatchesLevel(entry.key)) {
        diagnostics.push({
          code: "state-key-level-mismatch",
          severity: "error",
          message: `Scene seed "${entry.key.qualifiedName}" must use a scene-level key.`,
          key: entry.key.qualifiedName,
        });
        continue;
      }
      if (!isStateValue(entry.value)) {
        diagnostics.push({
          code: "state-invalid-value",
          severity: "error",
          message: `Scene seed "${entry.key.qualifiedName}" is not serializable.`,
          key: entry.key.qualifiedName,
        });
        continue;
      }
      next.set(entry.key.qualifiedName, cloneStateValue(entry.value));
    }
    if (diagnostics.length > 0) return { ok: false, diagnostics };
    this.sceneValues = next;
    return { ok: true, diagnostics: [] };
  }

  public clearScene(): void {
    this.sceneValues.clear();
  }

  public snapshot(): StateSnapshot {
    const document: Record<string, StateValue> = {};
    for (const key of [...this.documentValues.keys()].sort()) {
      document[key] = cloneStateValue(this.documentValues.get(key)!);
    }
    return { schemaVersion: 1, document };
  }

  public restore(snapshot: unknown): StateMutationResult {
    const validated = validateSnapshot(snapshot);
    if (!validated.ok) return validated;

    const next = new Map<string, StateValue>();
    for (const [key, value] of Object.entries(validated.snapshot.document)) {
      next.set(key, cloneStateValue(value));
    }
    this.documentValues = next;
    return { ok: true, diagnostics: [] };
  }

  public entries(level: StateLevel): StateInspectionEntry[] {
    const source = level === "document" ? this.documentValues : this.sceneValues;
    return [...source.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([qualifiedName, value]) => ({
        level,
        name: level === "document"
          ? qualifiedName.slice("var.".length)
          : sceneNameFromQualified(qualifiedName),
        qualifiedName,
        value: cloneStateValue(value),
      }));
  }
}

export function isStateValue(value: unknown): value is StateValue {
  if (typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  const point = exactDataRecord(value, ["type", "x", "y"]);
  if (point !== null && point.type === "point") {
    return isFiniteCoordinate(point.x) && isFiniteCoordinate(point.y);
  }
  const domain = exactDataRecord(value, ["type", "start", "end"]);
  if (domain !== null && domain.type === "domain") {
    return isStatePoint(domain.start) && isStatePoint(domain.end);
  }
  return false;
}

export function cloneStateValue(value: StateValue): StateValue {
  if (typeof value !== "object") return value;
  if (value.type === "point") return cloneStatePoint(value);
  return {
    type: "domain",
    start: cloneStatePoint(value.start),
    end: cloneStatePoint(value.end),
  };
}

type SnapshotValidation =
  | { ok: true; diagnostics: []; snapshot: StateSnapshot }
  | { ok: false; diagnostics: StateDiagnostic[] };

function validateSnapshot(snapshot: unknown): SnapshotValidation {
  if (
    snapshot === null
    || typeof snapshot !== "object"
    || Array.isArray(snapshot)
    || (snapshot as { schemaVersion?: unknown }).schemaVersion !== 1
  ) {
    return invalidSnapshot("State snapshot must use schemaVersion 1.");
  }
  const document = (snapshot as { document?: unknown }).document;
  if (document === null || typeof document !== "object" || Array.isArray(document)) {
    return invalidSnapshot("State snapshot document payload must be an object.");
  }
  for (const [key, value] of Object.entries(document)) {
    if (!key.startsWith("var.") || key.length === "var.".length || !isStateValue(value)) {
      return invalidSnapshot(`State snapshot entry "${key}" is invalid.`, key);
    }
  }
  return { ok: true, diagnostics: [], snapshot: snapshot as StateSnapshot };
}

function invalidSnapshot(
  message: string,
  key: string | null = null,
): Extract<SnapshotValidation, { ok: false }> {
  return {
    ok: false,
    diagnostics: [{
      code: "state-invalid-snapshot",
      severity: "error",
      message,
      key,
    }],
  };
}

function keyMatchesLevel(key: StateKey): boolean {
  if (key.level === "document") return key.qualifiedName === `var.${key.name}`;
  const prefix = "scene:";
  const suffix = `:${key.name}`;
  if (!key.qualifiedName.startsWith(prefix) || !key.qualifiedName.endsWith(suffix)) return false;
  const offset = key.qualifiedName.slice(prefix.length, -suffix.length);
  return /^\d+$/u.test(offset) && Number.isSafeInteger(Number(offset));
}

function isStatePoint(value: unknown): value is StatePointValue {
  const record = exactDataRecord(value, ["type", "x", "y"]);
  return record !== null
    && record.type === "point"
    && isFiniteCoordinate(record.x)
    && isFiniteCoordinate(record.y);
}

function isFiniteCoordinate(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isPlainStatePatch(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return false;
  return Reflect.ownKeys(value).every((key) => {
    if (typeof key !== "string") return false;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor !== undefined
      && descriptor.enumerable
      && "value" in descriptor;
  });
}

/** Reads descriptors before values so an untrusted accessor is never invoked. */
function exactDataRecord(
  value: unknown,
  expectedKeys: readonly string[],
): Record<string, unknown> | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return null;

  const expected = new Set(expectedKeys);
  const ownKeys = Reflect.ownKeys(value);
  if (ownKeys.length !== expected.size) return null;
  for (const key of ownKeys) {
    if (typeof key !== "string" || !expected.has(key)) return null;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor === undefined || !descriptor.enumerable || !("value" in descriptor)) return null;
  }
  return value as Record<string, unknown>;
}

function cloneStatePoint(value: StatePointValue): StatePointValue {
  return { type: "point", x: value.x, y: value.y };
}

function sceneNameFromQualified(qualifiedName: string): string {
  return qualifiedName.slice(qualifiedName.lastIndexOf(":") + 1);
}
