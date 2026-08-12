import { Filter, GlProgram, defaultFilterVert } from "pixi.js";

// 半调滤镜（网点）：坐标按 uScale 分网格、按 uAngle 旋转，
// 网格内画半径正比于 luma 的点（uShape: 0=dot, 1=line）。
// uInvert: 0=暗部大点（印刷默认，白字上几乎不可见），
//          1=亮部大点（白字黑底场景下用此模式）。
// padding = ceil(scale)（网点可能超出边界）。预乘 alpha 对偶。
// 推荐作用域 :block（需连续区域才成网点视觉）。
const fragment = /* glsl */ `#version 300 es
#pragma vscode_glsllint_stage: frag
precision highp float;

in vec2 vTextureCoord;
out vec4 finalColor;

uniform sampler2D uTexture;
uniform float uScale;          // 网格大小（像素）
uniform float uAngle;          // 网格旋转角度（度）
uniform float uShape;          // 0=圆点, 1=线条
uniform float uInvert;         // 0=暗部大点, 1=亮部大点
uniform vec4 uInputSize;       // Pixi 系统自动注入，.xy = (width, height)

float luma(vec3 rgb) {
    return dot(rgb, vec3(0.299, 0.587, 0.114));
}

void main(void)
{
    // 纹理空间像素坐标
    vec2 pixel = vTextureCoord * uInputSize.xy;

    // 旋转网格
    float rad = radians(uAngle);
    vec2 rotated = vec2(
        pixel.x * cos(rad) - pixel.y * sin(rad),
        pixel.x * sin(rad) + pixel.y * cos(rad)
    );

    // 网格中心坐标（0~1 within cell）
    vec2 cell = fract(rotated / uScale);
    vec2 toCenter = cell - 0.5;
    float dist = length(toCenter);

    vec4 c = texture(uTexture, vTextureCoord);
    vec3 rgb = c.a > 0.001 ? c.rgb / c.a : vec3(0.0);
    float l = luma(rgb);

    // 点半径：invert=0 时暗部大点(1-l)，invert=1 时亮部大点(l)
    float dotLuma = mix(1.0 - l, l, uInvert);
    float dotRadius = dotLuma * 0.5;

    float mask;
    if (uShape < 0.5) {
        // 圆点：dist < dotRadius 则保留
        mask = smoothstep(dotRadius + 0.05, dotRadius - 0.05, dist);
    } else {
        // 线条：按 toCenter.y（旋转后纵向）取带
        float bandLuma = dotLuma;
        float bandRadius = bandLuma * 0.5;
        mask = smoothstep(bandRadius + 0.05, bandRadius - 0.05, abs(toCenter.y));
    }

    // 网点为黑（mask=1），间隙为原色（mask=0）
    vec3 result = mix(rgb, vec3(0.0), mask);

    finalColor = vec4(result * c.a, c.a);
}
`;

export class HalftoneFilter extends Filter {
  constructor() {
    const glProgram = new GlProgram({
      vertex: defaultFilterVert,
      fragment,
      name: "halftone-filter",
    });

    super({
      glProgram,
      resources: {
        filterUniforms: {
          uScale: { value: 6, type: "f32" },
          uAngle: { value: 0, type: "f32" },
          uShape: { value: 0, type: "f32" },
          uInvert: { value: 0, type: "f32" },
        },
      },
    });
  }

  get scale() {
    return this.resources.filterUniforms.uniforms.uScale;
  }
  set scale(value: number) {
    this.resources.filterUniforms.uniforms.uScale = value;
    this.padding = Math.ceil(Math.max(value, 1));
  }

  get angle() {
    return this.resources.filterUniforms.uniforms.uAngle;
  }
  set angle(value: number) {
    this.resources.filterUniforms.uniforms.uAngle = value;
  }

  get shape() {
    return this.resources.filterUniforms.uniforms.uShape;
  }
  set shape(value: number) {
    this.resources.filterUniforms.uniforms.uShape = value;
  }

  get invert() {
    return this.resources.filterUniforms.uniforms.uInvert;
  }
  set invert(value: number) {
    this.resources.filterUniforms.uniforms.uInvert = value;
  }
}