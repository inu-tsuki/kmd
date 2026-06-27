// 颜色工具：供颜色类滤镜（duotone / edge / outline 等）把 KMD 参数
// 中的 hex 字符串或 0xRRGGBB 数值转成 Pixi v8 vec3<f32> uniform 值。
//
// Pixi v8 的 vec3<f32> GL uniform setter 使用数组索引 v[0],v[1],v[2]
// （见 pixi.mjs UNIFORM_TO_SINGLE_SETTERS），不是 .x/.y/.z 属性访问。
// 故必须用 Float32Array 而非 {x,y,z} 对象，否则 v[0]=undefined → 0 →
// 所有 vec3 颜色 uniform 变黑色。
// 解析器 autoConvert 不解析 hex（color="#fff" 原样作为字符串到达 fn），
// 故转换由滤镜侧负责。

/**
 * 把 hex 字符串（"#fff" / "#aabbcc"）或 0xRRGGBB 数值转成 0..1 归一化
 * Float32Array([r, g, b])，匹配 Pixi v8 vec3<f32> uniform 值格式。
 * 非法输入回退白色 (1,1,1)。
 */
export function hexToVec3(color: string | number): Float32Array {
  if (typeof color === "number") {
    const r = ((color >> 16) & 0xff) / 255;
    const g = ((color >> 8) & 0xff) / 255;
    const b = (color & 0xff) / 255;
    return new Float32Array([r, g, b]);
  }

  if (typeof color !== "string") return new Float32Array([1, 1, 1]);

  let hex = color.trim();
  if (hex.startsWith("#")) hex = hex.slice(1);

  // 3 位展开为 6 位
  if (hex.length === 3) {
    hex = hex
      .split("")
      .map((c) => c + c)
      .join("");
  }

  if (hex.length !== 6 || !/^[0-9a-fA-F]{6}$/.test(hex)) {
    return new Float32Array([1, 1, 1]);
  }

  const r = parseInt(hex.slice(0, 2), 16) / 255;
  const g = parseInt(hex.slice(2, 4), 16) / 255;
  const b = parseInt(hex.slice(4, 6), 16) / 255;
  return new Float32Array([r, g, b]);
}