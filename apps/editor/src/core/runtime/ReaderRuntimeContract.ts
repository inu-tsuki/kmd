import type { DiagnosticEvent } from "../types/diagnostics";

export type ReaderRuntimeProtocolVersion = 1;

export type ReaderRuntimePresentationMode = "stage" | "scroll" | "page";

export type ReaderRuntimePlaybackState =
  | "idle"
  | "loading"
  | "ready"
  | "playing"
  | "paused"
  | "ended"
  | "error";

export type ReaderRuntimeInspectMode = "quick" | "full" | "performance";

export type ReaderRuntimeCommandType =
  | "loadScript"
  | "play"
  | "pause"
  | "seek"
  | "setInspectionEnabled"
  | "updateSettings"
  | "dispose";

export type ReaderRuntimeEventType =
  | "runtimeReady"
  | "ready"
  | "progressChanged"
  | "playbackStateChanged"
  | "inspectionReported"
  | "error";

export interface ReaderRuntimeEnvelope<TPayload = unknown> {
  version: ReaderRuntimeProtocolVersion;
  id?: string;
  sessionId?: string;
  type: string;
  payload?: TPayload;
}

export interface ReaderRuntimeCapabilities {
  protocolVersion: ReaderRuntimeProtocolVersion;
  supportsSourceText: boolean;
  supportsSourceUrl: boolean;
  supportsAssetManifest: boolean;
  supportsSeekTime: boolean;
  supportsTimelineMarkers: boolean;
  supportsInspection: boolean;
  supportsInteractiveSegments: boolean;
}

export interface ReaderRuntimeViewport {
  width: number;
  height: number;
  devicePixelRatio?: number;
  backgroundColor?: string | number;
}

export interface ReaderRuntimeTypography {
  fontFamily?: string;
  fontSize?: number;
  fontWeight?: string | number;
  fontStyle?: string;
  fill?: string | number;
  lineHeight?: number;
  letterSpacing?: number;
  align?: "left" | "center" | "right" | "justify";
}

export interface ReaderRuntimeFontAsset {
  family: string;
  url: string;
  weight?: string | number;
  style?: string;
  display?: "auto" | "block" | "swap" | "fallback" | "optional";
}

export interface ReaderRuntimeAssetRef {
  url: string;
  type?: "font" | "image" | "shader" | "audio" | "video" | "data";
  integrity?: string;
  metadata?: Record<string, unknown>;
}

export interface ReaderRuntimeAssetManifest {
  baseUrl?: string;
  fonts?: ReaderRuntimeFontAsset[];
  assets?: Record<string, ReaderRuntimeAssetRef>;
}

export interface ReaderRuntimeWorkPayload {
  id: string;
  title?: string;
  authorName?: string;
  description?: string;
  category?: string;
  contentUri?: string;
  estimatedDurationSec?: number;
  tags?: string[];
  attributes?: Record<string, unknown>;
  presentation?: Record<string, unknown>;
}

export interface ReaderRuntimeSettings {
  reducedMotion?: boolean;
  fontScale?: number;
  timeScale?: number;
  theme?: "light" | "dark" | "system" | string;
  quality?: "low" | "balanced" | "high";
  interactionEnabled?: boolean;
  debugOverlay?: boolean;
  typography?: ReaderRuntimeTypography;
  viewport?: ReaderRuntimeViewport;
  presentationMode?: ReaderRuntimePresentationMode;
  assetBaseUrl?: string;
  fontManifest?: ReaderRuntimeFontAsset[];
  assetManifest?: ReaderRuntimeAssetManifest;
}

interface ReaderRuntimeLoadScriptBase {
  work: ReaderRuntimeWorkPayload;
  settings?: ReaderRuntimeSettings;
}

export type ReaderRuntimeLoadScriptPayload =
  | (ReaderRuntimeLoadScriptBase & {
      source: string;
      sourceUrl?: string;
      assetManifest?: ReaderRuntimeAssetManifest;
    })
  | (ReaderRuntimeLoadScriptBase & {
      source?: string;
      sourceUrl: string;
      assetManifest?: ReaderRuntimeAssetManifest;
    })
  | (ReaderRuntimeLoadScriptBase & {
      source?: string;
      sourceUrl?: string;
      assetManifest: ReaderRuntimeAssetManifest;
    });

export interface ReaderRuntimeSeekPayload {
  progress?: number;
  timeMs?: number;
  segmentId?: string;
  paragraphIndex?: number;
  checkpointId?: string;
  markerId?: string;
}

export interface ReaderRuntimeInspectionRequest {
  enabled: boolean;
  mode?: ReaderRuntimeInspectMode;
}

export interface ReaderRuntimeTimelineMarker {
  id: string;
  label?: string;
  timeMs?: number;
  startTime?: number;
  duration?: number;
  progress?: number;
  segmentId?: string;
  paragraphIndex?: number;
  line?: number;
  content?: string;
  type?: "text" | "scene" | string;
  metadata?: Record<string, unknown>;
}

export interface ReaderRuntimeRuntimeReadyEvent {
  runtime: string;
  version: number;
  capabilities?: ReaderRuntimeCapabilities;
}

export interface ReaderRuntimeReadyEvent {
  workId: string;
  durationMs?: number;
  timelineMarkers?: ReaderRuntimeTimelineMarker[];
}

export interface ReaderRuntimeProgressEvent {
  workId: string;
  progress: number;
  timeMs?: number;
  durationMs?: number;
  segmentId?: string;
  paragraphIndex?: number;
  line?: number;
  checkpointId?: string;
  markerId?: string;
  positionPayload?: string;
}

export interface ReaderRuntimePlaybackStateEvent {
  workId?: string;
  isPlaying: boolean;
  state: ReaderRuntimePlaybackState;
}

export interface ReaderRuntimeIssue {
  id: string;
  workId?: string;
  severity: "Info" | "Warning" | "Error";
  source: "Parser" | "Layout" | "Effect" | "Asset" | "Performance" | "Runtime";
  location?: string;
  message: string;
  suggestion?: string;
  diagnostic?: DiagnosticEvent;
}

export interface ReaderRuntimeInspectionEvent {
  workId?: string;
  issues: ReaderRuntimeIssue[];
  diagnostics?: DiagnosticEvent[];
  mode?: ReaderRuntimeInspectMode;
}

export interface ReaderRuntimeError {
  workId?: string;
  code?: string;
  message: string;
  recoverable?: boolean;
  commandId?: string;
  cause?: unknown;
}

export interface ReaderRuntimeCommandPayloadMap {
  loadScript: ReaderRuntimeLoadScriptPayload;
  play: Record<string, never>;
  pause: Record<string, never>;
  seek: ReaderRuntimeSeekPayload;
  setInspectionEnabled: ReaderRuntimeInspectionRequest;
  updateSettings: ReaderRuntimeSettings;
  dispose: Record<string, never>;
}

export interface ReaderRuntimeEventPayloadMap {
  runtimeReady: ReaderRuntimeRuntimeReadyEvent;
  ready: ReaderRuntimeReadyEvent;
  progressChanged: ReaderRuntimeProgressEvent;
  playbackStateChanged: ReaderRuntimePlaybackStateEvent;
  inspectionReported: ReaderRuntimeInspectionEvent;
  error: ReaderRuntimeError;
}

export type ReaderRuntimeCommandEnvelope<
  TType extends ReaderRuntimeCommandType = ReaderRuntimeCommandType,
> = ReaderRuntimeEnvelope<ReaderRuntimeCommandPayloadMap[TType]> & {
  id: string;
  type: TType;
};

export type ReaderRuntimeEventEnvelope<
  TType extends ReaderRuntimeEventType = ReaderRuntimeEventType,
> = ReaderRuntimeEnvelope<ReaderRuntimeEventPayloadMap[TType]> & {
  type: TType;
};

export interface ReaderRuntimeCallbacks {
  onRuntimeReady?(event: ReaderRuntimeRuntimeReadyEvent): void;
  onReady?(event: ReaderRuntimeReadyEvent): void;
  onProgress?(event: ReaderRuntimeProgressEvent): void;
  onPlaybackStateChanged?(event: ReaderRuntimePlaybackStateEvent): void;
  onTimelineChanged?(markers: ReaderRuntimeTimelineMarker[]): void;
  onDiagnostic?(diagnostic: DiagnosticEvent): void;
  onInspectionReported?(event: ReaderRuntimeInspectionEvent): void;
  onError?(error: ReaderRuntimeError): void;
}

export interface ReaderRuntimeOptions {
  assetBaseUrl?: string;
  typography?: ReaderRuntimeTypography;
  viewport?: ReaderRuntimeViewport;
  presentationMode?: ReaderRuntimePresentationMode;
  fontManifest?: ReaderRuntimeFontAsset[];
  assetManifest?: ReaderRuntimeAssetManifest;
  settings?: ReaderRuntimeSettings;
  capabilities?: Partial<ReaderRuntimeCapabilities>;
  callbacks?: ReaderRuntimeCallbacks;
}

export interface ReaderRuntimeEditorStateAdapter {
  setCurrentTime?(timeMs: number): void;
  setTotalDuration?(durationMs: number): void;
  setCurrentLine?(line: number): void;
  setTimelineMarkers?(markers: ReaderRuntimeTimelineMarker[]): void;
  setBaseTypography?(typography: ReaderRuntimeTypography): void;
  setPlaybackState?(event: ReaderRuntimePlaybackStateEvent): void;
  reportDiagnostic?(diagnostic: DiagnosticEvent): void;
  reportError?(error: ReaderRuntimeError): void;
}

export interface ReaderRuntimeSession {
  readonly sessionId: string;
  readonly state: ReaderRuntimePlaybackState;
  loadScript(payload: ReaderRuntimeLoadScriptPayload): Promise<void>;
  loadSource(source: string, work?: ReaderRuntimeWorkPayload): Promise<void>;
  play(): void | Promise<void>;
  pause(): void | Promise<void>;
  seek(payload: ReaderRuntimeSeekPayload): void | Promise<void>;
  setTimeScale(scale: number): void | Promise<void>;
  setInspectionEnabled(enabled: boolean, mode?: ReaderRuntimeInspectMode): void | Promise<void>;
  inspect(mode?: ReaderRuntimeInspectMode): void | Promise<void>;
  updateSettings(settings: ReaderRuntimeSettings): void | Promise<void>;
  receive?(message: string | ReaderRuntimeCommandEnvelope): void | Promise<void>;
  attach?(container: HTMLElement): void | Promise<void>;
  detach?(): void | Promise<void>;
  dispose(): void | Promise<void>;
}
