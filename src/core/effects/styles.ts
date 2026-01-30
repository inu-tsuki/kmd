import type { StyleFunction, EffectMetadata } from "./types";

// Helper to define styles with types
function defineStyle(
  fn: StyleFunction,
  meta: EffectMetadata
) {
  return { fn, meta };
}

// 颜色
const _red: StyleFunction = (style) => { style.fill = "#ff4d4f"; };
export const red = defineStyle(_red, { type: 'style', mutexGroup: 'color' });

const _blue: StyleFunction = (style) => { style.fill = "#1890ff"; };
export const blue = defineStyle(_blue, { type: 'style', mutexGroup: 'color' });

const _gray: StyleFunction = (style) => { style.fill = "#8c8c8c"; };
export const gray = defineStyle(_gray, { type: 'style', mutexGroup: 'color' });

const _green: StyleFunction = (style) => { style.fill = "#52c41a"; };
export const green = defineStyle(_green, { type: 'style', mutexGroup: 'color' });

const _yellow: StyleFunction = (style) => { style.fill = "#faad14"; };
export const yellow = defineStyle(_yellow, { type: 'style', mutexGroup: 'color' });

const _purple: StyleFunction = (style) => { style.fill = "#722ed1"; };
export const purple = defineStyle(_purple, { type: 'style', mutexGroup: 'color' });

const _orange: StyleFunction = (style) => { style.fill = "#ff8c00"; };
export const orange = defineStyle(_orange, { type: 'style', mutexGroup: 'color' });

const _cyan: StyleFunction = (style) => { style.fill = "#00ced1"; };
export const cyan = defineStyle(_cyan, { type: 'style', mutexGroup: 'color' });

const _pink: StyleFunction = (style) => { style.fill = "#ff69b4"; };
export const pink = defineStyle(_pink, { type: 'style', mutexGroup: 'color' });

// 字重与斜体
const _bold: StyleFunction = (style) => { style.fontWeight = "bold"; };
export const bold = defineStyle(_bold, { type: 'style', mutexGroup: 'weight' });

const _italic: StyleFunction = (style) => { style.fontStyle = "italic"; };
export const italic = defineStyle(_italic, { type: 'style', mutexGroup: 'fontStyle' });

// 字体族
const _serif: StyleFunction = (style) => { style.fontFamily = "Times New Roman, serif"; };
export const serif = defineStyle(_serif, { type: 'style', mutexGroup: 'fontFamily' });

const _sans: StyleFunction = (style) => { style.fontFamily = "Arial, sans-serif"; };
export const sans = defineStyle(_sans, { type: 'style', mutexGroup: 'fontFamily' });

const _mono: StyleFunction = (style) => { style.fontFamily = "Courier New, monospace"; };
export const mono = defineStyle(_mono, { type: 'style', mutexGroup: 'fontFamily' });

// 字号
const _big: StyleFunction = (style) => {
  style.fontSize = (typeof style.fontSize === "number" ? style.fontSize : 24) * 1.5;
};
export const big = defineStyle(_big, { type: 'style', mutexGroup: 'sizeModifier' });

const _small: StyleFunction = (style) => {
  style.fontSize = (typeof style.fontSize === "number" ? style.fontSize : 24) * 0.8;
};
export const small = defineStyle(_small, { type: 'style', mutexGroup: 'sizeModifier' });

// 装饰
const _glow: StyleFunction = (style) => {
  const sourceColor =
    typeof style.fill === "string"
      ? style.fill
      : typeof (style as any).color === "string"
        ? (style as any).color
        : "#ffffff";

  const toRgba = (col: string, alpha = 1) => {
    if (!col) return `rgba(255,255,255,${alpha})`;
    col = col.trim();
    if (col.startsWith("rgba")) return col;
    if (col.startsWith("rgb"))
      return col.replace(
        /^rgb\((.+)\)$/,
        (_, inner) => `rgba(${inner},${alpha})`,
      );
    if (col.startsWith("#")) {
      let hex = col.slice(1);
      if (hex.length === 3)
        hex = hex
          .split("")
          .map((c) => c + c)
          .join("");
      if (hex.length !== 6) return `rgba(255,255,255,${alpha})`;
      const r = parseInt(hex.slice(0, 2), 16);
      const g = parseInt(hex.slice(2, 4), 16);
      const b = parseInt(hex.slice(4, 6), 16);
      return `rgba(${r},${g},${b},${alpha})`;
    }
    // fallback: return as-is (might be a CSS color name)
    return col;
  };

  style.dropShadow = {
    color: toRgba(sourceColor, 0.9),
    blur: 10,
    distance: 0,
  } as any;
};
export const glow = defineStyle(_glow, { type: 'style', mutexGroup: 'shadow' });

const _stroke: StyleFunction = (style) => {
  style.stroke = { color: "#000000", width: 2, join: "round" };
};
export const stroke = defineStyle(_stroke, { type: 'style', mutexGroup: 'stroke' });