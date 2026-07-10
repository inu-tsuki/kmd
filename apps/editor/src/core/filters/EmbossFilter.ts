import { Filter, GlProgram, defaultFilterVert } from "pixi.js";

// 浮雕滤镜（alpha 梯度 + 多步长斜坡）：对 alpha 通道做方向梯度，
// 多步长采样生成 heightmap 斜坡，让平坦文字内部也产生 3D 凹凸感。
//
// 核心修复：原版从 RGB luma 计算梯度，但单色文字内部 luma 恒定 →
// 梯度=0 → 死板中灰。改为从 alpha 通道计算梯度：文字边缘的 alpha
// 从 0→1 过渡是天然的 heightmap。多步长采样（1px + uWidth px）让
// 边缘斜坡延伸到文字内部，产生圆润饱满的浮雕受光面。
//
// 也可与 f.blur.emboss 链式组合（blur 先软化 alpha 边缘 → emboss
// 在更宽的斜坡上计算梯度），但单用也有效。
// 预乘 alpha 对偶。padding = ceil(uWidth)。
// 默认 mix=0.5（叠加心智：浮雕灰阶叠加在原图之上，不替换整字色）。
const fragment = /* glsl */ `#version 300 es
#pragma vscode_glsllint_stage: frag
precision highp float;

in vec2 vTextureCoord;
out vec4 finalColor;

uniform sampler2D uTexture;
uniform float uStrength;       // 浮雕强度
uniform float uAngle;          // 梯度方向（度）
uniform float uMix;            // 0=原图，1=纯浮雕灰阶
uniform float uWidth;          // 斜坡延伸宽度（像素），控制浮雕厚度
uniform vec4 uInputSize;       // Pixi 系统自动注入，.zw = (1/width, 1/height)
uniform vec4 uInputClamp;      // Pixi 系统自动注入，纹理安全边界

#define SAMPLEA(off) texture(uTexture, clamp(vTextureCoord + (off), uInputClamp.xy, uInputClamp.zw)).a

void main(void)
{
    vec4 c = texture(uTexture, vTextureCoord);

    // 方向向量（按角度旋转）
    float rad = radians(uAngle);
    vec2 dir = vec2(cos(rad), sin(rad));

    // 多步长 alpha 采样：1px 细节 + uWidth 像素斜坡
    // 近步长捕捉边缘锐变，远步长让斜坡延伸到文字内部
    vec2 step1 = uInputSize.zw;
    vec2 stepW = uWidth * uInputSize.zw;

    float aNeg1 = SAMPLEA(-dir * step1);
    float aPos1 = SAMPLEA( dir * step1);
    float aNegW = SAMPLEA(-dir * stepW);
    float aPosW = SAMPLEA( dir * stepW);

    #undef SAMPLEA

    // alpha 梯度：近步长（细节）+ 远步长（斜坡）加权
    float grad1 = aPos1 - aNeg1;  // 1px 细节梯度
    float gradW = aPosW - aNegW;  // uWidth 斜坡梯度
    float grad = grad1 * 0.6 + gradW * 0.4;

    // 浮雕灰阶 = 梯度 * 强度 + 0.5 偏置
    float emboss = clamp(grad * uStrength + 0.5, 0.0, 1.0);

    // 安全去预乘 alpha
    vec3 rgb = c.a > 0.001 ? c.rgb / c.a : vec3(0.0);
    vec3 result = mix(rgb, vec3(emboss), uMix);

    finalColor = vec4(result * c.a, c.a);
}
`;

export class EmbossFilter extends Filter {
  public readonly kmdEffectProfile = "emboss:text";

  constructor() {
    const glProgram = new GlProgram({
      vertex: defaultFilterVert,
      fragment,
      name: "emboss-filter",
    });

    super({
      glProgram,
      resources: {
        filterUniforms: {
          uStrength: { value: 1, type: "f32" },
          uAngle: { value: 45, type: "f32" },
          uMix: { value: 0.5, type: "f32" },
          uWidth: { value: 3, type: "f32" },
        },
      },
    });
    this.padding = 3;
  }

  get strength() {
    return this.resources.filterUniforms.uniforms.uStrength;
  }
  set strength(value: number) {
    this.resources.filterUniforms.uniforms.uStrength = value;
  }

  get angle() {
    return this.resources.filterUniforms.uniforms.uAngle;
  }
  set angle(value: number) {
    this.resources.filterUniforms.uniforms.uAngle = value;
  }

  get mix() {
    return this.resources.filterUniforms.uniforms.uMix;
  }
  set mix(value: number) {
    this.resources.filterUniforms.uniforms.uMix = value;
  }

  get width() {
    return this.resources.filterUniforms.uniforms.uWidth;
  }
  set width(value: number) {
    this.resources.filterUniforms.uniforms.uWidth = value;
    this.padding = Math.ceil(Math.max(value, 1));
  }
}
