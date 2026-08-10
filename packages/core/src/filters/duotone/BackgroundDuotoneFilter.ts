import { Filter, GlProgram, defaultFilterVert } from "pixi.js";

const fragment = /* glsl */ `#version 300 es
#pragma vscode_glsllint_stage: frag
precision highp float;

in vec2 vTextureCoord;
out vec4 finalColor;

uniform sampler2D uTexture;
uniform vec3 uShadow;
uniform vec3 uHighlight;

void main(void)
{
    vec4 c = texture(uTexture, vTextureCoord);
    vec3 rgb = c.a > 0.001 ? c.rgb / c.a : vec3(0.0);
    float luma = dot(rgb, vec3(0.299, 0.587, 0.114));
    vec3 mapped = mix(uShadow, uHighlight, clamp(luma, 0.0, 1.0));
    finalColor = vec4(mapped * c.a, c.a);
}
`;

export class BackgroundDuotoneFilter extends Filter {
  public readonly kmdEffectProfile = "duotone:background";

  constructor() {
    super({
      glProgram: new GlProgram({
        vertex: defaultFilterVert,
        fragment,
        name: "background-duotone-filter",
      }),
      resources: {
        filterUniforms: {
          uShadow: { value: new Float32Array([0.1, 0.1, 0.18]), type: "vec3<f32>" },
          uHighlight: { value: new Float32Array([0.91, 0.27, 0.38]), type: "vec3<f32>" },
        },
      },
    });
  }

  get shadow() {
    return this.resources.filterUniforms.uniforms.uShadow;
  }
  set shadow(value: Float32Array) {
    this.resources.filterUniforms.uniforms.uShadow = value;
  }

  get highlight() {
    return this.resources.filterUniforms.uniforms.uHighlight;
  }
  set highlight(value: Float32Array) {
    this.resources.filterUniforms.uniforms.uHighlight = value;
  }
}
