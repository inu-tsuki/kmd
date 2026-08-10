// 暗角 (Vignette) —— DIP-FX M2 氛围集，静态 instant 滤镜。
// 径向亮度衰减：smoothstep(uRadius, uRadius - uSoftness, dist(uv, 0.5))。
// 推荐 :block（整段才有暗角语义）。预乘 alpha 对偶。
import { Filter, GlProgram, defaultFilterVert } from "pixi.js";

const fragment = /* glsl */ `#version 300 es
#pragma vscode_glsllint_stage: frag
precision highp float;

in vec2 vTextureCoord;
out vec4 finalColor;

uniform sampler2D uTexture;
uniform float uRadius;     // 暗角起始半径 (0.5-1.0)
uniform float uSoftness;   // 柔和度 (0.1-0.5)

void main(void)
{
    vec4 c = texture(uTexture, vTextureCoord);
    // 预乘 alpha 对偶：先除 alpha 运算再乘回
    vec3 rgb = c.a > 0.001 ? c.rgb / c.a : vec3(0.0);
    float dist = distance(vTextureCoord, vec2(0.5));
    float vignette = smoothstep(uRadius, uRadius - uSoftness, dist);
    rgb *= vignette;
    finalColor = vec4(rgb * c.a, c.a);
}
`;

export class VignetteFilter extends Filter {
  constructor() {
    const glProgram = new GlProgram({
      vertex: defaultFilterVert,
      fragment,
      name: "vignette-filter",
    });
    super({
      glProgram,
      resources: {
        filterUniforms: {
          uRadius: { value: 0.75, type: "f32" },
          uSoftness: { value: 0.45, type: "f32" },
        },
      },
    });
  }

  get radius() { return this.resources.filterUniforms.uniforms.uRadius; }
  set radius(v: number) { this.resources.filterUniforms.uniforms.uRadius = v; }

  get softness() { return this.resources.filterUniforms.uniforms.uSoftness; }
  set softness(v: number) { this.resources.filterUniforms.uniforms.uSoftness = v; }
}