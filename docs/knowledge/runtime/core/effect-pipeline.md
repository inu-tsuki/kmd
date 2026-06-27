# 特效管线：从 EffectConfig 到屏幕

> 本文档描述视觉特效从解析到渲染的完整管线。
> 理解此文档可以避免 `instanceof` 守卫、`targetType` 不匹配等常见问题。

## 特效元数据 (meta)

每个特效在 `presets/` 目录的分类文件中（`behavior.ts`/`entrance.ts`/`filter.ts`/`visual.ts`/`timing.ts`，由 `presets/index.ts` 用 `export *` 聚合）通过 `defineEffect(fn, meta)` 注册。

> **注意**：`defineEffect` 是每个 preset 文件内联的本地 helper（`presets/filter.ts:7`），不从外部 import；新 preset 必须写进既有分类文件或新建文件并在 `index.ts` 加 `export *`。`EffectManager` 构造时 `registerBatch(Presets)` 自动注册，**无需改 `Parser.validate()` 白名单**——`f.xxx` 命令经 `registryView.has()` 链自动 known。

```typescript
export const wave = defineEffect(_wave, {
  type: "behavior",       // behavior | action
  track: "behavior",      // entrance | behavior | instant | timing
  targetType: "char",     // char | group | both
  mutexGroup: "position", // 同 mutex 组互斥
  stackable: true,        // 允许同 mutex 叠加
});
```

**`targetType` 决定 apply 时的目标对象**：
- `"char"` → `effectManager.apply(kineticChar, ...)` — 特效实现内有 `instanceof KineticChar` 守卫
- `"group"` → `effectManager.apply(tokenWrapper, ...)` — 作用于容器
- `"both"` → 同时支持 char 和 group/container

## 四轨分类 (`EffectProcessor.classifyByTrack`)

| Track | 时间驱动 | seek 行为 | 典型特效 |
|-------|---------|----------|---------|
| `entrance` | gsap Tween (一次性) | GSAP 自动插值 | fadeIn, slideUp, punch |
| `behavior` | Ticker 回调 (持续) | `registerBehaviors(t)` 重注册 | shake, wave, rainbow, blur, rgbShift, warp |
| `instant` | 立即执行 (一次性) | style 经 `StyleRecord` 重放；filter 经 `InstantEffectRecord` 重放 | red, bold, font (style) / pixelate (filter) |
| `timing` | cursor 控制 | Timeline 位置隐含 | hold, pause |

> **`instant` track 说明**：原是“死桶”——`TextPlayer.placeCharOnTimeline` 只读 `.behavior`/`.entrance`，`instant` 滤镜 fn 永不执行。现已修复：非 style 的 instant 特效（如静态 filter）经 `InstantEffectRecord` 收集，seek 时由 `PlaybackController.registerInstantEffects` 从 `target.filters` 重置后 force 重 apply，靠 fn 返回的 filter 实例做幂等清理。`InstantCleanup.filterInstance` 支持 `Filter | Filter[]`（组合预设 return 数组）。现有 blur/rgbShift/warp 因含可选 `addModifier` 动画仍填 `behavior`；纯静态滤镜（pixelate 及 M1 的 gray/threshold/posterize/duotone/sharpen/emboss/edge/outline/bloom/halftone）用 `instant`。**block 作用域 instant filter 也经 `SegmentBuilder` 路由进 `InstantEffectRecord` + `segmentTl.call`**（与 char/group 路径对称，非 `applyGroupEffects` 同步挂载），char/group/block 三路径 seek 幂等均覆盖。

## 三路分流 (`EffectProcessor.partition`)

```
EffectConfig[]
  ├─ layoutManager.has(name) → layoutCmds[]      (goto, offset, mark...)
  ├─ stageManager.has(name)  → stageConfigs[]     (cam.move, pause...)
  └─ 其余                    → visualConfigs[]    (shake, red, fadeIn...)
```

## 管线路径

### 路径 A：per-token 特效 (`f.xxx` 或 `.xxx` 视觉)

```
token.effects: EffectConfig[]
  │
  ├─ LayoutStreamBuilder.build()
  │   └─ partition() → layoutCmds 进 stream, stageConfigs 进 charData
  │
  └─ TextPlayer.buildTimeline()
      └─ 在 token 末字符触发 unrollGroupChain():
          │
          ├─ isCharLevel (targetType === "char" 或 "both"，或显式 :char):
          │   └─ wrapper.chars.forEach(char => effectManager.apply(char, ...))
          │      根据 track:
          │        entrance → gsap Tween 挂到 tl
          │        behavior → behaviors[] (后续 registerBehaviors)
          │        instant  → instantEffects[] (SegmentBuilder.segmentTl.call 按 record 触发 apply；seek 时 registerInstantEffects 重放)
          │
          └─ 容器级 (显式 :group / :block，或 targetType === "group" / type === "action"):
              └─ effectManager.apply(wrapper, ...)
```

> **`targetType` 是能力描述，不决定默认目标**：`"both"` 默认走逐字 char 路径（`{...} @ f.x` 仍逐字），
> 要容器级必须显式 `:group`（`f.x:group`）或 `:block`（`[.x:block]`）。`targetType:"group"` 才默认容器级。

### 路径 B：paragraph/global 特效（显式 `:block` 或段落级布局/舞台）

```
pData.globalEffects: EffectConfig[]
  │
  ├─ LayoutStreamBuilder.build()
  │   └─ partition() → layoutCmds 进 stream 头部
  │
  └─ ScriptPlayer.buildSegment()
      └─ partition() → visualConfigs:
          segmentTl.call(() => {
            applyGroupEffects(kt, visualConfigs)
          }, [], segmentCursor)
```

**注意**：`applyGroupEffects(kt, ...)` 的 target 是 KineticText (Container)。
因此只有显式要求 paragraph/container 语义的命令才应该走这条路径，例如 `[.shake:block]` 或段落级布局/舞台命令。

默认 block option 视觉命令（如 `[.rainbow]`、`[.wave]`）现在会在 `lowering.ts` 中先广播到整段 text targets，
再走路径 A 的逐 token 路径，以保留 char/group 的默认 target 行为。

## 特效实现模式

### Behavior 特效（KineticChar 上）

```typescript
const _wave: EffectFunction = (target, params = {}) => {
  if (target instanceof KineticChar) {        // ← 守卫！
    const offset = params.charIndex || 0;     // ← charIndex 来自逐字分发
    target.addModifier("wave", 'behavior', (time) => ({
      y: Math.sin(time * freq + offset * 0.5) * height,
    }));
  }
};
```

- `addModifier(name, track, fn)` 在 Ticker 每帧调用 `fn(time)`
- 返回的 `{ x?, y?, scale?, rotation?, alpha?, tint? }` 叠加到字符变换
- `charIndex` 参数实现逐字错开效果（波浪、彩虹相位差）

### Style 特效（递归应用）

```typescript
EffectProcessor.applyStyleRecursively(target, styleName, params, force)
```
递归遍历 Container 子树，对每个 KineticChar 调用 `styleManager.apply(char, ...)`。
样式直接修改 `char.style`（如 `style.fill = "#ff0000"`），不经过 Ticker。

### Filter 特效（Pixi v8 fragment shader）

参考 `core/filters/RGBSplitFilter.ts`（自写 shader 模板）与 `presets/filter.ts`（preset）：

```typescript
// 1. Filter 类：继承 Pixi v8 Filter + fragment shader（core/filters/XxxFilter.ts）
import { Filter, GlProgram, defaultFilterVert } from "pixi.js";
const fragment = /* glsl */ `#version 300 es
  in vec2 vTextureCoord; out vec4 finalColor;
  uniform sampler2D uTexture; uniform vec4 uInputSize; // Pixi 自动注入，.zw = (1/w, 1/h)
  void main(void) { ... }
`;
super({ glProgram: new GlProgram({ vertex: defaultFilterVert, fragment, name: "xxx-filter" }),
        resources: { filterUniforms: { uX: { value, type: "f32" } } } });
// uniform 经 getter/setter 暴露 this.resources.filterUniforms.uniforms.uX

// 2. preset（presets/filter.ts，defineEffect 是本文件内联 helper）
const _xxx: EffectFunction = (target, params = {}) => {
  const filter = new XxxFilter();
  filter.xxx = params.xxx ?? default;
  target.filters = [...(target.filters || []), filter];
  return filter;   // ← instant filter 必须返回实例，供 registerInstantEffects seek 清理
};
export const xxx = defineEffect(_xxx, { type: "filter", track: "instant"|"behavior", ... });
```

契约要点：
- **挂载点**：`target.filters = [...(target.filters||[]), filter]`，`target` 是任意 Pixi `Container`（char=KineticChar / group=TokenWrapper / block=KineticText）。
- **GLSL**：`#version 300 es` + `defaultFilterVert`（不自写顶点）；`uInputSize.zw` 自动注入为 `(1/width, 1/height)`。
- **静态滤镜 `track: "instant"`**；含逐帧动画的（用 `addModifier` 驱动 uniform）`track: "behavior"`。
- **char 守卫**：`targetType` 含 char 且实现用 `addModifier`/假定 KineticChar 时，加 `instanceof KineticChar` 守卫 + 非匹配 `console.warn` 后 return。
- **卷积/邻域类必须设 `filter.padding`**（否则邻域采样取透明边）；纯逐像素/点运算类（pixelate/gray/threshold/duotone/posterize）不需要。卷积模板见 `SharpenFilter.ts`：padding 匹配 kernel 步长（`Math.ceil(radius)`），在 `radius` setter 内同步更新。
- **预乘 alpha**：颜色/点运算类对 `c.rgb` 操作前需 `c.rgb/max(c.a,1e-4)` 再写回乘 alpha（审查重点）。点运算模板见 `GrayFilter.ts`。
- **vec3/vec4 uniform 值格式**：Pixi v8 的 GL uniform setter（`UNIFORM_TO_SINGLE_SETTERS`）对 `vec3<f32>`/`vec4<f32>` 使用数组索引 `v[0],v[1],v[2]`，不是 `.x/.y/.z` 属性。故 vec3/vec4 uniform 值**必须用 `Float32Array`**（如 `new Float32Array([r,g,b])`），不能用 `{x,y,z}` 对象——否则 `v[0]=undefined→0`，颜色 uniform 全变黑色。`vec2<f32>` 走另一条 setter 路径用 `v.x/v.y`，`{x,y}` 可用（RGBSplitFilter 即如此），但为一致性建议 vec2 也用 Float32Array。`hexToVec3`（`filters/colorUtils.ts`）已返回 Float32Array。
- **bloom 辉光需扩展 alpha**：辉光要扩散到文字外区域（alpha=0），不能只乘原图 alpha。bloom shader 取 `outAlpha = max(c.a, bloomAlpha * strength)`，让亮部 tap 的 alpha 扩散到邻域。
- **seek 幂等**：instant filter 的 fn 返回 filter 实例 → SegmentBuilder 记入 `activeInstantCleanups` → seek 时 `clearInstantEffects` 从 `target.filters` 移除后重 apply。`InstantCleanup.filterInstance` 支持 `Filter | Filter[]`：组合预设（M2 underwater）return `Filter[]`，清理时全部移除+destroy。**block 作用域（`[.x:block]`）经 Commit 1 修复后也走 `InstantEffectRecord` + `segmentTl.call`**（与 char/group 路径对称），不再同步挂载于 `applyGroupEffects`，seek 回退能正确移除。

### 已注册 filter 清单

| name | track | targetType | mutexGroup | padding | 说明 |
|---|---|---|---|---|---|
| `rgbShift` | behavior | both | filter_rgb | — | RGB 通道偏移（可选 anim） |
| `warp` | behavior | char | filter_warp | 20 | 正弦扭曲（addModifier 驱动 uTime） |
| `blur` | behavior | both | filter_blur | — | Pixi BlurFilter（可选 anim） |
| `pixelate` | instant | both | filter_pixelate | — | 下采样马赛克（M0 模板） |
| `gray` | instant | both | filter_color | — | 灰度点运算（M1 premult-alpha 模板） |
| `threshold` | instant | both | filter_color | — | alpha 软阈值二值化边缘（M1 点运算） |
| `duotone` | instant | both | filter_color | — | alpha→shadow/highlight 渐变（M1，hexToVec3） |
| `posterize` | instant | both | filter_color | — | alpha 量化+可选 Bayer 4×4 抖动（M1 点运算） |
| `sharpen` | instant | both | filter_conv | ceil(radius) | alpha unsharp mask 3×3（M1 卷积模板） |
| `emboss` | instant | both | filter_conv | ceil(width) | alpha 梯度浮雕 + 多步长斜坡（M1，可链 f.blur.emboss） |
| `edge` | instant | both | filter_conv | ceil(width) | alpha 内描边（M1，hexToVec3，类似 CSS text-stroke） |
| `outline` | instant | both | filter_outline | ceil(width*2) | alpha 膨胀描边 + 可选发光（M1 形态学，hexToVec3） |
| `bloom` | instant | both | filter_bloom | ceil(radius*2) | 多通道辉光 extract→BlurFilter→composite + 曝光混合（M1，推荐 :block） |
| `halftone` | instant | both | filter_halftone | ceil(scale) | 网格网点 dot/line + invert（M1，推荐 :block） |

## 已知边界

- **`targetType: "both"` 的特效** (如 shake)：在 Container 上也能工作（修改 Container.position），
  但效果是整体移动而非逐字错开。
- **显式 paragraph/container 路径中的 char 级特效**：如果强制 `:block`，仍可能因为目标是 `KineticText` 而失效。
  默认 block option 视觉命令不会走这条路径，只有显式 `:block` 时才需要注意这一点。
- **特效的 `charIndex` 参数**：仅在 `unrollGroupChain` 逐字分发路径中注入。
  直接调用 `effectManager.apply(char, "wave", {})` 不会有 charIndex → 所有字符同相位。
- **block 作用域 filter 的纹理范围**：`[.x:block]` 走 `applyGroupEffects(kt, ...)` → SegmentBuilder 路由 instant filter 进 `InstantEffectRecord` + `segmentTl.call`，target 是整段 `KineticText`（持有所有 TokenWrapper），filter 覆盖整段合成纹理。邻域类滤镜（bloom/halftone/vignette）推荐此作用域。seek 幂等已覆盖（Commit 1 修复）。
