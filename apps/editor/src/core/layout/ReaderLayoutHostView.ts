import type { Application } from "pixi.js";
import type { LayoutHostView } from "./LayoutHostView";

export function createPixiLayoutHostView(app: Application): LayoutHostView {
  return {
    getScreenSize: () => ({
      width: app.screen.width,
      height: app.screen.height,
    }),
    onUpdate: (callback) => {
      const tick = () => callback();
      app.ticker.add(tick);
      return () => app.ticker.remove(tick);
    },
    onResize: (callback) => {
      const listener = () => callback();
      app.renderer.on("resize", listener);
      return () => app.renderer.off("resize", listener);
    },
  };
}

export const readerLayoutHostView: LayoutHostView = {
  getScreenSize: () => ({
    width: 1920,
    height: 1080,
  }),
  onUpdate: () => undefined,
  onResize: () => undefined,
};
