// 扫描线 (Scanline) —— DIP-FX M2 氛围集，behavior-track 滤镜。
// 周期亮度调制 sin(uv.y * density * height + time) + 可选桶形畸变 + 闪烁。
// CRT/赛博朋克核心视觉。推荐 :block。预乘 alpha 对偶。
import { Filter, GlProgram, defaultFilterVert } from "pixi.js";

const fragment = /* glsl */ `#version 300 es
#pragma vscode_glsllint_stage: frag
precision highp float;

in vec2 vTextureCoord;
out vec4 finalColor;

uniform sampler2D uTexture;
uniform float uTime;       // 时间（由 addModifier/ticker 驱动）
uniform float uDensity;    // 扫描线密度
uniform float uCurvature;  // 桶形畸变 (0=无)
uniform float uFlicker;    // 闪烁强度 (0=无)
uniform vec4 uInputSize;   // Pixi 自动注入，.y = texture height

void main(void)
{
    vec2 uv = vTextureCoord;
    // 桶形畸变
    if (uCurvature > 0.0) {
        vec2 cc = uv - 0.5;
        float r2 = dot(cc, cc);
        uv += cc * r2 * uCurvature;
    }
    vec4 c = texture(uTexture, uv);
    // 预乘 alpha 对偶
    vec3 rgb = c.a > 0.001 ? c.rgb / c.a : vec3(0.0);
    // 扫描线：sin(y * density * height + time)
    float scan = 0.5 + 0.5 * sin(uv.y * uDensity * uInputSize.y + uTime);
    // 闪烁
    float flicker = 1.0 - uFlicker * (0.5 + 0.5 * sin(uTime * 7.0));
    rgb *= scan * flicker;
    finalColor = vec4(rgb * c.a, c.a);
}
`;

export class ScanlineFilter extends Filter {
  constructor() {
    const glProgram = new GlProgram({
      vertex: defaultFilterVert,
      fragment,
      name: "scanline-filter",
    });
    super({
      glProgram,
      resources: {
        filterUniforms: {
          uTime: { value: 0, type: "f32" },
          uDensity: { value: 2.0, type: "f32" },
          uCurvature: { value: 0.0, type: "f32" },
          uFlicker: { value: 0.0, type: "f32" },
        },
      },
    });
  }

  get time() { return this.resources.filterUniforms.uniforms.uTime; }
  set time(v: number) { this.resources.filterUniforms.uniforms.uTime = v; }

  get density() { return this.resources.filterUniforms.uniforms.uDensity; }
  set density(v: number) { this.resources.filterUniforms.uniforms.uDensity = v; }

  get curvature() { return this.resources.filterUniforms.uniforms.uCurvature; }
  set curvature(v: number) { this.resources.filterUniforms.uniforms.uCurvature = v; }

  get flicker() { return this.resources.filterUniforms.uniforms.uFlicker; }
  set flicker(v: number) { this.resources.filterUniforms.uniforms.uFlicker = v; }
}