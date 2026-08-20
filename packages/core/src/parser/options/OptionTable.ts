import type {
  OptionDefinition,
  OptionDiagnostic,
  OptionPatchEntry,
  OptionResolution,
  OptionSchema,
  OptionValue,
} from "./types";

const positiveNumber: OptionDefinition = {
  scope: "cascading",
  validate: (value: unknown): value is number => (
    typeof value === "number" && Number.isFinite(value) && value > 0
  ),
};

const finiteNumber: OptionDefinition = {
  scope: "cascading",
  validate: (value: unknown): value is number => (
    typeof value === "number" && Number.isFinite(value)
  ),
};

const text: OptionDefinition = {
  scope: "cascading",
  validate: (value: unknown): value is string => typeof value === "string",
};

const documentText: OptionDefinition = { ...text, scope: "document-only" };
const documentPositiveNumber: OptionDefinition = { ...positiveNumber, scope: "document-only" };

export const PHASE_B_OPTION_SCHEMA = {
  title: documentText,
  author: documentText,
  kmdVersion: documentText,
  mode: {
    scope: "document-only",
    validate: (value: unknown): value is string => (
      value === "stage" || value === "scroll" || value === "page"
    ),
  },
  designWidth: documentPositiveNumber,
  designHeight: documentPositiveNumber,
  speed: positiveNumber,
  maxWidth: positiveNumber,
  fontSize: positiveNumber,
  lineHeight: positiveNumber,
  indent: finiteNumber,
  letterSpacing: finiteNumber,
  align: {
    scope: "cascading",
    validate: (value: unknown): value is string => (
      value === "left" || value === "center" || value === "right"
    ),
  },
  bgColor: text,
  fontColor: text,
  fontFamily: text,
} satisfies OptionSchema;

/**
 * Immutable two-level option cascade. Every paragraph resolution starts from
 * the same document snapshot, so paragraph patches cannot leak forward.
 */
export class OptionTable {
  private readonly schema: OptionSchema;
  private readonly documentValues: Readonly<Record<string, OptionValue>>;
  private readonly documentDiagnostics: OptionDiagnostic[];

  public constructor(
    engineDefaults: Readonly<Record<string, OptionValue>>,
    documentOptions: readonly OptionPatchEntry[],
    schema: OptionSchema = PHASE_B_OPTION_SCHEMA,
  ) {
    this.schema = schema;
    const values: Record<string, OptionValue> = { ...engineDefaults };
    const diagnostics: OptionDiagnostic[] = [];
    for (const entry of documentOptions) {
      const normalized = normalizeDocumentEntry(entry, schema);
      diagnostics.push(...normalized.diagnostics);
      if (normalized.value !== null) values[entry.key] = normalized.value;
    }
    this.documentValues = Object.freeze({ ...values });
    this.documentDiagnostics = diagnostics;
  }

  public document(): OptionResolution {
    return {
      values: { ...this.documentValues },
      diagnostics: this.documentDiagnostics.map((entry) => ({ ...entry, range: { ...entry.range } })),
    };
  }

  public resolveParagraph(patch: readonly OptionPatchEntry[]): OptionResolution {
    const values: Record<string, OptionValue> = { ...this.documentValues };
    const diagnostics: OptionDiagnostic[] = [];
    for (const entry of patch) {
      const definition = this.schema[entry.key];
      if (definition === undefined) {
        diagnostics.push({
          code: "option-unknown-paragraph-key",
          severity: "warning",
          message: `Unknown paragraph option "${entry.key}" is ignored.`,
          range: { ...entry.range },
        });
        continue;
      }
      if (definition.scope === "document-only") {
        diagnostics.push({
          code: "option-document-only",
          severity: "error",
          message: `Option "${entry.key}" can only be set in document frontmatter.`,
          range: { ...entry.range },
        });
        continue;
      }
      if (!definition.validate(entry.value)) {
        diagnostics.push(invalidValue(entry));
        continue;
      }
      values[entry.key] = entry.value;
    }
    return { values, diagnostics };
  }
}

function normalizeDocumentEntry(
  entry: OptionPatchEntry,
  schema: OptionSchema,
): { value: OptionValue | null; diagnostics: OptionDiagnostic[] } {
  if (entry.key === "mode" && entry.value === "paged") {
    return {
      value: "page",
      diagnostics: [{
        code: "option-normalized-alias",
        severity: "warning",
        message: "Document mode alias \"paged\" is normalized to \"page\".",
        range: { ...entry.range },
      }],
    };
  }
  if (entry.key === "mode" && entry.value === "interactive") {
    return {
      value: "stage",
      diagnostics: [{
        code: "option-unsupported-mode",
        severity: "warning",
        message: "Document mode \"interactive\" is unsupported and falls back to \"stage\".",
        range: { ...entry.range },
      }],
    };
  }

  const definition = schema[entry.key];
  if (definition === undefined) {
    if (isOptionValue(entry.value)) return { value: entry.value, diagnostics: [] };
    return { value: null, diagnostics: [invalidValue(entry)] };
  }
  if (!definition.validate(entry.value)) {
    return { value: null, diagnostics: [invalidValue(entry)] };
  }
  return { value: entry.value, diagnostics: [] };
}

function invalidValue(entry: OptionPatchEntry): OptionDiagnostic {
  return {
    code: "option-invalid-value",
    severity: "error",
    message: `Option "${entry.key}" has an invalid value.`,
    range: { ...entry.range },
  };
}

function isOptionValue(value: unknown): value is OptionValue {
  return typeof value === "string"
    || typeof value === "boolean"
    || (typeof value === "number" && Number.isFinite(value));
}
