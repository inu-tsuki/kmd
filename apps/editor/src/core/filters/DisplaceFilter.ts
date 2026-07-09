// 位移贴图 (Displace) —— DIP-FX M2 氛围集，behavior-track 滤镜。
// 噪声场驱动 UV 位移：uv += noise(uv*uScale + uTime) * uAmount * uInputSize.zw。
// underwater 组合的几何半边。纯坐标位移，pass-through color（同 WarpFilter，不做预乘 alpha 对偶）。
// 需 padding：位移越界，padding = ceil(amount)（amount 是像素值，padding 单位也是像素）。
import { Filter, GlProgram, defaultFilterVert } from "pixi.js";

const fragment = /* glsl */ `#version 300 es
#pragma vscode_glsllint_stage: frag
precision highp float;

in vec2 vTextureCoord;
out vec4 finalColor;

uniform sampler2D uTexture;
uniform float uTime;     // 时间（由 addModifier/ticker 驱动）
uniform float uAmount;   // 位移强度（像素值，10 = 10px 最大位移）
uniform float uScale;   // 噪声场缩放
uniform vec4 uInputSize; // Pixi 自动注入，.zw = (1/width, 1/height)

// 文件作用域噪声（GLSL ES 3.00 禁止嵌套函数定义）。
// 用 sin 组合生成连续平滑位移场，避免 hash21 白噪点导致的撕裂（spec §7.2 的 noise() 近似）。
// 归一到 [-1, 1] 中心对称（sin 范围 [-1,1]，两 sin 叠加再 normalize）。
vec2 displaceNoise(vec2 uv, float t) {
    vec2 n = vec2(
        sin(uv.x * 6.28318 + t) + sin(uv.x * 12.566 + t * 1.7) * 0.5,
        sin(uv.y * 6.28318 + t * 1.3) + sin(uv.y * 12.566 + t * 2.1) * 0.5
    );
    // 两 sin 叠加范围约 [-1.5, 1.5]，clamp 到 [-1,1] 保中心对称（不偏移）。
    return clamp(n, -1.0, 1.0);
}

void main(void)
{
    vec2 n = displaceNoise(vTextureCoord * uScale, uTime);
    // n 已是 [-1,1] 中心对称；amount 是像素值，* uInputSize.zw 转成 UV 偏移。
    vec2 offset = n * uAmount * uInputSize.zw;
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
          uAmount: { value: 10.0, type: "f32" },
          uScale: { value: 4.0, type: "f32" },
        },
      },
    });
    // padding 单位是像素，amount 也是像素值——直接 ceil(amount) 覆盖最大位移。
    this.padding = Math.ceil(10.0);
  }

  get time() { return this.resources.filterUniforms.uniforms.uTime; }
  set time(v: number) { this.resources.filterUniforms.uniforms.uTime = v; }

  get amount() { return this.resources.filterUniforms.uniforms.uAmount; }
  set amount(v: number) {
    this.resources.filterUniforms.uniforms.uAmount = v;
    this.padding = Math.ceil(v);
  }

  get scale() { return this.resources.filterUniforms.uniforms.uScale; }
  set scale(v: number) { this.resources.filterUniforms.uniforms.uScale = v; }
}