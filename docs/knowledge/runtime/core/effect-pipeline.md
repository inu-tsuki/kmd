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

> **`instant` track 说明**：原是“死桶”——`TextPlayer.placeCharOnTimeline` 只读 `.behavior`/`.entrance`，`instant` 滤镜 fn 永不执行。现已修复：非 style 的 instant 特效（如静态 filter）经 `InstantEffectRecord` 收集，seek 时由 `PlaybackController.registerInstantEffects` 从 `target.filters` 重置后 force 重 apply，靠 fn 返回的 filter 实例做幂等清理。现有 blur/rgbShift/warp 因含可选 `addModifier` 动画仍填 `behavior`；纯静态滤镜（pixelate 及后续 gray/threshold/posterize 等）用 `instant`。

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
          │        instant  → instantEffects[] (tl.call 触发 apply；seek 时 registerInstantEffects 重放)
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
- **卷积/邻域类必须设 `filter.padding`**（否则邻域采样取透明边）；纯逐像素/点运算类（pixelate/gray）不需要。
- **预乘 alpha**：颜色/点运算类对 `c.rgb` 操作前需 `c.rgb/max(c.a,1e-4)` 再写回乘 alpha（审查重点）。
- **seek 幂等**：instant filter 的 fn 返回 filter 实例 → SegmentBuilder 记入 `activeInstantCleanups` → seek 时 `clearInstantEffects` 从 `target.filters` 移除后重 apply。block 作用域（经 `applyGroupEffects` build 时同步挂载）当前不经此机制，seek 幂等为已知缺口。

## 已知边界

- **`targetType: "both"` 的特效** (如 shake)：在 Container 上也能工作（修改 Container.position），
  但效果是整体移动而非逐字错开。
- **显式 paragraph/container 路径中的 char 级特效**：如果强制 `:block`，仍可能因为目标是 `KineticText` 而失效。
  默认 block option 视觉命令不会走这条路径，只有显式 `:block` 时才需要注意这一点。
- **特效的 `charIndex` 参数**：仅在 `unrollGroupChain` 逐字分发路径中注入。
  直接调用 `effectManager.apply(char, "wave", {})` 不会有 charIndex → 所有字符同相位。
- **block 作用域 filter 的纹理范围**：`[.x:block]` 走 `applyGroupEffects(kt, ...)`，target 是整段 `KineticText`（持有所有 TokenWrapper），filter 覆盖整段合成纹理。邻域类滤镜（bloom/halftone/vignette）推荐此作用域。但 build 时同步挂载，不经 `InstantEffectRecord`，seek 回退后 filter 不移除——已知缺口，待后续统一处理。
