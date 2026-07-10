// emboss effect —— effect-first、surface-second 目录聚合。
// 文字 alpha 梯度 profile 与背景 RGB luma 梯度 profile 共享 emboss 语义，
// 但信号模型不同，故各自有独立 filter 实现。
export { TextEmbossFilter } from "./TextEmbossFilter";
export { BackgroundEmbossFilter } from "./BackgroundEmbossFilter";
