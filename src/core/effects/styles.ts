import type { StyleFunction } from "./types";

// 颜色
export const red: StyleFunction = (style) => {
  style.fill = "#ff4d4f";
};
export const blue: StyleFunction = (style) => {
  style.fill = "#1890ff";
};
export const gray: StyleFunction = (style) => {
  style.fill = "#8c8c8c";
};
export const green: StyleFunction = (style) => {
  style.fill = "#52c41a";
};
export const yellow: StyleFunction = (style) => {
  style.fill = "#faad14";
};
export const purple: StyleFunction = (style) => {
  style.fill = "#722ed1";
};

// 字重与斜体
export const bold: StyleFunction = (style) => {
  style.fontWeight = "bold";
};
export const italic: StyleFunction = (style) => {
  style.fontStyle = "italic";
};

// 字号
export const big: StyleFunction = (style) => {
  style.fontSize =
    (typeof style.fontSize === "number" ? style.fontSize : 24) * 1.5;
};
export const small: StyleFunction = (style) => {
  style.fontSize =
    (typeof style.fontSize === "number" ? style.fontSize : 24) * 0.8;
};

// 装饰
export const glow: StyleFunction = (style) => {
  style.dropShadow = {
    color: "#ffffff",
    blur: 10,
    distance: 0,
  } as any;
};
