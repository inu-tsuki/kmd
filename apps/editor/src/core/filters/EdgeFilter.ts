import { Filter, GlProgram, defaultFilterVert } from "pixi.js";

// 描边滤镜（alpha 内描边）：在文字边缘内 uWidth 像素宽的带上用 uColor 着色。
// 区别于 outline（外描边，膨胀扩展到文字外）：edge 是内描边，
// 在文字边缘像素上着色，类似 CSS -webkit-text-stroke。
//
// 算法：在 uWidth 距离上 8 方向采样 alpha 的最小值 outerMin。
// 距边缘 ≤ uWidth 的像素 outerMin < 1 → edgeBand > 0。
// 用像素自身 alpha a 限制（只在文字内着色，不溢出到外部），
// 不用 1px 邻居 min 限制（AA 边缘 innerMin<1 会压掉真正的视觉边缘）。
// 小字号保护：笔画核心 outerMin=1 → edgeBand=0（不着色）；
// 薄笔画 a 本身就低 → edgeBand 被 a 限制（不全变描边色）。
// padding = ceil(uWidth)。预乘 alpha 对偶。
const fragment = /* glsl */ `#version 300 es
#pragma vscode_glsllint_stage: frag
precision highp float;

in vec2 vTextureCoord;
out vec4 finalColor;

uniform sampler2D uTexture;
uniform float uWidth;          // 描边带宽度（像素）
uniform vec3  uColor;          // 描边色 (0~1)
uniform float uMix;            // 0=原图色，1=纯描边色
uniform vec4 uInputSize;       // Pixi 系统自动注入，.zw = (1/width, 1/height)
uniform vec4 uInputClamp;      // Pixi 系统自动注入，纹理安全边界

#define SAMPLEA(off) texture(uTexture, clamp(vTextureCoord + (off), uInputClamp.xy, uInputClamp.zw)).a

void main(void)
{
    vec4 c = texture(uTexture, vTextureCoord);
    float a = c.a;

    // uWidth 距离 8 方向采样 alpha 最小值
    vec2 outer = uWidth * uInputSize.zw;
    float outerMin = 1.0;
    outerMin = min(outerMin, SAMPLEA(vec2(-outer.x, -outer.y)));
    outerMin = min(outerMin, SAMPLEA(vec2( 0.0,    -outer.y)));
    outerMin = min(outerMin, SAMPLEA(vec2( outer.x, -outer.y)));
    outerMin = min(outerMin, SAMPLEA(vec2(-outer.x,  0.0)));
    outerMin = min(outerMin, SAMPLEA(vec2( outer.x,  0.0)));
    outerMin = min(outerMin, SAMPLEA(vec2(-outer.x,  outer.y)));
    outerMin = min(outerMin, SAMPLEA(vec2( 0.0,     outer.y)));
    outerMin = min(outerMin, SAMPLEA(vec2( outer.x,  outer.y)));

    #undef SAMPLEA

    // edgeBand = a（只在文字内）× (1 - outerMin)（uWidth 内有透明 = 近边缘）
    // 笔画核心：a=1, outerMin=1 → 0（原色保留）
    // 笔画边缘：a=1, outerMin=0 → 1（描边色）
    // AA 边缘：a<1 但 outerMin=0 → edgeBand=a（按透明度比例着色，不丢失视觉边缘）
    // 薄笔画：a 本身低 → edgeBand 限于 a（不全变描边色）
    float edgeBand = a * (1.0 - outerMin);
    edgeBand = smoothstep(0.0, 0.15, edgeBand);

    // 安全去预乘 alpha
    vec3 rgb = c.a > 0.001 ? c.rgb / c.a : vec3(0.0);
    vec3 result = mix(rgb, uColor, edgeBand * uMix);

    finalColor = vec4(result * a, a);
}
`;

export class EdgeFilter extends Filter {
  constructor() {
    const glProgram = new GlProgram({
      vertex: defaultFilterVert,
      fragment,
      name: "edge-filter",
    });

    super({
      glProgram,
      resources: {
        filterUniforms: {
          uWidth: { value: 1, type: "f32" },
          uColor: { value: new Float32Array([0, 0, 0]), type: "vec3<f32>" },
          uMix: { value: 0.9, type: "f32" },
        },
      },
    });
    this.padding = 1;
  }

  get width() {
    return this.resources.filterUniforms.uniforms.uWidth;
  }
  set width(value: number) {
    this.resources.filterUniforms.uniforms.uWidth = value;
    this.padding = Math.ceil(Math.max(value, 1));
  }

  get color() {
    return this.resources.filterUniforms.uniforms.uColor;
  }
  set color(value: Float32Array) {
    this.resources.filterUniforms.uniforms.uColor = value;
  }

  get mix() {
    return this.resources.filterUniforms.uniforms.uMix;
  }
  set mix(value: number) {
    this.resources.filterUniforms.uniforms.uMix = value;
  }
}