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
