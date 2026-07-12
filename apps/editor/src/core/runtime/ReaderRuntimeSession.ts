import { readerApp } from "../App";
import { layout } from "../layout/LayoutEngine";
import { createPixiLayoutHostView } from "../layout/ReaderLayoutHostView";
import { scriptPlayer, type ScriptPlayer } from "../player/ScriptPlayer";
import { ScriptSourceLoader } from "../player/ScriptSourceLoader";
import { PixiReaderHost } from "../stage/ReaderHost";
import { stageManager } from "../stage/StageManager";
import {
  resolveControlledSourceUrl,
  type RuntimeAssetContext,
} from "./RuntimeAssetPolicy";
import { parseReaderRuntimeCommandEnvelope } from "./ReaderRuntimeProtocol";
import type {
  ReaderRuntimeAssetManifest,
  ReaderRuntimeCallbacks,
  ReaderRuntimeCapabilities,
  ReaderRuntimeCommandEnvelope,
  ReaderRuntimeError,
  ReaderRuntimeInspectMode,
  ReaderRuntimeLoadScriptPayload,
  ReaderRuntimeOptions,
  ReaderRuntimePlaybackState,
  ReaderRuntimeSeekPayload,
  ReaderRuntimeSession,
  ReaderRuntimeSettings,
  ReaderRuntimeWorkPayload,
} from "./ReaderRuntimeContract";

const DEFAULT_CAPABILITIES: ReaderRuntimeCapabilities = {
  protocolVersion: 1,
  supportsSourceText: true,
  supportsSourceUrl: true,
  supportsAssetManifest: true,
  supportsSeekTime: true,
  supportsTimelineMarkers: true,
  supportsInspection: true,
  supportsInteractiveSegments: false,
};

function createSessionId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `reader-runtime-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export class ReaderRuntimeWebSession implements ReaderRuntimeSession {
  public readonly sessionId = createSessionId();

  private options: ReaderRuntimeOptions;
  private resizeObserver: ResizeObserver | null = null;
  private disposed = false;
  private playbackState: ReaderRuntimePlaybackState = "idle";
  private inspectionMode: ReaderRuntimeInspectMode = "quick";
  private activeWorkId: string | null = null;
  private callbacks: ReaderRuntimeCallbacks;

  public constructor(options: ReaderRuntimeOptions = {}) {
    this.options = options;
    this.callbacks = this.wrapCallbacks(options.callbacks ?? {});
    scriptPlayer.setRuntimeCallbacks(this.callbacks);
    this.applyRuntimeOptions(options);
  }

  public get state() {
    return this.playbackState;
  }

  public getPlayer(): ScriptPlayer {
    return scriptPlayer;
  }

  public async attach(container: HTMLElement) {
    this.ensureActive();

    await readerApp.init(container, this.getAssetContext());
    stageManager.init(new PixiReaderHost(readerApp.pixiApp));
    layout.setHostView(createPixiLayoutHostView(readerApp.pixiApp));
    layout.init(stageManager.contentLayer, 100);
    readerApp.installRenderDebugProbes(container, "attach");
    this.bindResizeObserver(container);

    this.callbacks.onRuntimeReady?.({
      runtime: "kmd-reader-runtime-web",
      version: 1,
      capabilities: {
        ...DEFAULT_CAPABILITIES,
        ...this.options.capabilities,
      },
    });
  }

  public detach() {
    this.disconnectResizeObserver();
    layout.detachHostView();
    stageManager.detachHost();
  }

  public async dispose() {
    if (this.disposed) return;
    await scriptPlayer.dispose();
    this.detach();
    layout.disposeSession();
    stageManager.disposeSession();
    this.disposed = true;
    this.activeWorkId = null;
    this.setPlaybackState("idle");
  }

  public async loadScript(payload: ReaderRuntimeLoadScriptPayload) {
    this.ensureActive();
    this.activeWorkId = payload.work.id;
    this.applyRuntimeOptions({
      ...this.options,
      settings: {
        ...this.options.settings,
        ...payload.settings,
      },
      assetManifest: payload.assetManifest ?? this.options.assetManifest,
    });
    await readerApp.loadFonts(this.getAssetContext());

    let source: string | null = null;
    try {
      source = await this.resolveScriptSource(payload);
    } catch (error) {
      this.reportError({
        workId: payload.work.id,
        code: "SCRIPT_SOURCE_LOAD_FAILED",
        message: error instanceof Error ? error.message : String(error),
        recoverable: true,
        cause: error,
      });
      return;
    }

    if (!source) {
      this.reportError({
        workId: payload.work.id,
        code: "SCRIPT_SOURCE_MISSING",
        message: "loadScript requires source, controlled sourceUrl, or assetManifest with a resolvable work contentUri.",
        recoverable: true,
      });
      return;
    }

    await scriptPlayer.loadSourceContent(source);
  }

  public async loadSource(source: string, work: ReaderRuntimeWorkPayload = { id: "inline-source" }) {
    await this.loadScript({ source, work });
  }

  public play() {
    this.ensureActive();
    scriptPlayer.playSegment();
  }

  public pause() {
    this.ensureActive();
    scriptPlayer.pauseSegment();
  }

  public seek(payload: ReaderRuntimeSeekPayload) {
    this.ensureActive();
    const timeMs = readFiniteNumber(payload.timeMs) ?? (
      readFiniteNumber(payload.progress) !== undefined
        ? scriptPlayer.durationMs * Math.max(0, Math.min(1, payload.progress as number))
        : undefined
    );
    if (timeMs === undefined) {
      this.reportError({
        code: "SEEK_TARGET_MISSING",
        message: "seek requires timeMs or progress in the current runtime.",
        recoverable: true,
      });
      return;
    }
    scriptPlayer.seekToTime(timeMs / 1000);
  }

  public setTimeScale(scale: number) {
    this.ensureActive();
    scriptPlayer.setTimeScale(scale);
  }

  public setInspectionEnabled(enabled: boolean, mode: ReaderRuntimeInspectMode = this.inspectionMode) {
    this.ensureActive();
    this.inspectionMode = mode;
    if (enabled) {
      this.inspect(mode);
    }
  }

  public inspect(mode: ReaderRuntimeInspectMode = this.inspectionMode) {
    this.ensureActive();
    this.callbacks.onInspectionReported?.({
      issues: [],
      diagnostics: [],
      mode,
    });
  }

  public async updateSettings(settings: ReaderRuntimeSettings) {
    this.ensureActive();
    const previousScale = this.options.settings?.fontScale ?? 1;
    this.applyRuntimeOptions({
      ...this.options,
      settings: {
        ...this.options.settings,
        ...settings,
      },
    });
    if (settings.timeScale !== undefined) {
      this.setTimeScale(settings.timeScale);
    }
    void readerApp.loadFonts(this.getAssetContext());
    const mode = this.options.settings?.presentationMode ?? this.options.presentationMode;
    if (
      settings.fontScale !== undefined &&
      settings.fontScale !== previousScale &&
      (mode === "scroll" || mode === "page")
    ) {
      await scriptPlayer.rebuildForTypography();
    }
  }

  public async receive(message: string | ReaderRuntimeCommandEnvelope) {
    const parsed = parseReaderRuntimeCommandEnvelope(message);
    if (parsed.error || !parsed.command) {
      this.reportError({
        commandId: parsed.error?.commandId,
        code: parsed.error?.code ?? "COMMAND_ENVELOPE_INVALID",
        message: parsed.error?.message ?? "Runtime command envelope is invalid.",
        recoverable: true,
      });
      return;
    }

    const command = parsed.command;
    try {
      switch (command.type) {
        case "loadScript":
          if (!isLoadScriptPayload(command.payload)) {
            this.reportError({
              commandId: command.id,
              code: "LOAD_SCRIPT_PAYLOAD_INVALID",
              message: "loadScript requires payload.work.id and source, sourceUrl, or assetManifest.",
              recoverable: true,
            });
            return;
          }
          await this.loadScript(command.payload);
          break;
        case "play":
          this.play();
          break;
        case "pause":
          this.pause();
          break;
        case "seek":
          this.seek(readSeekPayload(command.payload));
          break;
        case "setInspectionEnabled": {
          const payload = command.payload as { enabled?: boolean; mode?: ReaderRuntimeInspectMode } | undefined;
          this.setInspectionEnabled(payload?.enabled ?? false, payload?.mode);
          break;
        }
        case "updateSettings":
          await this.updateSettings((command.payload ?? {}) as ReaderRuntimeSettings);
          break;
        case "dispose":
          await this.dispose();
          break;
      }
    } catch (error) {
      this.reportError({
        commandId: command.id,
        code: "COMMAND_FAILED",
        message: error instanceof Error ? error.message : String(error),
        recoverable: true,
        cause: error,
      });
    }
  }

  private wrapCallbacks(callbacks: ReaderRuntimeCallbacks): ReaderRuntimeCallbacks {
    return {
      ...callbacks,
      onReady: (event) => {
        if (this.disposed) return;
        callbacks.onReady?.({
          ...event,
          workId: this.activeWorkId ?? event.workId,
        });
      },
      onProgress: (event) => {
        if (this.disposed) return;
        callbacks.onProgress?.({
          ...event,
          workId: this.activeWorkId ?? event.workId,
        });
      },
      onPlaybackStateChanged: (event) => {
        if (this.disposed) return;
        this.playbackState = event.state;
        callbacks.onPlaybackStateChanged?.({
          ...event,
          workId: this.activeWorkId ?? event.workId,
        });
      },
      onInspectionReported: (event) => {
        if (this.disposed) return;
        callbacks.onInspectionReported?.({
          ...event,
          workId: event.workId ?? this.activeWorkId ?? undefined,
          issues: event.issues.map((issue) => ({
            ...issue,
            workId: issue.workId ?? this.activeWorkId ?? undefined,
          })),
        });
      },
      onError: (error) => {
        if (this.disposed) return;
        callbacks.onError?.({
          ...error,
          workId: error.workId ?? this.activeWorkId ?? undefined,
        });
      },
    };
  }

  private applyRuntimeOptions(options: ReaderRuntimeOptions) {
    this.options = options;
    const settings = options.settings;
    ScriptSourceLoader.configure({
      allowPathFetch: false,
      assetBaseUrl: this.getAssetContext().assetBaseUrl,
    });
    const mode = settings?.presentationMode ?? options.presentationMode;
    const scale = mode === "scroll" || mode === "page"
      ? (settings?.fontScale ?? 1)
      : 1;
    scriptPlayer.updateConfig({
      mode,
      designWidth: settings?.viewport?.width ?? options.viewport?.width,
      designHeight: settings?.viewport?.height ?? options.viewport?.height,
      typography: {
        ...options.typography,
        ...settings?.typography,
        scale,
      },
    });
  }

  private async resolveScriptSource(payload: ReaderRuntimeLoadScriptPayload) {
    if (payload.source !== undefined) {
      return payload.source;
    }
    const sourceUrl = payload.sourceUrl ?? this.resolveManifestSourceUrl(payload);
    if (sourceUrl !== null) {
      const response = await fetch(
        resolveControlledSourceUrl(sourceUrl, this.getAssetContext(payload.assetManifest)),
      );
      if (!response.ok) {
        throw new Error(`Failed to load script source: ${response.status} ${response.statusText}`);
      }
      return response.text();
    }
    return null;
  }

  private resolveManifestSourceUrl(payload: ReaderRuntimeLoadScriptPayload) {
    const assetManifest = payload.assetManifest ?? this.options.assetManifest ?? this.options.settings?.assetManifest;
    if (!assetManifest) return null;

    const assets = assetManifest.assets ?? {};
    const candidates = [
      payload.work.contentUri,
      payload.work.id,
      "source",
      "script",
    ].filter((key): key is string => typeof key === "string" && key.length > 0);

    for (const key of candidates) {
      const asset = assets[key];
      if (asset?.url) return asset.url;
    }

    return payload.work.contentUri ?? null;
  }

  private getAssetContext(assetManifest?: ReaderRuntimeAssetManifest): RuntimeAssetContext {
    const activeManifest = assetManifest ?? this.options.settings?.assetManifest ?? this.options.assetManifest;
    return {
      assetBaseUrl: this.options.settings?.assetBaseUrl ?? this.options.assetBaseUrl,
      fontManifest: this.options.settings?.fontManifest ?? this.options.fontManifest,
      assetManifest: activeManifest,
    };
  }

  private bindResizeObserver(container: HTMLElement) {
    this.disconnectResizeObserver();
    this.resizeObserver = new ResizeObserver(() => {
      requestAnimationFrame(() => {
        readerApp.resizeToHost(container);
        readerApp.renderOnce();
      });
    });
    this.resizeObserver.observe(container);
  }

  private disconnectResizeObserver() {
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
  }

  private setPlaybackState(state: ReaderRuntimePlaybackState) {
    this.playbackState = state;
  }

  private reportError(error: ReaderRuntimeError) {
    if (this.disposed) return;
    this.setPlaybackState("error");
    this.callbacks.onError?.(error);
    this.callbacks.onPlaybackStateChanged?.({
      workId: error.workId,
      isPlaying: false,
      state: "error",
    });
  }

  private ensureActive() {
    if (this.disposed) {
      throw new Error("Reader runtime session has been disposed.");
    }
  }
}

export async function createReaderRuntime(
  container: HTMLElement,
  options: ReaderRuntimeOptions = {},
): Promise<ReaderRuntimeWebSession> {
  const session = new ReaderRuntimeWebSession(options);
  await session.attach(container);
  return session;
}

function isLoadScriptPayload(payload: unknown): payload is ReaderRuntimeLoadScriptPayload {
  if (!isRecord(payload) || !isRecord(payload.work)) return false;
  const workId = payload.work.id;
  const hasSource = typeof payload.source === "string";
  const hasSourceUrl = typeof payload.sourceUrl === "string";
  const hasAssetManifest = isRecord(payload.assetManifest);
  return typeof workId === "string" && workId.length > 0 && (
    hasSource || hasSourceUrl || hasAssetManifest
  );
}

function readSeekPayload(payload: unknown): ReaderRuntimeSeekPayload {
  if (!isRecord(payload)) return {};
  return {
    progress: readFiniteNumber(payload.progress),
    timeMs: readFiniteNumber(payload.timeMs),
    segmentId: readString(payload.segmentId),
    paragraphIndex: readFiniteNumber(payload.paragraphIndex),
    checkpointId: readString(payload.checkpointId),
    markerId: readString(payload.markerId),
  };
}

function readFiniteNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function readString(value: unknown) {
  return typeof value === "string" ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
