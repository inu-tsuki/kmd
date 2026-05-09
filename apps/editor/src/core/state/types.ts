import type { StageState } from "../stage/StageManager";
import type { LayoutState } from "../layout/LayoutEngine";

export interface KmdSnapshot {
  stage: StageState;
  layout: LayoutState;
  paragraphIndex: number;
}
