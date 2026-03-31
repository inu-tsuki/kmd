# 特效管线：从 EffectConfig 到屏幕

> 本文档描述视觉特效从解析到渲染的完整管线。
> 理解此文档可以避免 `instanceof` 守卫、`targetType` 不匹配等常见问题。

## 特效元数据 (meta)

每个特效在 `presets.ts` 中通过 `defineEffect(fn, meta)` 注册：

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
| `behavior` | Ticker 回调 (持续) | `registerBehaviors(t)` 重注册 | shake, wave, rainbow |
| `instant` | 立即执行 (一次性) | `StyleRecord` 重放 | red, bold, blur, font |
| `timing` | cursor 控制 | Timeline 位置隐含 | hold, pause |

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
          ├─ isCharLevel (targetType === "char"):
          │   └─ wrapper.chars.forEach(char => effectManager.apply(char, ...))
          │      根据 track:
          │        entrance → gsap Tween 挂到 tl
          │        behavior → behaviors[] (后续 registerBehaviors)
          │        instant  → tl.call(() => apply)
          │
          └─ isGroupLevel (targetType === "group" / "both"):
              └─ effectManager.apply(wrapper, ...)
```

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

## 已知边界

- **`targetType: "both"` 的特效** (如 shake)：在 Container 上也能工作（修改 Container.position），
  但效果是整体移动而非逐字错开。
- **显式 paragraph/container 路径中的 char 级特效**：如果强制 `:block`，仍可能因为目标是 `KineticText` 而失效。
  默认 block option 视觉命令不会走这条路径，只有显式 `:block` 时才需要注意这一点。
- **特效的 `charIndex` 参数**：仅在 `unrollGroupChain` 逐字分发路径中注入。
  直接调用 `effectManager.apply(char, "wave", {})` 不会有 charIndex → 所有字符同相位。
