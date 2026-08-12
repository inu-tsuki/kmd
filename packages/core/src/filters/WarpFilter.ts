import { Filter, GlProgram, defaultFilterVert } from "pixi.js";

const fragment = /* glsl */ `#version 300 es
#pragma vscode_glsllint_stage: frag
precision highp float;

in vec2 vTextureCoord;
out vec4 finalColor;

uniform sampler2D uTexture;
uniform float uTime;      // 时间变量，让它动起来
uniform float uFrequency; // 频率 (波浪的密集程度)
uniform float uAmplitude; // 振幅 (扭曲的程度)

void main(void)
{
    // 核心算法：根据 Y 坐标计算 X 的偏移量
    // offset = sin(y * freq + time) * amp
    float offsetX = sin(vTextureCoord.y * uFrequency + uTime) * uAmplitude;
    
    // 计算新的纹理坐标
    vec2 coord = vec2(vTextureCoord.x + offsetX, vTextureCoord.y);
    
    // 采样
    finalColor = texture(uTexture, coord);
}
`;

export class WarpFilter extends Filter {
  constructor() {
    const glProgram = new GlProgram({
      vertex: defaultFilterVert,
      fragment,
      name: "warp-filter",
    });

    super({
      glProgram,
      resources: {
        warpUniforms: {
          uTime: { value: 0, type: "f32" },
          uFrequency: { value: 10.0, type: "f32" },
          uAmplitude: { value: 0.05, type: "f32" }, // 0.05 对应 UV 坐标，大约 5% 的宽度
        },
      },
    });
  }

  // 暴露属性方便修改
  get time() {
    return this.resources.warpUniforms.uniforms.uTime;
  }
  set time(v: number) {
    this.resources.warpUniforms.uniforms.uTime = v;
  }

  get frequency() {
    return this.resources.warpUniforms.uniforms.uFrequency;
  }
  set frequency(v: number) {
    this.resources.warpUniforms.uniforms.uFrequency = v;
  }

  get amplitude() {
    return this.resources.warpUniforms.uniforms.uAmplitude;
  }
  set amplitude(v: number) {
    this.resources.warpUniforms.uniforms.uAmplitude = v;
  }
}
