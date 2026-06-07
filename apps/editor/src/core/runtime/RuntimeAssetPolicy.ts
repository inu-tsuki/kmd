import type {
  ReaderRuntimeAssetManifest,
  ReaderRuntimeFontAsset,
} from "./ReaderRuntimeContract";

export const DEFAULT_READER_FONT_MANIFEST: ReaderRuntimeFontAsset[] = [
  { family: "LXGW WenKai", url: "fonts/LXGWWenKai-Regular.ttf" },
  { family: "Sasara Regular", url: "fonts/SarasaGothicSC-Regular.ttf" },
  { family: "Smiley Sans", url: "fonts/SmileySans-Oblique.ttf" },
  { family: "Fira Code", url: "fonts/FiraCode-Regular.ttf" },
];

export interface RuntimeAssetContext {
  assetBaseUrl?: string;
  fontManifest?: ReaderRuntimeFontAsset[];
  assetManifest?: ReaderRuntimeAssetManifest;
}

export function getEffectiveAssetBaseUrl(context: RuntimeAssetContext) {
  return context.assetManifest?.baseUrl ?? context.assetBaseUrl;
}

export function resolveRuntimeAssetUrl(url: string, context: RuntimeAssetContext = {}) {
  const assetBaseUrl = getEffectiveAssetBaseUrl(context);
  const baseUrl = resolveBaseUrl(assetBaseUrl || (typeof document !== "undefined" ? document.baseURI : undefined));
  if (!baseUrl) return url;

  const normalizedUrl = assetBaseUrl && url.startsWith("/") ? url.slice(1) : url;
  return new URL(normalizedUrl, ensureTrailingSlash(baseUrl)).toString();
}

export function resolveControlledSourceUrl(sourceUrl: string, context: RuntimeAssetContext = {}) {
  const resolved = resolveRuntimeAssetUrl(sourceUrl, context);
  const assetBaseUrl = getEffectiveAssetBaseUrl(context);

  if (assetBaseUrl && isWithinBaseUrl(resolved, assetBaseUrl)) {
    return resolved;
  }

  const parsed = new URL(resolved, typeof document !== "undefined" ? document.baseURI : undefined);
  if (parsed.protocol === "https:") {
    return parsed.toString();
  }

  if (isSameOrigin(parsed) && (parsed.protocol === "http:" || parsed.protocol === "https:")) {
    return parsed.toString();
  }

  throw new Error(`Blocked uncontrolled sourceUrl: ${sourceUrl}`);
}

export function collectRuntimeFonts(context: RuntimeAssetContext) {
  const hostFonts = [
    ...(context.assetManifest?.fonts ?? []),
    ...(context.fontManifest ?? []),
  ];
  if (hostFonts.length > 0) {
    return hostFonts;
  }

  if (shouldSkipDefaultFontsForAndroidWebView()) {
    return [];
  }

  return DEFAULT_READER_FONT_MANIFEST;
}

function shouldSkipDefaultFontsForAndroidWebView() {
  if (typeof navigator === "undefined" || !/Android/i.test(navigator.userAgent ?? "")) {
    return false;
  }

  try {
    const params = new URLSearchParams(globalThis.location?.search ?? "");
    return params.get("kmdLoadDefaultFonts") !== "1";
  } catch {
    return true;
  }
}

function ensureTrailingSlash(url: string) {
  return url.endsWith("/") ? url : `${url}/`;
}

function isWithinBaseUrl(resolvedUrl: string, baseUrl: string) {
  const resolvedBaseUrl = resolveBaseUrl(baseUrl);
  if (!resolvedBaseUrl) return false;
  const resolvedBase = new URL(ensureTrailingSlash(resolvedBaseUrl)).toString();
  return resolvedUrl.startsWith(resolvedBase);
}

function resolveBaseUrl(baseUrl?: string) {
  if (!baseUrl) return undefined;
  try {
    return new URL(baseUrl).toString();
  } catch {
    if (typeof document === "undefined") return baseUrl;
    return new URL(baseUrl, document.baseURI).toString();
  }
}

function isSameOrigin(url: URL) {
  if (typeof window === "undefined") return false;
  return url.origin === window.location.origin;
}
