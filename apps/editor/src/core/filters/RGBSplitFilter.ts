import { Filter, GlProgram, defaultFilterVert } from "pixi.js";

// 1. 我们只写片元着色器
// Pixi 默认顶点着色器会传递 vTextureCoord 和 uInputSize
const fragment = /* glsl */ `#version 300 es
#pragma vscode_glsllint_stage: frag
precision highp float;

in vec2 vTextureCoord;
out vec4 finalColor;

uniform sampler2D uTexture;
uniform vec2 uOffset;
uniform vec4 uInputSize; // Pixi 系统自动注入

void main(void) 
{
    // uInputSize.zw = (1/width, 1/height)
    vec2 dir = uOffset * uInputSize.zw; 
    
    vec4 red = texture(uTexture, vTextureCoord - dir);
    vec4 green = texture(uTexture, vTextureCoord);
    vec4 blue = texture(uTexture, vTextureCoord + dir);
    
    finalColor = vec4(red.r, green.g, blue.b, green.a);
}
`;

export class RGBSplitFilter extends Filter {
  constructor() {
    const glProgram = new GlProgram({
      // 【关键修复】不传 vertex，使用默认值
      // 为了确保兼容，我们可以显式传入 pixi 导出的 defaultFilterVert，
      // 或者直接留空让它回退。最稳妥是使用 defaultFilterVert。
      vertex: defaultFilterVert,
      fragment,
      name: "rgb-split-filter",
    });

    super({
      glProgram,
      resources: {
        filterUniforms: {
          uOffset: { value: { x: 5, y: 0 }, type: "vec2<f32>" },
        },
      },
    });
  }

  get offset() {
    return this.resources.filterUniforms.uniforms.uOffset;
  }
  set offset(value: { x: number; y: number }) {
    this.resources.filterUniforms.uniforms.uOffset = value;
  }
}
