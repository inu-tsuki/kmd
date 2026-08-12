import { Filter, GlProgram, defaultFilterVert, BlurFilter, TexturePool } from "pixi.js";

// 辉光滤镜（多通道：亮部提取 → BlurFilter 平滑模糊 → screen 合成）。
//
// 单通道 16-tap 在高参数下产生颗粒感（大半径采样空隙 + IGN 抖动方差
// 被高强度放大）。改为多通道架构（BlurFilter 范式）：
// 1. Extract pass：阈值提取亮部 → brightTex（透明背景上的亮部像素）
// 2. Blur pass：复用 Pixi BlurFilter（分离高斯多通道，丝滑无噪点）
// 3. Composite pass：uTexture = blurredBrights + uOriginal = 原图，
//    screen 合成 result = 1-(1-orig)(1-bright*strength)，alpha 扩散到字外。
//
// 仍返回单个 Filter 实例（InstantCleanup 记录一个，seek 幂等简单）。
// padding = ceil(radius*2)（blur 扩散范围）。

// ── Extract shader：阈值提取亮部，输出到透明背景 ──
const extractFrag = /* glsl */ `#version 300 es
#pragma vscode_glsllint_stage: frag
precision highp float;

in vec2 vTextureCoord;
out vec4 finalColor;

uniform sampler2D uTexture;
uniform float uThreshold;
uniform vec4 uInputSize;

float luma(vec3 rgb) {
    return dot(rgb, vec3(0.299, 0.587, 0.114));
}

void main(void) {
    vec4 c = texture(uTexture, vTextureCoord);
    vec3 rgb = c.a > 0.001 ? c.rgb / c.a : vec3(0.0);
    float l = luma(rgb);
    float bright = smoothstep(uThreshold, uThreshold + 0.1, l);
    // 提取的亮部保留原色 × bright，alpha 也乘 bright（为 blur 提供扩散源）
    float outAlpha = c.a * bright;
    finalColor = vec4(rgb * outAlpha, outAlpha);
}
`;

// ── Composite shader：uTexture = blurred brights, uOriginal = 原图 ──
const compositeFrag = /* glsl */ `#version 300 es
#pragma vscode_glsllint_stage: frag
precision highp float;

in vec2 vTextureCoord;
out vec4 finalColor;

uniform sampler2D uTexture;    // blurred brights（来自 blur pass）
uniform sampler2D uOriginal;   // 原图（apply() 中动态绑定）
uniform float uStrength;
uniform vec4 uInputSize;

void main(void) {
    vec4 c = texture(uOriginal, vTextureCoord);       // 原图
    vec4 blurred = texture(uTexture, vTextureCoord);   // 模糊亮部

    // 安全去预乘
    vec3 rgb = c.a > 0.001 ? c.rgb / c.a : vec3(0.0);
    vec3 brightRgb = blurred.a > 0.001 ? blurred.rgb / blurred.a : vec3(0.0);

    // 胶片级曝光混合 (Tone-mapped Exposure Blend)
    // 替代 Screen 混合，防止高 strength 下中心烧成死白。
    // rgb + (1-rgb)(1-exp(-glowColor))：exp(-x) 提供"软刹车"高光衰减，
    // 弱通道（如金色字的 B 通道）在高强度下仍保留色彩过渡而非瞬间拉满。
    vec3 glowColor = brightRgb * uStrength;
    vec3 screened = rgb + (1.0 - rgb) * (1.0 - exp(-glowColor));

    // alpha 扩散：max(原图 alpha, 模糊亮部 alpha × strength)
    float outAlpha = clamp(max(c.a, blurred.a * uStrength), 0.0, 1.0);
    finalColor = vec4(screened * outAlpha, outAlpha);
}
`;

export class BloomFilter extends Filter {
  private _threshold = 0.7;
  private _strength = 1;
  private _radius = 4;
  private _blurFilter: BlurFilter;
  private _extractFilter: Filter;
  private _compositeFilter: Filter;

  constructor() {
    const glProgram = new GlProgram({
      vertex: defaultFilterVert,
      fragment: compositeFrag,
      name: "bloom-composite",
    });

    super({
      glProgram,
      resources: {
        filterUniforms: {
          uStrength: { value: 1, type: "f32" },
        },
      },
    });

    // uOriginal 需要绑定到独立的 group（group 0 被 FilterSystem 的
    // _globalFilterBindGroup 覆盖，只含 uTexture）。用 group 1 存原图纹理。
    // GLSL ES 3.00 中 sampler2D 跨 group 由 Pixi 自动映射 binding point。
    this.addResource("uOriginal", 1, 0);

    // 子 filter 1：亮部提取
    const extractProg = new GlProgram({
      vertex: defaultFilterVert,
      fragment: extractFrag,
      name: "bloom-extract",
    });
    this._extractFilter = new Filter({
      glProgram: extractProg,
      resources: {
        filterUniforms: {
          uThreshold: { value: 0.7, type: "f32" },
        },
      },
    });

    // 子 filter 2：Pixi BlurFilter（分离高斯多通道，丝滑无噪点）
    this._blurFilter = new BlurFilter({ strength: 4, quality: 4 });

    // 子 filter 3：合成（本 BloomFilter 自身的 shader 即 composite）
    // 用 composite shader 作为主 glProgram，apply() 中手动编排
    this._compositeFilter = this;  // self — composite shader is this.glProgram
  }

  // apply 编排：extract → blur → composite
  apply(filterManager: any, input: any, output: any, clearMode: any) {
    // 1. 分配临时纹理存亮部
    const brightTex = TexturePool.getSameSizeTexture(input);

    // 2. Extract pass：input → brightTex（阈值提取亮部）
    this._extractFilter.resources.filterUniforms.uniforms.uThreshold = this._threshold;
    filterManager.applyFilter(this._extractFilter, input, brightTex, true);

    // 3. Blur pass：brightTex → brightTex（Pixi BlurFilter 多通道平滑模糊）
    this._blurFilter.strength = this._radius;
    this._blurFilter.apply(filterManager, brightTex, brightTex, true);

    // 4. Composite pass：brightTex (uTexture) + input (uOriginal) → output
    //    原图纹理绑定到 group 1（uOriginal），不被 FilterSystem group 0 覆盖
    this.resources.filterUniforms.uniforms.uStrength = this._strength;
    if (this.groups[1]) {
      this.groups[1].setResource(input.source, 0);
    }
    filterManager.applyFilter(this._compositeFilter, brightTex, output, clearMode);

    // 5. 释放临时纹理
    TexturePool.returnTexture(brightTex);
  }

  // ── 公开属性 ──

  get threshold() { return this._threshold; }
  set threshold(value: number) { this._threshold = value; }

  get strength() { return this._strength; }
  set strength(value: number) { this._strength = value; }

  get radius() { return this._radius; }
  set radius(value: number) {
    this._radius = value;
    this.padding = Math.ceil(Math.max(value, 1)) * 2;
  }

  // override destroy：seek/stop 清理只 destroy 外层 BloomFilter，
  // 内部 _extractFilter / _blurFilter 的 shader/bind group 需显式销毁。
  // Pixi v8 BlurFilter 持有 blurXFilter/blurYFilter 且未 override destroy()（§B-bis：BlurFilter.destroy 不递归子 pass），
  // 需先销毁这两个内部 pass 再销毁 _blurFilter 自身。
  destroy(destroyPrograms = false) {
    this._extractFilter.destroy(destroyPrograms);
    const blur = this._blurFilter as any;
    blur.blurXFilter?.destroy(destroyPrograms);
    blur.blurYFilter?.destroy(destroyPrograms);
    this._blurFilter.destroy(destroyPrograms);
    super.destroy(destroyPrograms);
  }
}