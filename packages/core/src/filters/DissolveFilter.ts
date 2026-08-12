// 溶解 (Dissolve) —— DIP-FX M2 氛围集，behavior-track 滤镜。
// 噪声场与 uProgress 阈值比较：低于阈值 alpha=0（消散），边缘带用 uEdge 上色。
// progress 来源：state 对象 + gsap tween（同构 fadeShake），作者可静态 progress= 锁定。
// 文件作用域 hash21（GLSL ES 3.00 禁止嵌套函数定义）。预乘 alpha 对偶。
// 需 padding = ceil(uScale)（噪声场边缘可能越界）。
import { Filter, GlProgram, defaultFilterVert } from "pixi.js";

const fragment = /* glsl */ `#version 300 es
#pragma vscode_glsllint_stage: frag
precision highp float;

in vec2 vTextureCoord;
out vec4 finalColor;

uniform sampler2D uTexture;
uniform float uProgress;  // 溶解进度 (0=完整, 1=全部消散)
uniform float uScale;    // 噪声场缩放
uniform vec3 uEdge;      // 边缘色 (0-1 归一化)

// 文件作用域 hash 噪声（GLSL ES 3.00 禁止嵌套函数定义）
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
    float n = hash21(vTextureCoord * uScale);
    float threshold = uProgress;
    float edgeWidth = 0.05;
    float lower = threshold - edgeWidth;
    float upper = threshold + edgeWidth;

    if (n < lower) {
        // 已消散
        finalColor = vec4(0.0);
    } else if (n < upper) {
        // 边缘带：混合原色和边缘色
        float edge = smoothstep(lower, threshold, n) - smoothstep(threshold, upper, n);
        rgb = mix(rgb, uEdge, edge);
        finalColor = vec4(rgb * c.a, c.a);
    } else {
        // 未消散：保持原样
        finalColor = c;
    }
}
`;

export class DissolveFilter extends Filter {
  constructor() {
    const glProgram = new GlProgram({
      vertex: defaultFilterVert,
      fragment,
      name: "dissolve-filter",
    });
    super({
      glProgram,
      resources: {
        filterUniforms: {
          uProgress: { value: 0.0, type: "f32" },
          uScale: { value: 8.0, type: "f32" },
          uEdge: { value: new Float32Array([1.0, 1.0, 1.0]), type: "vec3<f32>" },
        },
      },
    });
    this.padding = Math.ceil(8);
  }

  get progress() { return this.resources.filterUniforms.uniforms.uProgress; }
  set progress(v: number) { this.resources.filterUniforms.uniforms.uProgress = v; }

  get scale() { return this.resources.filterUniforms.uniforms.uScale; }
  set scale(v: number) {
    this.resources.filterUniforms.uniforms.uScale = v;
    this.padding = Math.ceil(v);
  }

  get edge() { return this.resources.filterUniforms.uniforms.uEdge; }
  set edge(v: Float32Array) { this.resources.filterUniforms.uniforms.uEdge = v; }
}