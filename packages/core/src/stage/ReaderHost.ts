import { Application, Container, Graphics } from "pixi.js";

export interface ReaderHost {
  mountStage(world: Container, uiLayer: Container, letterbox: Graphics): void;
  onResize(listener: () => void): () => void;
  addTicker(listener: () => void, context?: unknown): () => void;
  getScreenSize(): { width: number; height: number };
  setBackgroundColor(color: string | number): void;
}

export class PixiReaderHost implements ReaderHost {
  private app: Application;

  constructor(app: Application) {
    this.app = app;
  }

  public mountStage(world: Container, uiLayer: Container, letterbox: Graphics) {
    const stage = this.app.stage;
    stage.addChild(world);
    stage.addChild(uiLayer);
    stage.addChild(letterbox);
  }

  public onResize(listener: () => void) {
    this.app.renderer.on("resize", listener);
    return () => this.app.renderer.off("resize", listener);
  }

  public addTicker(listener: () => void, context?: unknown) {
    this.app.ticker.add(listener, context as any);
    return () => this.app.ticker.remove(listener, context as any);
  }

  public getScreenSize() {
    return {
      width: this.app.screen.width,
      height: this.app.screen.height,
    };
  }

  public setBackgroundColor(color: string | number) {
    this.app.renderer.background.color = color;
  }
}
