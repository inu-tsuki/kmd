import { Filter, GlProgram, defaultFilterVert } from "pixi.js";

const fragment = /* glsl */ `#version 300 es
#pragma vscode_glsllint_stage: frag
precision highp float;

in vec2 vTextureCoord;
out vec4 finalColor;

uniform sampler2D uTexture;
uniform float uStrength;
uniform float uAngle;
uniform float uMix;
uniform float uWidth;
uniform vec4 uInputSize;
uniform vec4 uInputClamp;

float sampleLuma(vec2 uv)
{
    vec4 c = texture(uTexture, clamp(uv, uInputClamp.xy, uInputClamp.zw));
    vec3 rgb = c.a > 0.001 ? c.rgb / c.a : vec3(0.0);
    return dot(rgb, vec3(0.299, 0.587, 0.114));
}

void main(void)
{
    vec4 c = texture(uTexture, vTextureCoord);
    vec3 rgb = c.a > 0.001 ? c.rgb / c.a : vec3(0.0);
    float rad = radians(uAngle);
    vec2 dir = vec2(cos(rad), sin(rad));
    vec2 step1 = uInputSize.zw;
    vec2 stepW = uWidth * uInputSize.zw;
    float grad1 = sampleLuma(vTextureCoord + dir * step1) - sampleLuma(vTextureCoord - dir * step1);
    float gradW = sampleLuma(vTextureCoord + dir * stepW) - sampleLuma(vTextureCoord - dir * stepW);
    float emboss = clamp((grad1 * 0.6 + gradW * 0.4) * uStrength + 0.5, 0.0, 1.0);
    vec3 result = mix(rgb, vec3(emboss), uMix);
    finalColor = vec4(result * c.a, c.a);
}
`;

export class BackgroundEmbossFilter extends Filter {
  public readonly kmdEffectProfile = "emboss:background";

  constructor() {
    super({
      glProgram: new GlProgram({
        vertex: defaultFilterVert,
        fragment,
        name: "background-emboss-filter",
      }),
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
