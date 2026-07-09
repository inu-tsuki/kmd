// 位移贴图 (Displace) —— DIP-FX M2 氛围集，behavior-track 滤镜。
// 噪声场驱动 UV 位移：uv += (noise(uv*uScale + uTime)*2-1) * uAmount * uInputSize.zw。
// underwater 组合的几何半边。纯坐标位移，pass-through color（同 WarpFilter，不做预乘 alpha 对偶）。
// 需 padding：位移越界，padding = ceil(amount * 像素宽)，amount setter 同步。
import { Filter, GlProgram, defaultFilterVert } from "pixi.js";

const fragment = /* glsl */ `#version 300 es
#pragma vscode_glsllint_stage: frag
precision highp float;

in vec2 vTextureCoord;
out vec4 finalColor;

uniform sampler2D uTexture;
uniform float uTime;     // 时间（由 addModifier/ticker 驱动）
uniform float uAmount;   // 位移强度（UV 比例，0.02 = 2% 纹理宽）
uniform float uScale;   // 噪声场缩放
uniform vec4 uInputSize; // Pixi 自动注入，.zw = (1/width, 1/height)

// 文件作用域噪声（GLSL ES 3.00 禁止嵌套函数定义）。
// 用 sin 组合生成连续平滑位移场，避免 hash21 白噪点导致的撕裂（spec §7.2 的 noise() 近似）。
vec2 displaceNoise(vec2 uv, float t) {
    float nx = sin(uv.x * 6.28318 + t) * 0.5
             + sin(uv.x * 12.566 + t * 1.7) * 0.25;
    float ny = sin(uv.y * 6.28318 + t * 1.3) * 0.5
             + sin(uv.y * 12.566 + t * 2.1) * 0.25;
    return vec2(nx, ny);
}

void main(void)
{
    vec2 n = displaceNoise(vTextureCoord * uScale, uTime);
    // n 范围约 [-0.75, 0.75]，*2-1 归一化到 [-1, 1] 近似
    vec2 offset = (n * 2.0 - 1.0) * uAmount * uInputSize.zw;
    vec2 coord = vTextureCoord + offset;
    finalColor = texture(uTexture, coord);
}
`;

export class DisplaceFilter extends Filter {
  constructor() {
    const glProgram = new GlProgram({
      vertex: defaultFilterVert,
      fragment,
      name: "displace-filter",
    });

    super({
      glProgram,
      resources: {
        filterUniforms: {
          uTime: { value: 0, type: "f32" },
          uAmount: { value: 0.02, type: "f32" },
          uScale: { value: 4.0, type: "f32" },
        },
      },
    });
    // padding 单位是像素；uAmount 是 UV 比例，保守按 amount * 64 估算（char ~64px 宽，
    // block 纹理更大但 padding 宁大勿小；preset 可覆盖，同 warp preset line 81 模式）。
    this.padding = Math.ceil(0.02 * 64);
  }

  get time() { return this.resources.filterUniforms.uniforms.uTime; }
  set time(v: number) { this.resources.filterUniforms.uniforms.uTime = v; }

  get amount() { return this.resources.filterUniforms.uniforms.uAmount; }
  set amount(v: number) {
    this.resources.filterUniforms.uniforms.uAmount = v;
    this.padding = Math.ceil(v * 64);
  }

  get scale() { return this.resources.filterUniforms.uniforms.uScale; }
  set scale(v: number) { this.resources.filterUniforms.uniforms.uScale = v; }
}