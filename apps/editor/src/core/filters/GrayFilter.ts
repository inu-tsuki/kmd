import { Filter, GlProgram, defaultFilterVert } from "pixi.js";

// 灰度滤镜（点运算）：luma = dot(rgb, BT.609 权重)，按 uMix 在原色与灰度间插值。
// DIP-FX M1 点运算模板——确立预乘 alpha 对偶模式（解预乘 → 运算 → 重新预乘），
// 后续 threshold/posterize/duotone 复用此模式。
// 纯逐像素，不采样邻域，无需 padding。
const fragment = /* glsl */ `#version 300 es
#pragma vscode_glsllint_stage: frag
precision highp float;

in vec2 vTextureCoord;
out vec4 finalColor;

uniform sampler2D uTexture;
uniform float uMix;            // 0=原色，1=全灰度
uniform vec4 uInputSize;       // Pixi 系统自动注入，.zw = (1/width, 1/height)

void main(void)
{
    vec4 c = texture(uTexture, vTextureCoord);

    // 预乘 alpha 对偶：Pixi 输出可能是预乘格式（§B-bis 待验证 TODO——node 无 WebGL，未确证是否预乘），
    // 对 rgb 运算前先除以 alpha 还原线性 rgb，运算后再乘回。
    vec3 rgb = c.a > 0.001 ? c.rgb / c.a : vec3(0.0);

    float l = dot(rgb, vec3(0.299, 0.587, 0.114));
    vec3 result = mix(rgb, vec3(l), uMix);

    finalColor = vec4(result * c.a, c.a);
}
`;

export class GrayFilter extends Filter {
  constructor() {
    const glProgram = new GlProgram({
      vertex: defaultFilterVert,
      fragment,
      name: "gray-filter",
    });

    super({
      glProgram,
      resources: {
        filterUniforms: {
          uMix: { value: 1, type: "f32" },
        },
      },
    });
  }

  get mix() {
    return this.resources.filterUniforms.uniforms.uMix;
  }
  set mix(value: number) {
    this.resources.filterUniforms.uniforms.uMix = value;
  }
}