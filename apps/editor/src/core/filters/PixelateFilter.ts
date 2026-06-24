import { Filter, GlProgram, defaultFilterVert } from "pixi.js";

// 像素化滤镜（下采样）：把 vTextureCoord 量化到 size×size 像素网格中心后采样。
// DIP-FX M0 参考实现——后续滤镜的代码模板。
// 纯逐像素下采样，不采样邻域，无需 padding。
const fragment = /* glsl */ `#version 300 es
#pragma vscode_glsllint_stage: frag
precision highp float;

in vec2 vTextureCoord;
out vec4 finalColor;

uniform sampler2D uTexture;
uniform float uSize;          // 像素块边长（屏幕像素）
uniform vec4 uInputSize;      // Pixi 系统自动注入，.zw = (1/width, 1/height)

void main(void)
{
    // 像素块大小转成 UV 步长
    vec2 px = uSize * uInputSize.zw;
    // 量化到网格中心
    vec2 uv = (floor(vTextureCoord / px) + 0.5) * px;
    finalColor = texture(uTexture, uv);
}
`;

export class PixelateFilter extends Filter {
  constructor() {
    const glProgram = new GlProgram({
      vertex: defaultFilterVert,
      fragment,
      name: "pixelate-filter",
    });

    super({
      glProgram,
      resources: {
        filterUniforms: {
          uSize: { value: 8, type: "f32" },
        },
      },
    });
  }

  get size() {
    return this.resources.filterUniforms.uniforms.uSize;
  }
  set size(value: number) {
    this.resources.filterUniforms.uniforms.uSize = value;
  }
}
