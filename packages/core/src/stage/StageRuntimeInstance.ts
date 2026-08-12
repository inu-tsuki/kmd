import { MemoryStageAuditPort } from "./StageAudit";
import { StageRuntime } from "./StageRuntime";

const defaultAuditPort = new MemoryStageAuditPort();

export const stageRuntime = new StageRuntime({
  getDesignMetrics: () => ({ width: 1920, height: 1080 }),
  getAuditPort: () => defaultAuditPort,
});
