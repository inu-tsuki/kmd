import { readerApp } from "../App";
import type { LayoutHostView } from "./LayoutHostView";

export const readerLayoutHostView: LayoutHostView = {
  getScreenSize: () => ({
    width: readerApp.pixiApp.screen.width,
    height: readerApp.pixiApp.screen.height,
  }),
  onUpdate: (callback) => {
    readerApp.pixiApp.ticker.add(() => callback());
  },
  onResize: (callback) => {
    readerApp.pixiApp.renderer.on("resize", () => callback());
  },
};
