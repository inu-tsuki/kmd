import { Filter, GlProgram, defaultFilterVert } from "pixi.js";

// 阈值滤镜（alpha 阈值）：对 alpha 做 smoothstep 软阈值，
// alpha < level → 透明，alpha > level → 不透明。
// 比原 RGB luma 阈值更适合文字：单色字的 RGB luma 恒定 → 阈值后
// 整字全白或全黑无变化；而 alpha 在笔画核心与边缘间有梯度，
// 阈值后产生锐利的二值化边缘（笔画核心保留，半透明 AA 边缘裁掉）。
// 纯逐像素，无 padding。
const fragment = /* glsl */ `#version 300 es
#pragma vscode_glsllint_stage: frag
precision highp float;

in vec2 vTextureCoord;
out vec4 finalColor;

uniform sampler2D uTexture;
uniform float uLevel;          // 阈值 (0~1)
uniform float uSoft;           // 软阈值带宽 (0~1)
uniform vec4 uInputSize;       // Pixi 系统自动注入

void main(void)
{
    vec4 c = texture(uTexture, vTextureCoord);

    // 对 alpha 做软阈值：笔画核心（a≈1）保留，AA 边缘（a 低）裁掉
    float v = smoothstep(uLevel - uSoft, uLevel + uSoft, c.a);

    // 保留原色，只修改 alpha → 产生锐利的二值化文字边缘
    vec3 rgb = c.a > 0.001 ? c.rgb / c.a : vec3(0.0);
    float outAlpha = v * c.a;

    finalColor = vec4(rgb * outAlpha, outAlpha);
}
`;

export class ThresholdFilter extends Filter {
  constructor() {
    const glProgram = new GlProgram({
      vertex: defaultFilterVert,
      fragment,
      name: "threshold-filter",
    });

    super({
      glProgram,
      resources: {
        filterUniforms: {
          uLevel: { value: 0.5, type: "f32" },
          uSoft: { value: 0.02, type: "f32" },
        },
      },
    });
  }

  get level() {
    return this.resources.filterUniforms.uniforms.uLevel;
  }
  set level(value: number) {
    this.resources.filterUniforms.uniforms.uLevel = value;
  }

  get soft() {
    return this.resources.filterUniforms.uniforms.uSoft;
  }
  set soft(value: number) {
    this.resources.filterUniforms.uniforms.uSoft = value;
  }
}