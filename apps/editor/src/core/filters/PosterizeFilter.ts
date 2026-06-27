import { Filter, GlProgram, defaultFilterVert } from "pixi.js";

// 色调分离滤镜（alpha 量化 + 可选 Bayer 抖动）：把 alpha 量化到 uLevels 级。
// 比原 RGB 量化更适合文字：单色字 RGB 恒定 → 量化无变化；而 alpha 在笔画
// 核心与 AA 边缘间有梯度，量化后产生阶梯状边缘断层（posterize 的视觉特征）。
// uDither 为 1 时按 4×4 Bayer 矩阵在量化前加抖动，减弱色带。
// 纯逐像素，无 padding。
const fragment = /* glsl */ `#version 300 es
#pragma vscode_glsllint_stage: frag
precision highp float;

in vec2 vTextureCoord;
out vec4 finalColor;

uniform sampler2D uTexture;
uniform float uLevels;         // 量化级数 (≥2)
uniform float uDither;         // 0=无抖动，1=Bayer 4×4 抖动
uniform vec4 uInputSize;       // Pixi 系统自动注入，.xy = (width, height)

// 4×4 Bayer 矩阵（阈值 0~15，归一化到 0~1）
const float bayer4[16] = float[16](
     0.0,  8.0,  2.0, 10.0,
    12.0,  4.0, 14.0,  6.0,
     3.0, 11.0,  1.0,  9.0,
    15.0,  7.0, 13.0,  5.0
);

void main(void)
{
    vec4 c = texture(uTexture, vTextureCoord);

    // 纹理空间像素坐标（vTextureCoord * 纹理尺寸）
    vec2 pixel = vTextureCoord * uInputSize.xy;
    int ix = int(mod(pixel.x, 4.0));
    int iy = int(mod(pixel.y, 4.0));
    float bayer = bayer4[iy * 4 + ix] / 16.0;

    // 对 alpha 量化（+ Bayer 抖动），产生阶梯状边缘断层
    float quantizedA = floor(c.a * uLevels + bayer * uDither) / uLevels;

    // 保留原色，只量化 alpha → 笔画边缘出现 posterize 特有的阶梯断层
    vec3 rgb = c.a > 0.001 ? c.rgb / c.a : vec3(0.0);
    float outAlpha = clamp(quantizedA, 0.0, 1.0);

    finalColor = vec4(rgb * outAlpha, outAlpha);
}
`;

export class PosterizeFilter extends Filter {
  constructor() {
    const glProgram = new GlProgram({
      vertex: defaultFilterVert,
      fragment,
      name: "posterize-filter",
    });

    super({
      glProgram,
      resources: {
        filterUniforms: {
          uLevels: { value: 4, type: "f32" },
          uDither: { value: 0, type: "f32" },
        },
      },
    });
  }

  get levels() {
    return this.resources.filterUniforms.uniforms.uLevels;
  }
  set levels(value: number) {
    this.resources.filterUniforms.uniforms.uLevels = value;
  }

  get dither() {
    return this.resources.filterUniforms.uniforms.uDither;
  }
  set dither(value: number) {
    this.resources.filterUniforms.uniforms.uDither = value;
  }
}