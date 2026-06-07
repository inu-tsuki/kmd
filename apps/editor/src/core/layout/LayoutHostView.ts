export interface LayoutHostScreenSize {
  width: number;
  height: number;
}

export type LayoutHostDisposer = () => void;

export interface LayoutHostView {
  getScreenSize(): LayoutHostScreenSize;
  onUpdate(callback: () => void): LayoutHostDisposer | void;
  onResize(callback: () => void): LayoutHostDisposer | void;
}
