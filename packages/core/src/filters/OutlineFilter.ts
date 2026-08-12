import { Filter, GlProgram, defaultFilterVert } from "pixi.js";

// 描边滤镜（形态学膨胀）：对 alpha 做多级半径圆形采样取密度，
// smoothstep 抗锯齿边缘，uColor 上色，uGlow>0 时叠加柔化外发光。
//
// 优化历程：
// 1. 单半径 8 方向采样 → uWidth > 笔画宽度时中空套环（越界）
// 2. 多级半径 8 方向采样 → 填盲区但方角化（对角线 √2 拉伸 + 硬截断无 AA）
// 3. 当前：多级半径 × 16 方向圆形采样（cos/sin）+ 密度 smoothstep AA
//    - 圆形采样：cos/sin 等距分布，完美圆角无方角化
//    - 多级半径：0.25/0.5/0.75/1.0 × uWidth 填盲区防套环
//    - 密度 smoothstep：sumA/16 归一化密度 → smoothstep(0.01,0.12) AA 边缘
//    - 发光：8 方向圆形 + smoothstep(0.01,0.5) 更宽柔化过渡
//
// padding = ceil(width*2)，确保偏移采样不取透明边（含发光扩展）。
const fragment = /* glsl */ `#version 300 es
#pragma vscode_glsllint_stage: frag
precision highp float;

in vec2 vTextureCoord;
out vec4 finalColor;

uniform sampler2D uTexture;
uniform float uWidth;          // 描边宽度（像素）
uniform vec3  uColor;          // 描边色 (0~1)
uniform float uGlow;           // 外发光强度 (0=无)
uniform vec4 uInputSize;       // Pixi 系统自动注入，.zw = (1/width, 1/height)
uniform vec4 uInputClamp;      // Pixi 系统自动注入，纹理安全边界

#define SAMPLE(off) texture(uTexture, clamp(vTextureCoord + (off), uInputClamp.xy, uInputClamp.zw)).a

void main(void)
{
    vec2 step = uWidth * uInputSize.zw;

    // 原始 alpha
    float a = texture(uTexture, vTextureCoord).a;

    // ── 16 方向圆形采样 × 多级半径，计算密度 ──
    // 圆形采样：cos/sin 等距 16 方向，完美圆角（无对角线 √2 方角化）
    // 多级半径：0.25/0.5/0.75/1.0 × step 填盲区防套环
    const float angleStep = 6.2831853 / 16.0;
    float sumA = 0.0;
    for (float r = 0.25; r <= 1.0; r += 0.25) {
        vec2 curStep = step * r;
        for (int i = 0; i < 16; i++) {
            float angle = float(i) * angleStep;
            vec2 offset = vec2(cos(angle), sin(angle)) * curStep;
            sumA += SAMPLE(offset);
        }
    }
    // 归一化密度（4 级 × 16 方向 = 64 tap → /64）
    float density = sumA / 64.0;

    // smoothstep 建立抗锯齿边缘 + 减去原始区域
    float outlineAlpha = smoothstep(0.01, 0.12, density) * (1.0 - a);

    // ── 外发光：更宽圆形采样 + 柔化过渡 ──
    float glowAlpha = 0.0;
    if (uGlow > 0.0) {
        vec2 gstep = step * 2.0;
        const float glowAngleStep = 6.2831853 / 8.0;
        float glowSum = 0.0;
        for (int i = 0; i < 8; i++) {
            float angle = float(i) * glowAngleStep;
            vec2 offset = vec2(cos(angle), sin(angle)) * gstep;
            glowSum += SAMPLE(offset);
        }
        float glowDensity = glowSum / 8.0;
        float glowSoft = smoothstep(0.01, 0.5, glowDensity);
        float outlineSoft = smoothstep(0.01, 0.12, density);
        glowAlpha = clamp(glowSoft - outlineSoft, 0.0, 1.0) * uGlow;
    }

    #undef SAMPLE

    // ── 合成输出 ──
    vec4 c = texture(uTexture, vTextureCoord);
    vec3 rgb = c.a > 0.001 ? c.rgb / c.a : vec3(0.0);

    // 总透明度（原字 alpha + 描边 alpha，互补可直接相加）
    float totalAlpha = clamp(a + outlineAlpha, 0.0, 1.0);

    vec3 outlineRgb = uColor;
    vec3 glowRgb = uColor * 0.7;

    vec3 result = mix(outlineRgb, rgb, a / max(totalAlpha, 1e-4));
    result += glowRgb * glowAlpha;

    finalColor = vec4(result * totalAlpha, totalAlpha);
}
`;

export class OutlineFilter extends Filter {
  constructor() {
    const glProgram = new GlProgram({
      vertex: defaultFilterVert,
      fragment,
      name: "outline-filter",
    });

    super({
      glProgram,
      resources: {
        filterUniforms: {
          uWidth: { value: 2, type: "f32" },
          uColor: { value: new Float32Array([1, 1, 1]), type: "vec3<f32>" },
          uGlow: { value: 0, type: "f32" },
        },
      },
    });
  }

  get width() {
    return this.resources.filterUniforms.uniforms.uWidth;
  }
  set width(value: number) {
    this.resources.filterUniforms.uniforms.uWidth = value;
    // padding ≥ width（发光时 2×），确保偏移采样不取透明边
    this.padding = Math.ceil(value * 2);
  }

  get color() {
    return this.resources.filterUniforms.uniforms.uColor;
  }
  set color(value: Float32Array) {
    this.resources.filterUniforms.uniforms.uColor = value;
  }

  get glow() {
    return this.resources.filterUniforms.uniforms.uGlow;
  }
  set glow(value: number) {
    this.resources.filterUniforms.uniforms.uGlow = value;
  }
}