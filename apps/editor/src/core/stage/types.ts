export interface CameraState {
  x: number;
  y: number;
  zoom: number;
  rotation: number;
}

export interface StageState {
  camera: CameraState;
  cameraOffset: CameraState;
  designWidth: number;
  designHeight: number;
  isFixedRatio: boolean;
  backgroundColor: string | number;
}

export type StageMode = "stage" | "scroll";

export interface StageViewport {
  offsetX: number;
  offsetY: number;
  baseScale: number;
}

export type StageCommandKind =
  | "scene"
  | "camera"
  | "offset"
  | "modifier"
  | "playback"
  | "background";

export type StagePropertyKey =
  | "scene.lifecycle"
  | "camera.xy"
  | "camera.zoom"
  | "camera.rotation"
  | "camera.reset"
  | "offset.xy"
  | "playback.pause"
  | "background.set";

export interface StageCommandMetadata {
  name: string;
  kind: StageCommandKind;
  propertyKey?: StagePropertyKey;
  modifierBased?: boolean;
  sceneLifecycle?: boolean;
  blockingDefault?: boolean;
  capturesTween?: boolean;
  description?: string;
}

export type StageCommandMetadataMap = Record<string, StageCommandMetadata>;

export interface StageAuditEntry {
  time: string;
  effect: string;
  params: Record<string, any>;
  cameraBefore: CameraState;
  cameraTarget: Partial<CameraState>;
  overwriteWarning: boolean;
  worldState: {
    centerX: number;
    centerY: number;
  };
}

export interface StageConflictDiagnostic {
  severity: "warning" | "error";
  channel: string;
  command: string;
  message: string;
}

export interface StageAuditSnapshot {
  entries: StageAuditEntry[];
  conflicts: StageConflictDiagnostic[];
}
