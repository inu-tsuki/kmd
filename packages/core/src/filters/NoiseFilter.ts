// 噪声 (Noise) —— DIP-FX M2 氛围集，behavior-track 滤镜。
// 时变噪声叠加，uMono 控制单色/彩噪。数字降解视觉。
// 文件作用域 hash21（GLSL ES 3.00 禁止嵌套函数定义）。预乘 alpha 对偶。
import { Filter, GlProgram, defaultFilterVert } from "pixi.js";

const fragment = /* glsl */ `#version 300 es
#pragma vscode_glsllint_stage: frag
precision highp float;

in vec2 vTextureCoord;
out vec4 finalColor;

uniform sampler2D uTexture;
uniform float uTime;     // 时间（由 addModifier/ticker 驱动）
uniform float uAmount;   // 噪声强度 (0-1)
uniform float uMono;     // 1=单色, 0=彩噪
uniform float uScale;    // 噪声场缩放

// 文件作用域 hash 噪声（GLSL ES 3.00 禁止嵌套函数定义，见 edge M1 bug）
float hash21(vec2 p) {
    p = fract(p * vec2(234.34, 435.345));
    p += dot(p, p + 34.23);
    return fract(p.x * p.y);
}

void main(void)
{
    vec4 c = texture(uTexture, vTextureCoord);
    // 预乘 alpha 对偶
    vec3 rgb = c.a > 0.001 ? c.rgb / c.a : vec3(0.0);
    vec2 noiseUV = vTextureCoord * uScale + uTime;
    if (uMono > 0.5) {
        float n = hash21(noiseUV);
        rgb = mix(rgb, vec3(n), uAmount);
    } else {
        vec3 noise = vec3(
            hash21(noiseUV + 10.0),
            hash21(noiseUV + 20.0),
            hash21(noiseUV + 30.0)
        );
        rgb = mix(rgb, noise, uAmount);
    }
    finalColor = vec4(rgb * c.a, c.a);
}
`;

export class NoiseFilter extends Filter {
  constructor() {
    const glProgram = new GlProgram({
      vertex: defaultFilterVert,
      fragment,
      name: "noise-filter",
    });
    super({
      glProgram,
      resources: {
        filterUniforms: {
          uTime: { value: 0, type: "f32" },
          uAmount: { value: 0.1, type: "f32" },
          uMono: { value: 1.0, type: "f32" },
          uScale: { value: 4.0, type: "f32" },
        },
      },
    });
  }

  get time() { return this.resources.filterUniforms.uniforms.uTime; }
  set time(v: number) { this.resources.filterUniforms.uniforms.uTime = v; }

  get amount() { return this.resources.filterUniforms.uniforms.uAmount; }
  set amount(v: number) { this.resources.filterUniforms.uniforms.uAmount = v; }

  get mono() { return this.resources.filterUniforms.uniforms.uMono; }
  set mono(v: number) { this.resources.filterUniforms.uniforms.uMono = v; }

  get scale() { return this.resources.filterUniforms.uniforms.uScale; }
  set scale(v: number) { this.resources.filterUniforms.uniforms.uScale = v; }
}