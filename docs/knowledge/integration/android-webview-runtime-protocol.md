# Android WebView Runtime Protocol

> 文档状态：Active
> 最近更新：2026-06-16
> 权威范围：Android ↔ Web reader runtime 的桥协议——消息信封、v1 命令、v1 事件、ack 策略、生命周期状态机、capability 协商

Web 侧 TypeScript 契约见 `apps/editor/src/core/runtime/ReaderRuntimeContract.ts`。

## 1. 目标

本文定义 Android Reader 与 KMD Web Runtime 的桥协议。协议的承载范围随 reader runtime 能力扩展：

- 基线：信封、命令、事件、生命周期、ack 策略。
- 扩展方向（见 §10）：timeline seek、diagnostics、asset request、interactive segment、host UI 交互。

协议设计原则：

- Android 是宿主，不实现 KMD parser、layout、renderer。
- Web runtime 是播放器，不拥有 Android 业务状态。
- WebView bridge 只传结构化消息，不暴露任意执行能力。
- 当前协议保持小而稳定，未来能力通过 capability 和新 message type 扩展。

## 2. 分层

```text
Compose / ViewModel
  -> ReaderRuntimeBridge
      -> WebView transport
          -> Runtime protocol
              -> reader-runtime-web session
```

三层职责：

- Transport：`evaluateJavascript` 与 `@JavascriptInterface postMessage(message: String)`。
- Protocol：消息信封、版本、session、ack、error、event。
- Runtime API：`loadScript`、`play`、`pause`、`seek`、`inspect`、`dispose` 等语义。

Android host 的 transport 与最小 protocol 已落地；后续能力通过新增 message type 和 capability 字段扩展，不重写既有 transport。

## 3. 消息信封

所有消息使用 JSON 字符串。

```ts
interface RuntimeEnvelope<TPayload = unknown> {
  version: 1;
  id?: string;
  sessionId?: string;
  type: string;
  payload?: TPayload;
}
```

字段说明：

- `version`：协议版本。当前为 `1`。
- `id`：命令或事件 id。Android -> JS 命令必须带；JS -> Android 事件可选。
- `sessionId`：未来推荐补充，用于区分 WebView reload、作品 reload 和旧事件。
- `type`：消息类型。
- `payload`：结构化负载。

信封基线为 `{ version, id, type, payload }`。`sessionId` 当前可选，但 runtime 内部应预留 session 语义，用于区分 WebView reload、作品 reload 与旧事件。

## 4. 当前 v1 命令

Android -> JS：

```text
loadScript
play
pause
seek
setInspectionEnabled
updateSettings
dispose
```

### `loadScript`

`loadScript` 的 `work` 元数据之外，至少需要一种脚本来源：

```ts
interface LoadScriptPayload {
  work: RuntimeWorkPayload;
  source?: string;
  sourceUrl?: string;
  assetManifest?: RuntimeAssetManifest;
  settings?: ReaderSettingsPayload;
}
```

约束：

- `source` 用于 Android 已拿到脚本文本的情况，最稳定。
- `sourceUrl` 必须是受控 asset URL 或 HTTPS URL，不允许任意本地路径。
- `assetManifest` 用于字体、图片、shader、音频等资源映射。
- 若三者都没有，真实 runtime 应返回 `error`，不能假装加载成功。

Web runtime 当前策略：

- `source` 优先，直接作为脚本文本播放。
- `sourceUrl` 会相对 `assetBaseUrl` / `assetManifest.baseUrl` 解析；非受控本地路径会被拒绝，HTTPS URL 可作为远端受控来源。
- 若只传 `assetManifest`，runtime 会尝试用 `work.contentUri`、`work.id`、`source` 或 `script` 在 manifest assets 中找脚本资源。
- legacy path-like script input 不再由播放器热路径自由 `fetch()`；宿主应改传 `source` 或受控 `sourceUrl`。

### `seek`

当前 Android 使用 `progress: 0..1`：

```ts
interface SeekPayloadV1 {
  progress: number;
}
```

真实 runtime 可先兼容它，但内部应尽快转换为时间或 checkpoint：

```ts
interface SeekPayloadFuture {
  timeMs?: number;
  progress?: number;
  segmentId?: string;
  checkpointId?: string;
  markerId?: string;
}
```

### `setInspectionEnabled`

用于触发或关闭 runtime diagnostics。当前可返回 `inspectionReported`。

长期不应只表达布尔开关，应演进为：

```ts
interface InspectPayload {
  enabled: boolean;
  mode?: "quick" | "full" | "performance";
}
```

### `updateSettings`

当前字段：

```ts
interface ReaderSettingsPayload {
  reducedMotion?: boolean;
  fontScale?: number;
}
```

未来可扩展 `theme`、`quality`、`interactionEnabled`、`debugOverlay`。

### `dispose`

销毁 runtime session。注意：WebView host detach / rebind 不等于 `dispose`。

## 5. 当前 v1 事件

JS -> Android：

```text
runtimeReady
ready
progressChanged
playbackStateChanged
inspectionReported
error
```

### `runtimeReady`

表示 JS runtime 已安装 `window.KmdRuntime.receive`，Android 可以 flush pending commands。

```ts
interface RuntimeReadyPayload {
  runtime: string;
  version: number;
  capabilities?: RuntimeCapabilities;
}
```

当前 D0 shell 已发送 `runtimeReady`。真实 runtime 应加入 `capabilities`。

### `ready`

表示当前作品已加载完成，可以播放或 seek。

```ts
interface ReadyPayload {
  workId: string;
  durationMs?: number;
  timelineMarkers?: RuntimeMarker[];
}
```

### `progressChanged`

当前 Android 使用：

```ts
interface ProgressPayloadV1 {
  workId: string;
  progress: number;
  positionPayload?: string;
}
```

真实 runtime 推荐追加结构化字段：

```ts
interface ProgressPayloadFuture {
  workId: string;
  progress: number;
  timeMs?: number;
  durationMs?: number;
  segmentId?: string;
  paragraphIndex?: number;
  checkpointId?: string;
  markerId?: string;
}
```

`positionPayload` 可保留为兼容/debug 字符串，但不应成为长期业务字段。

### `playbackStateChanged`

```ts
interface PlaybackStatePayload {
  workId: string;
  isPlaying: boolean;
  state?: "idle" | "loading" | "ready" | "playing" | "paused" | "ended" | "error";
}
```

当前 Android 只需要 `isPlaying`。真实 runtime 应补 `state`，降低 UI 推断成本。

### `inspectionReported`

```ts
interface InspectionPayload {
  workId: string;
  issues: RuntimeIssue[];
}
```

`RuntimeIssue` 应兼容 Android 当前 `ScriptIssue`：

```ts
interface RuntimeIssue {
  id: string;
  workId?: string;
  severity: "Info" | "Warning" | "Error";
  source: "Parser" | "Layout" | "Effect" | "Asset" | "Performance" | "Runtime";
  location?: string;
  message: string;
  suggestion?: string;
}
```

### `error`

```ts
interface RuntimeErrorPayload {
  workId?: string;
  code?: string;
  message: string;
  recoverable?: boolean;
  commandId?: string;
}
```

`commandId` 用于关联失败命令。v1 可以没有 ack，但错误最好带回 `commandId`。

## 6. Ack 策略

当前 Android bridge 是 fire-and-forget：

- 命令发送后不等待 ack。
- 成功由事件体现。
- 失败统一走 `error`。

该策略保持实现简单，但 runtime 应至少做到：

- `loadScript` 失败必须发 `error`。
- `seek` 参数非法必须发 `error` 或被安全 clamp，并产生一次 `progressChanged`。
- `dispose` 不要求 ack，但不应再发旧 session 的播放事件。
- v1 不新增 ack。Android `RuntimeMessageCodec` 会保留 `error.commandId` 或 envelope `id`，用于定位失败命令。
- 成功路径仍由领域事件表达：`runtimeReady` 表示 transport 就绪，`ready` 表示作品加载完成，`progressChanged` 表示播放位置变化。

未来如果需要更严格协议，可新增：

```text
commandAccepted
commandRejected
commandCompleted
```

而不是改变现有事件语义。

## 7. 生命周期

需要区分四件事：

- `runtimeReady`：JS runtime transport 就绪。
- `loadScript`：加载或替换作品。
- `unbind/rebind`：Android WebView host 生命周期变化。
- `dispose`：销毁 runtime session。

推荐状态机：

```text
not-ready
  -> runtime-ready
  -> loading
  -> ready
  -> playing
  -> paused
  -> disposed
```

WebView 被销毁时，Android 可以选择：

- 保留 `lastLoadRequest`，新 WebView ready 后重放 `loadScript`。
- 或显式发送 `dispose`，让 runtime 丢弃 session。

真实 runtime 必须忽略 disposed session 的异步回调，避免旧事件污染新作品。

2026-05-26 补充：Android 宿主进入阅读页时会先创建 WebView transport，再异步获取社区 API 的 `.kmd` 源文本。若 `/works/{id}/source` 失败，ViewModel 必须保持 `Failed` 状态，后到达的 `transportReady` 不能把它覆盖回 `loading`。同时，显式加载新作品时宿主 bridge 必须通过 `prepareLoad(workId)` 清理旧 `loadScript`；只有纯 WebView rebind 才允许重放仍属于当前作品的 `lastLoadRequest`，避免离线或切换作品时把旧作品悄悄装入新的 WebView。

## 8. Capability Negotiation

真实 `runtimeReady` 应携带能力表：

```ts
interface RuntimeCapabilities {
  protocolVersion: 1;
  supportsSourceText: boolean;
  supportsSourceUrl: boolean;
  supportsAssetManifest: boolean;
  supportsSeekTime: boolean;
  supportsTimelineMarkers: boolean;
  supportsInspection: boolean;
  supportsInteractiveSegments: boolean;
}
```

Android 可根据能力启用或隐藏 UI，例如检查脚本、精确 seek、互动控制。

## 9. Asset 策略

bundle 构建、产物路径、`dist/reader-runtime/` → Android generated assets → `kmd-reader-runtime.local` 拦截 → D0 fallback 的完整关系见 [`reader-runtime-web-bundle.md`](./reader-runtime-web-bundle.md)。本节只固定协议层的 asset 规则：

- 脚本文本由 Android 通过 `source` 传入（见 §4 `loadScript`）。
- `Work` 与 `.kmd` 的关系（平台作品实体 vs 可播放源文件）见 [`work-kmd-content-model.md`](../architecture/work-kmd-content-model.md)；Android 应先取 `Work.script.sourceUrl`，再请求 `text/x-kmd` source。
- 字体与示例资源由 `assetManifest` 或 `assetBaseUrl` 指向受控路径，不允许任意本地路径。
- bundle 使用相对 `./assets/...` 和 `./fonts/...`，不依赖站点根路径。

未来可扩展：

```text
assetRequested
assetResolved
assetFailed
```

但不要让 Web runtime 任意读取 Android 本地路径。

## 10. 协议演进路线

> 以下为协议层的演进设计，非承诺时间表。`v1` 为当前已实现的基线。

### v1：当前基线

- 信封 `{ version, id, type, payload }`，`version = 1`。
- 命令与事件见 §4、§5；不强制 ack。
- `loadScript` payload 含 `work` 与 `source/sourceUrl/assetManifest` 至少一种；缺脚本文本时由宿主注入最小 preview source，不假装加载成功。
- Web `receive()` 拒绝缺少 `version/id/type` 或版本不匹配的 envelope。
- Android 原生 JS interface 只暴露 `KmdAndroid.postMessage(message: String)`。

### v1.5：Timeline Runtime

- 加入 `timeMs / durationMs / marker / checkpoint`。
- 加入 `timelineMarkers`。
- 支持 `seekTime` 或扩展 `seek` payload。

### v2：Asset And Diagnostics Runtime

- 加入 asset request/response。
- diagnostics 分流为 parser/layout/effect/asset/performance。
- inspection 支持 quick/full/performance。

### v3：Interactive Segment Runtime

- 加入 user input event。
- 加入 host UI request。
- 加入 state snapshot/restore。
- 支持 game-like segment 的暂停、等待、分支和结果回传。

## 11. 接入约定

桥协议在宿主与 runtime 两侧的接入约定：

- Web runtime 实现 `window.KmdRuntime.receive(message: string)`。
- 通过 `window.KmdAndroid.postMessage(message)` 上报事件。
- 宿主先兼容 `loadScript / progress / inspection` 字段，再在 `runtimeReady`、`ready`、`progressChanged` 中追加可选新字段。
- Android codec 保持 `ignoreUnknownKeys = true`，逐步读取新增字段。

这样宿主可在不重写 bridge 的前提下承接能力扩展。
