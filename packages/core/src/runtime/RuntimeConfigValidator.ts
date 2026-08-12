// KMD runtime 配置防火墙（主题二 S4a：处方 10 前半）。
//
// Android WebView 宿主经 window.KmdRuntimeConfig / updateSettings 命令注入的配置是
// 不可信输入：垃圾配置必须扛住（boot 不崩、播放不裂）。失败语义（用户裁决）：
//   - strip-unknown：未知字段静默剥离（console 诊断，不发错误事件）。
//   - 逐字段类型回退：单个字段类型错误只剥该字段，不连坐整份配置。
//   - 永不抛：safeParse 逐字段消解；非 record 根 → 空配置 + 诊断。
//   - 不做语义 coercion：debugOverlay:"true" 丢弃而非强转——coercion 即行为变更。
//
// reader-hostable 约束：无 window 访问（setup.ts 不 stub window）、无 Vue import。
//
// ## 构建期漂移守卫
// schema 与契约（ReaderRuntimeContract.ts）双向严格等价检查——契约改了忘改 schema
// 则 build 红（`pnpm build` 与 `pnpm reader:typecheck` 都过这条模块）。
// settings 镜像 ReaderRuntimeSettings（:108-122）；options 镜像 ReaderRuntimeOptions
// 去 callbacks（:276-285）——callbacks 由宿主 session 注入，不经配置面。

import { z } from "zod";
import type {
  ReaderRuntimeOptions,
  ReaderRuntimeSettings,
} from "./ReaderRuntimeContract";

const typographySchema = z.object({
  scale: z.number().optional(),
  fontFamily: z.string().optional(),
  fontSize: z.number().optional(),
  fontWeight: z.union([z.string(), z.number()]).optional(),
  fontStyle: z.string().optional(),
  fill: z.union([z.string(), z.number()]).optional(),
  lineHeight: z.number().optional(),
  letterSpacing: z.number().optional(),
  align: z.enum(["left", "center", "right", "justify"]).optional(),
});

const viewportSchema = z.object({
  width: z.number(),
  height: z.number(),
  devicePixelRatio: z.number().optional(),
  backgroundColor: z.union([z.string(), z.number()]).optional(),
});

const fontAssetSchema = z.object({
  family: z.string(),
  url: z.string(),
  weight: z.union([z.string(), z.number()]).optional(),
  style: z.string().optional(),
  display: z.enum(["auto", "block", "swap", "fallback", "optional"]).optional(),
});

const assetRefSchema = z.object({
  url: z.string(),
  type: z.enum(["font", "image", "shader", "audio", "video", "data"]).optional(),
  integrity: z.string().optional(),
  metadata: z.record(z.unknown()).optional(),
});

const assetManifestSchema = z.object({
  baseUrl: z.string().optional(),
  fonts: z.array(fontAssetSchema).optional(),
  assets: z.record(assetRefSchema).optional(),
});

const presentationModeSchema = z.enum(["stage", "scroll", "page"]);

export const readerRuntimeSettingsSchema = z.object({
  reducedMotion: z.boolean().optional(),
  fontScale: z.number().optional(),
  timeScale: z.number().optional(),
  theme: z.string().optional(),
  quality: z.enum(["low", "balanced", "high"]).optional(),
  interactionEnabled: z.boolean().optional(),
  debugOverlay: z.boolean().optional(),
  typography: typographySchema.optional(),
  viewport: viewportSchema.optional(),
  presentationMode: presentationModeSchema.optional(),
  assetBaseUrl: z.string().optional(),
  fontManifest: z.array(fontAssetSchema).optional(),
  assetManifest: assetManifestSchema.optional(),
});

const capabilitiesSchema = z.object({
  protocolVersion: z.literal(1).optional(),
  supportsSourceText: z.boolean().optional(),
  supportsSourceUrl: z.boolean().optional(),
  supportsAssetManifest: z.boolean().optional(),
  supportsSeekTime: z.boolean().optional(),
  supportsTimelineMarkers: z.boolean().optional(),
  supportsInspection: z.boolean().optional(),
  supportsInteractiveSegments: z.boolean().optional(),
});

export const readerRuntimeOptionsSchema = z.object({
  assetBaseUrl: z.string().optional(),
  typography: typographySchema.optional(),
  viewport: viewportSchema.optional(),
  presentationMode: presentationModeSchema.optional(),
  fontManifest: z.array(fontAssetSchema).optional(),
  assetManifest: assetManifestSchema.optional(),
  settings: readerRuntimeSettingsSchema.optional(),
  capabilities: capabilitiesSchema.optional(),
});

// ── 构建期漂移守卫 ──────────────────────────────────────────────
// StrictEqual = 双向严格等价（比双向可赋值更强：捕获可选字段的增删）。
type StrictEqual<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2)
  ? true
  : false;

// AssertTrue 走泛型约束而非 `as`——`true as false` 在 TS 里合法（boolean 重叠），
// 只有约束违反才硬报错。任一方向漂移 → TS2344 → build 红（探针验证）。
type AssertTrue<T extends true> = T;
export type SettingsSchemaDriftGuard = AssertTrue<
  StrictEqual<z.infer<typeof readerRuntimeSettingsSchema>, ReaderRuntimeSettings>
>;
export type OptionsSchemaDriftGuard = AssertTrue<
  StrictEqual<z.infer<typeof readerRuntimeOptionsSchema>, Omit<ReaderRuntimeOptions, "callbacks">>
>;

// ── sanitize 引擎 ──────────────────────────────────────────────

export interface SanitizeResult<T> {
  value: T;
  diagnostics: string[];
}

// 原型污染防火墙：host 配置是 WebView 注入的不可信输入，这三个键一律剥离。
// 计算键写法：字面量 __proto__/constructor 在对象字面量里被 TS/JS 特殊处理。
const FORBIDDEN_KEYS: Record<string, boolean> = {
  ["__proto__"]: true,
  ["constructor"]: true,
  ["prototype"]: true,
};

function describeValue(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

function summarizeError(error: z.ZodError): string {
  const first = error.issues[0];
  if (!first) return "unknown issue";
  const path = first.path.length > 0 ? `${first.path.join(".")}: ` : "";
  return `${path}${first.message}`;
}

/**
 * 逐字段 sanitize：shape 内每个键独立 safeParse——单字段类型错误只剥该字段。
 * 未知键与禁止键剥离并记诊断。嵌套 ZodObject 递归逐字段（子对象内坏字段只剥子字段，
 * 不连坐整个子对象）。永不抛。
 *
 * 注：此处用显式 record 守卫 + 逐字段 safeParse 而非 schema.parse 一次性校验——
 * 后者是 per-nesting-level 全有或全无（一个垃圾字段连坐整份 settings），
 * 与处方要求的"逐字段类型回退"语义不符。
 */
function unwrapOptionalObject(schema: z.ZodTypeAny): z.ZodObject<z.ZodRawShape> | undefined {
  const inner = schema instanceof z.ZodOptional ? schema.unwrap() : schema;
  return inner instanceof z.ZodObject ? inner : undefined;
}
function sanitizeFields(
  shape: z.ZodRawShape,
  input: unknown,
  label: string,
): { value: Record<string, unknown>; diagnostics: string[] } {
  const diagnostics: string[] = [];
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    diagnostics.push(`${label} is not a plain object (got ${describeValue(input)}); using empty ${label}.`);
    return { value: {}, diagnostics };
  }
  const value: Record<string, unknown> = {};
  for (const [key, raw] of Object.entries(input as Record<string, unknown>)) {
    if (FORBIDDEN_KEYS[key]) {
      diagnostics.push(`${label}.${key} is a forbidden key; stripped.`);
      continue;
    }
    const fieldSchema: z.ZodTypeAny | undefined = shape[key];
    if (!fieldSchema) {
      diagnostics.push(`${label}.${key} is unknown; stripped.`);
      continue;
    }
    const nestedObject = unwrapOptionalObject(fieldSchema);
    if (nestedObject && typeof raw === "object" && raw !== null && !Array.isArray(raw)) {
      // 嵌套对象递归逐字段——子对象内坏字段只剥子字段，不连坐整个子对象。
      const nested = sanitizeFields(nestedObject.shape, raw, `${label}.${key}`);
      value[key] = nested.value;
      diagnostics.push(...nested.diagnostics);
      continue;
    }
    const result = fieldSchema.safeParse(raw);
    if (result.success) {
      value[key] = result.data;
    } else {
      diagnostics.push(`${label}.${key} is invalid (${summarizeError(result.error)}); stripped.`);
    }
  }
  return { value, diagnostics };
}

/**
 * sanitize ReaderRuntimeSettings（updateSettings payload 防火墙）。
 * 逐字段类型回退 + strip-unknown + 永不抛。
 */
export function sanitizeReaderRuntimeSettings(input: unknown): SanitizeResult<ReaderRuntimeSettings> {
  const { value, diagnostics } = sanitizeFields(readerRuntimeSettingsSchema.shape, input, "settings");
  return { value: value as ReaderRuntimeSettings, diagnostics };
}

/**
 * sanitize boot 配置（window.KmdRuntimeConfig，镜像 ReaderRuntimeOptions 去 callbacks）。
 * settings 子树走逐字段 sanitize（嵌套垃圾只剥嵌套字段，不连坐整个 settings）。
 * 注意：main.ts 的 boot 侧扩展字段（如 autoDemo）属宿主私有配置，不经此函数——
 * 调用方先拆出宿主字段，再对剩余部分调本函数。
 */
export function sanitizeKmdRuntimeConfig(input: unknown): SanitizeResult<ReaderRuntimeOptions> {
  const diagnostics: string[] = [];
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    diagnostics.push(`config is not a plain object (got ${describeValue(input)}); using empty config.`);
    return { value: {}, diagnostics };
  }
  const record = input as Record<string, unknown>;
  // settings 子树单独走逐字段 sanitize（嵌套垃圾只剥嵌套字段，不连坐整个 settings）——
  // 先拆出再剥 settings 键，避免外层循环按整体 schema 校验时连坐。
  const hasSettings = "settings" in record;
  const { settings: _settings, ...rest } = record;
  const { shape } = readerRuntimeOptionsSchema;
  const { settings: _omit, ...outerShape } = shape;
  const outer = sanitizeFields(outerShape, rest, "config");
  diagnostics.push(...outer.diagnostics);
  const value: Record<string, unknown> = { ...outer.value };
  if (hasSettings) {
    const nested = sanitizeReaderRuntimeSettings(_settings);
    value.settings = nested.value;
    diagnostics.push(...nested.diagnostics);
  }
  return { value: value as ReaderRuntimeOptions, diagnostics };
}
