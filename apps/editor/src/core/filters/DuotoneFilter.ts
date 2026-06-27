import { Filter, GlProgram, defaultFilterVert } from "pixi.js";

// 双色滤镜（点运算）：对文字，把 alpha 映射到 uShadow→uHighlight 渐变。
// 笔画边缘（低 alpha）→ shadow 色，笔画核心（高 alpha）→ highlight 色。
// 这比 luma 映射更适合文字：单色字上 luma 恒定（白字总 luma≈1 → 总是
// highlight），而 alpha 在笔画核心与抗锯齿边缘之间有梯度，能产生双色效果。
// 纯逐像素，无 padding。预乘 alpha 对偶。
const fragment = /* glsl */ `#version 300 es
#pragma vscode_glsllint_stage: frag
precision highp float;

in vec2 vTextureCoord;
out vec4 finalColor;

uniform sampler2D uTexture;
uniform vec3 uShadow;           // 暗部色 / 边缘色 (0~1)
uniform vec3 uHighlight;        // 亮部色 / 核心色 (0~1)
uniform vec4 uInputSize;        // Pixi 系统自动注入

void main(void)
{
    vec4 c = texture(uTexture, vTextureCoord);

    // 对文字：alpha 从边缘 0→核心 1，映射到 shadow→highlight 渐变
    float t = clamp(c.a, 0.0, 1.0);
    vec3 mapped = mix(uShadow, uHighlight, t);

    finalColor = vec4(mapped * c.a, c.a);
}
`;

export class DuotoneFilter extends Filter {
  constructor() {
    const glProgram = new GlProgram({
      vertex: defaultFilterVert,
      fragment,
      name: "duotone-filter",
    });

    super({
      glProgram,
      resources: {
        filterUniforms: {
          uShadow: { value: new Float32Array([0.1, 0.1, 0.18]), type: "vec3<f32>" },
          uHighlight: { value: new Float32Array([0.91, 0.27, 0.38]), type: "vec3<f32>" },
        },
      },
    });
  }

  get shadow() {
    return this.resources.filterUniforms.uniforms.uShadow;
  }
  set shadow(value: Float32Array) {
    this.resources.filterUniforms.uniforms.uShadow = value;
  }

  get highlight() {
    return this.resources.filterUniforms.uniforms.uHighlight;
  }
  set highlight(value: Float32Array) {
    this.resources.filterUniforms.uniforms.uHighlight = value;
  }
}