export interface LayoutHostScreenSize {
  width: number;
  height: number;
}

export interface LayoutHostView {
  getScreenSize(): LayoutHostScreenSize;
  onUpdate(callback: () => void): void;
  onResize(callback: () => void): void;
}
