// duotone effect —— effect-first、surface-second 目录聚合。
// 文字 alpha profile 与背景 RGB luma profile 共享 duotone 语义，
// 但信号模型不同，故各自有独立 filter 实现。
export { TextDuotoneFilter } from "./TextDuotoneFilter";
export { BackgroundDuotoneFilter } from "./BackgroundDuotoneFilter";
