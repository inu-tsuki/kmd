import type { StageMode, StageViewport } from "./types";

export class PresentationManager {
  private _designWidth = 1920;
  private _designHeight = 1080;
  private _isFixedRatio = false;
  private _viewport: StageViewport = { offsetX: 0, offsetY: 0, baseScale: 1 };

  public get designWidth() {
    return this._designWidth;
  }

  public get designHeight() {
    return this._designHeight;
  }

  public get isFixedRatio() {
    return this._isFixedRatio;
  }

  public get viewport() {
    return this._viewport;
  }

  public setDesignResolution(width: number, height: number) {
    this._designWidth = width;
    this._designHeight = height;
  }

  public setMode(mode: StageMode) {
    this._isFixedRatio = mode === "stage";
  }

  public loadState(state: { designWidth: number; designHeight: number; isFixedRatio: boolean }) {
    this._designWidth = state.designWidth;
    this._designHeight = state.designHeight;
    this._isFixedRatio = state.isFixedRatio;
  }

  public updateViewport(screenW: number, screenH: number) {
    if (!this._isFixedRatio) {
      this._viewport = { offsetX: 0, offsetY: 0, baseScale: 1 };
      return this._viewport;
    }

    const scale = Math.min(screenW / this._designWidth, screenH / this._designHeight);
    const offsetX = (screenW - this._designWidth * scale) / 2;
    const offsetY = (screenH - this._designHeight * scale) / 2;
    this._viewport = { offsetX, offsetY, baseScale: scale };
    return this._viewport;
  }
}
