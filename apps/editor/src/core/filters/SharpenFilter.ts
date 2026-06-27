import { Filter, GlProgram, defaultFilterVert } from "pixi.js";

// 锐化滤镜（alpha unsharp mask）：对 alpha 通道做 unsharp mask，
// 增强文字 AA 边缘的对比度，让笔画轮廓更锐利。
// 比原 RGB luma 锐化更适合文字：单色字内部 RGB 恒定 → RGB 锐化无效果；
// 而 alpha 在 AA 边缘有梯度，锐化 alpha 让边缘更清晰。
// 3×3 邻域采样，步长 uRadius * uInputSize.zw。filter.padding = ceil(radius)。
const fragment = /* glsl */ `#version 300 es
#pragma vscode_glsllint_stage: frag
precision highp float;

in vec2 vTextureCoord;
out vec4 finalColor;

uniform sampler2D uTexture;
uniform float uAmount;         // 锐化强度
uniform float uRadius;         // 邻域步长（像素）
uniform vec4 uInputSize;       // Pixi 系统自动注入，.zw = (1/width, 1/height)
uniform vec4 uInputClamp;      // Pixi 系统自动注入，纹理安全边界

#define SAMPLEA(off) texture(uTexture, clamp(vTextureCoord + (off), uInputClamp.xy, uInputClamp.zw)).a

void main(void)
{
    vec2 step = uRadius * uInputSize.zw;
    vec4 c = texture(uTexture, vTextureCoord);

    // 3×3 邻域 alpha 采样
    float a = c.a;
    float l  = SAMPLEA(vec2(-step.x, 0.0));
    float r  = SAMPLEA(vec2( step.x, 0.0));
    float u  = SAMPLEA(vec2(0.0, -step.y));
    float d  = SAMPLEA(vec2(0.0,  step.y));
    float lu = SAMPLEA(vec2(-step.x, -step.y));
    float ru = SAMPLEA(vec2( step.x, -step.y));
    float ld = SAMPLEA(vec2(-step.x,  step.y));
    float rd = SAMPLEA(vec2( step.x,  step.y));

    #undef SAMPLEA

    // alpha unsharp mask：原图 alpha + (原图 alpha - 邻域均值) * amount
    float blurA = (l + r + u + d + lu + ru + ld + rd) / 8.0;
    float sharpenedA = clamp(a + (a - blurA) * uAmount, 0.0, 1.0);

    // 保留原色，只锐化 alpha → AA 边缘更清晰
    vec3 rgb = c.a > 0.001 ? c.rgb / c.a : vec3(0.0);
    finalColor = vec4(rgb * sharpenedA, sharpenedA);
}
`;

export class SharpenFilter extends Filter {
  constructor() {
    const glProgram = new GlProgram({
      vertex: defaultFilterVert,
      fragment,
      name: "sharpen-filter",
    });

    super({
      glProgram,
      resources: {
        filterUniforms: {
          uAmount: { value: 1, type: "f32" },
          uRadius: { value: 1, type: "f32" },
        },
      },
    });
  }

  get amount() {
    return this.resources.filterUniforms.uniforms.uAmount;
  }
  set amount(value: number) {
    this.resources.filterUniforms.uniforms.uAmount = value;
  }

  get radius() {
    return this.resources.filterUniforms.uniforms.uRadius;
  }
  set radius(value: number) {
    this.resources.filterUniforms.uniforms.uRadius = value;
    // padding 匹配 kernel 步长，确保邻域采样不取透明边
    this.padding = Math.ceil(Math.max(value, 1));
  }
}