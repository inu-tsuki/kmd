import {
  createReaderRuntimeEventEnvelope,
  ReaderRuntimeWebSession,
  type ReaderRuntimeCallbacks,
  type ReaderRuntimeCommandEnvelope,
  type ReaderRuntimeError,
  type ReaderRuntimeEventPayloadMap,
  type ReaderRuntimeEventType,
  type ReaderRuntimeOptions,
  type ReaderRuntimeSession,
} from "@kmd/core/runtime";
import { sanitizeKmdRuntimeConfig } from "@kmd/core/runtime/RuntimeConfigValidator";
import "./style.css";

const DEFAULT_DEMO_SOURCE = `KMD Reader Runtime

这是一段来自 reader-only bundle 的最小 KMD 演出。`;

interface ReaderRuntimeBrowserConfig extends Omit<ReaderRuntimeOptions, "callbacks"> {
  autoDemo?: boolean;
}

interface KmdRuntimeBrowserApi {
  receive(message: string | ReaderRuntimeCommandEnvelope): Promise<void>;
  getSessionId(): string | null;
}

declare global {
  interface Window {
    KmdAndroid?: {
      postMessage(message: string): void;
    };
    KmdRuntime?: KmdRuntimeBrowserApi;
    KmdRuntimeConfig?: ReaderRuntimeBrowserConfig;
  }
}

const root = document.getElementById("reader-root") ?? createReaderRoot();
const statusBadge = document.getElementById("runtime-status");
const pendingMessages: Array<string | ReaderRuntimeCommandEnvelope> = [];

let session: ReaderRuntimeWebSession | null = null;

window.KmdRuntime = {
  receive,
  getSessionId: () => session?.sessionId ?? null,
};

void boot();

async function boot() {
  setStatus("runtime:initializing");

  // 防火墙（主题二 S4a / 处方 10）：宿主注入的 KmdRuntimeConfig 是不可信输入——
  // spread 前经 zod sanitize（strip-unknown + 逐字段类型回退，永不抛）。
  // autoDemo 是宿主私有 boot 字段，先拆出、sanitize 后再并回（不进契约 schema）。
  const rawConfig = window.KmdRuntimeConfig ?? {};
  const { autoDemo, ...contractFields } = rawConfig;
  const { value: config, diagnostics } = sanitizeKmdRuntimeConfig(contractFields);
  for (const diagnostic of diagnostics) {
    console.warn(`[kmd-reader-runtime] boot config: ${diagnostic}`);
  }
  const browserConfig: ReaderRuntimeBrowserConfig = { ...config, autoDemo };
  const runtime = new ReaderRuntimeWebSession({
    ...browserConfig,
    assetBaseUrl: browserConfig.assetBaseUrl ?? import.meta.env.BASE_URL,
    settings: {
      ...browserConfig.settings,
      assetBaseUrl: browserConfig.settings?.assetBaseUrl ?? browserConfig.assetBaseUrl ?? import.meta.env.BASE_URL,
    },
    callbacks: createBridgeCallbacks(),
  });
  session = runtime;

  try {
    await runtime.attach(root);
    await flushPendingMessages(runtime);

    if (autoDemo ?? !hasAndroidBridge()) {
      await runtime.loadSource(DEFAULT_DEMO_SOURCE, {
        id: "reader-runtime-demo",
        title: "Reader Runtime Demo",
        description: "Standalone browser smoke test for the KMD reader runtime bundle.",
      });
      runtime.play();
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    setStatus(`runtime:error ${message}`);
    postRuntimeEvent("error", {
      code: "RUNTIME_BOOT_FAILED",
      message,
      recoverable: false,
    });
  }
}

async function receive(message: string | ReaderRuntimeCommandEnvelope) {
  if (!session) {
    pendingMessages.push(message);
    return;
  }
  await session.receive(message);
}

function createBridgeCallbacks(): ReaderRuntimeCallbacks {
  return {
    onRuntimeReady: (event) => {
      setStatus("runtime:ready");
      postRuntimeEvent("runtimeReady", event);
    },
    onReady: (event) => {
      setStatus(`work:ready ${event.workId}`);
      postRuntimeEvent("ready", event);
    },
    onProgress: (event) => {
      postRuntimeEvent("progressChanged", event);
    },
    onPlaybackStateChanged: (event) => {
      setStatus(`playback:${event.state}`);
      postRuntimeEvent("playbackStateChanged", event);
    },
    onInspectionReported: (event) => {
      postRuntimeEvent("inspectionReported", event);
    },
    onError: (error) => {
      setStatus(`runtime:error ${error.code ?? "UNKNOWN"}`);
      postRuntimeEvent("error", sanitizeError(error), error.commandId);
    },
  };
}

function postRuntimeEvent<TType extends ReaderRuntimeEventType>(
  type: TType,
  payload: ReaderRuntimeEventPayloadMap[TType],
  id?: string,
) {
  const envelope = createReaderRuntimeEventEnvelope(type, payload, {
    id,
    sessionId: session?.sessionId,
  });
  const message = JSON.stringify(envelope);

  if (hasAndroidBridge()) {
    window.KmdAndroid?.postMessage(message);
  } else {
    console.info("[KmdRuntime]", envelope);
  }

  window.dispatchEvent(new CustomEvent("kmd-runtime-event", {
    detail: envelope,
  }));
}

async function flushPendingMessages(runtime: ReaderRuntimeSession) {
  while (pendingMessages.length > 0) {
    const message = pendingMessages.shift();
    if (message !== undefined) {
      await runtime.receive?.(message);
    }
  }
}

function sanitizeError(error: ReaderRuntimeError): ReaderRuntimeError {
  return {
    workId: error.workId,
    code: error.code,
    message: error.message,
    recoverable: error.recoverable,
    commandId: error.commandId,
  };
}

function hasAndroidBridge() {
  return typeof window.KmdAndroid?.postMessage === "function";
}

function setStatus(status: string) {
  if (statusBadge) {
    statusBadge.textContent = status;
  }
}

function createReaderRoot() {
  const container = document.createElement("div");
  container.id = "reader-root";
  document.body.appendChild(container);
  return container;
}
