# 特效 / Segment 生命周期不变量合约

> 状态：Active（硬约束 / 自审计基准）
> 创建：2026-06-29
> 配套：`effect-pipeline.md`（特效管线细节）、`editor-dip-effect-library-review.md` §C（审查清单）
> 原则：系统健康最大，长期痛苦最小

本文档把前 9 轮修复-审查循环积累的所有边界条件沉淀为**统一不变量合约**。每条不变量是硬约束——违反即为 bug。用覆盖矩阵反向审计代码，在审查者发现之前挖出剩余违反点。

---

## A. 资源类型清单（12 类）

| # | 资源 | 创建点 | 清理点 | 追踪位置 |
|---|------|--------|--------|----------|
| 1 | **char modifier** | `KineticChar.addModifier(id, fn)` | `KineticChar.removeModifier(id)` | `BehaviorCleanup.char + .modName` → `activeBehaviorCleanups` |
| 2 | **container offset** | `addContainerOffset(target, id, fn)` → `gsap.ticker.add` | `removeContainerOffset(target, id)` → `gsap.ticker.remove` + 恢复 position（R6-3：清空时删 binding 刷新 base） | `BehaviorCleanup.offsetTarget + .tickerFn` → `activeBehaviorCleanups` |
| 3 | **gsap ticker callback** | `gsap.ticker.add(fn)`（filter 容器级动画） | `gsap.ticker.remove(fn)` | `BehaviorCleanup.tickerFn` → `activeBehaviorCleanups` |
| 4 | **gsap tween** | `gsap.to(state, ...)` 返回（fadeShake state 推进） | `tween.kill()` | `BehaviorCleanup.tween` → `activeBehaviorCleanups` |
| 5 | **behavior filter** | `target.filters = [..., filter]`（blur/rgbShift/warp） | 从 `target.filters` 移除 + `destroyFilterDeep` | `BehaviorCleanup.filterInstance + .target` → `activeBehaviorCleanups` |
| 6 | **instant filter** | `target.filters = [..., filter]`（gray/bloom/pixelate…） | 从 `target.filters` 移除 + `destroyFilterDeep` | `InstantCleanup.target + .filterInstance` → `activeInstantCleanups` |
| 7 | **entrance filter** | `target.filters = [..., filter]`（blurIn）+ tween 入时间线 | `clearEntranceFilters` 从 `target.filters` 移除 + `destroyFilterDeep` | `segment.entranceFilters`（`EntranceFilterRecord`） |
| 8 | **style record** | `styleManager.apply(char.style, ...)` | `char.resetStyle()`（恢复 baseStyleSnapshot）+ 重放 | `segment.styleRecords` |
| 9 | **stage modifier fn** | `stageRuntime.addModifier(name, fn)`（cam.shake/cam.drift） | `stageManager.clearModifiers()` 或 `removeModifier(name)`（onComplete/strength=0） | `segment.stageModifierRecords`（`StageModifierRecord`，三路径共用：global/inline/token-chain） |
| 10 | **restoreProps** | `target.alpha = alpha` + 返回 `{restoreProps:{target,props:{...}}}` | `clearBehaviors` 遍历 props 写回 target | `BehaviorCleanup.restoreProps` → `activeBehaviorCleanups` |
| 11 | **stage modifier decay tween**（F-1 复合资源子项） | `cam.shake` 非 static 路径 `gsap.to(state,{s:0})` + `registerModifierTween(name, tween)` | `clearModifiers` / `removeModifier` 一并 `tween.kill()`（kill 抑制 onComplete，§B-bis） | `StageRuntime.modifierTweens: Map<name, gsap.Tween>`（R6-2） |
| 12 | **BlurFilter 内部子 pass**（F-1 复合资源子项） | `new BlurFilter()` 持有 `blurXFilter`/`blurYFilter` | `destroyFilterDeep` 递归 destroy 子 pass（裸 `destroy()` 不递归，§B-bis） | 隐含于 `BehaviorCleanup.filterInstance` / `InstantCleanup.filterInstance`；`destroyFilterDeep` 是清理 helper |

**F-1 复合资源说明**：#11 是 #9 的子资源（cam.shake 一个 create 产 modifier fn + 衰减 tween），#12 是 #5/#6 的子资源（BlurFilter 一个 create 产 filter + 子 pass）。§A 原本是 1:1 映射（一个 create → 一个 cleanup），复合资源被扁平化为单行，cleanup 漏子项。现补为独立行 + 复合标注，cleanup 须覆盖全部子资源（INV-1 kill-before-clear 扩展到 timeline 外的 modifier 衰减 tween）。

---

## B. 操作路径不变量（6 条硬约束）

### INV-1: kill-before-clear-before-destroy

teardown 路径（stop / clearScreen）的清理顺序：

```
kill timeline → loadState(killTweensOf camera) → clearModifiers
→ clearBehaviors → clearInstantEffects → clearEntranceFilters
→ destroy containers
```

**原理**：
- kill timeline 先停所有 tween（entrance/stage）对 filter/alpha 的逐帧写入，防止清理 filter 时 tween 还在写已 destroy 的 filter。
- clearModifiers 在 clear* 之前（cam.shake/cam.drift 是独立于 behavior cleanup 的资源）。
- filters 在 containers 之前 destroy（Pixi Container.destroy 不自动 destroy target.filters → GPU 泄漏）。

**违反后果**：filter 被 container destroy 后仍引用 → GPU 泄漏；tween 继续写已 destroy filter → 运行时错误。

### INV-2: clear-before-reapply

seek 时**先 clear 旧资源，再 timeline.seek 插值，最后 re-apply**。顺序为：
```
clearBehaviors → clearInstantEffects → timeline.seek(clamped)
→ registerBehaviors (replay, 内部 clear 是 no-op) → replayStyles
→ registerInstantEffects (replay, 内部 clear 是 no-op) → replayStageModifiers
```

**原理**：
- clear 在 seek 前：restoreProps 写回旧值 → timeline.seek 覆盖为插值结果（不残留旧 alpha）。
- 若 clear 在 seek 后（旧顺序）：timeline.seek 插值 alpha → clearBehaviors restoreProps 写回旧值覆盖插值结果 → 视觉错误。
- register* 内部的 clear 此时 active 数组已空（no-op），replay 只重建当前时间点的资源。

**违反后果**：seek 后 alpha 残留旧值（dim + blurIn 组合 seek 回 blurIn 中途）；资源累积（未 clear 就 re-apply）。

### INV-3: entrance filters 不在 seek 清理/重 apply

entrance filter（blurIn 等）的 tween 在时间线上，seek 时靠 `timeline.seek()` 插值到正确状态。**不在 `registerInstantEffects` 重 apply**（重 apply blurIn 会 `gsap.set(alpha=0)` 重置 + rogue tween + `destroy({tween,filter})` 崩溃）。仅在 stop/clearScreen 清理。

**原理**：entrance 是时间线驱动的（tween 在 timeline 里），不是 record 驱动的（fn 重 apply）。instant filter 是 record 驱动的（fn 幂等重 apply 安全）；entrance filter 不是（fn 重 apply 重置动画）。两者生命周期必须分离。

**违反后果**：seek 崩溃（destroy 对 {tween,filter}）或视觉重置（alpha=0）。

### INV-4: stop-before-build

所有 load 入口（`load` / `loadSourceContent`）在 `buildSegment()` 前调 `this.stop()`，释放旧 segment 的 timeline/containers/behaviors/filters/modifiers。

**原理**：`buildSegment()` 覆盖 `this.segment` 和 `this.activeTexts`。若不先 stop，旧 timeline/对象/资源残留 stage/GPU/ticker。编辑器包装层（`editorStore.ts:140`）外部已 stop，但 runtime 公共入口（protocol dispatch）不保证——ScriptPlayer 层兜底。

**违反后果**：连续两次 load → 旧 timeline orphan + 旧 filter GPU 泄漏 + 旧 ticker 残留。

### INV-5: modifier id = effectName

`addModifier` 第一参数必须等于 `defineEffect` 的导出名。`clearBehaviors` 用 `behavior.effectName` 调 `removeModifier`——`KineticChar.removeModifier` 是 `Map.delete(id)` 精确匹配。

**原理**：modifier id ≠ effectName → removeModifier 命中失败 → modifier 残留继续 tick → 写已 destroy filter 的 uniform → 运行时错误。

**历史违反**：`rgbShift→rgbAnim`、`warp→warpAnim`、`blur→blurAnim`、`gravity→physics`、`fadeShake→shake`（还附带 Map.set 同 key 覆盖隐患）。已全部统一为 effectName。

### INV-6: ticker 不写 timeline 驱动的属性

`ContainerBehaviorOffset` ticker 仅驱动 `position`（x/y）。**不写 `alpha`**——timeline alpha 动画（如 blurIn 0→1）和 ticker 每帧都写 `target.alpha`，最后执行者覆盖。

**原理**：容器级没有 char 级的 `syncProperties`（4 层融合，先读 animOffset 再乘 modifier alpha）。容器级两个驱动源写同一属性 = 未定义行为。

**违反后果**：dim+blurIn 组合 → base alpha 快照为 0 或中间值 → ticker 冻结 alpha → timeline 无法驱动到 1。

**替代方案**：容器级 alpha 行为（dim）用 `restoreProps`（一次性写 + 记录原始值 + cleanup 恢复），不持续驱动。

### INV-7: 三路径分流单一真相源

凡是被 global（`SegmentBuilder.applyStageConfigs`）、inline（`TextStageCueScheduler.schedule`）、token-chain（`TextPlayer.unrollGroupChain` / `unrollCharChain`）三路径**共同**处理的命令分流（modifierBased / clearBoundary / 可 seek tween），必须过单一 helper（当前为 `buildStageModifierRecord`），**禁止在各路径里各写一份 `if (modifierBased)` / `if (name === "cam.reset")`**。

**原理**：SA-9 的修复只保证"三路径共用同一个 `stageModifierRecords` 数组"，没保证"三路径共用同一套分流逻辑"。global 路径对 `cam.reset` 特判（记 `isClearBoundary`），inline/token-chain 各自只判 `modifierBased`——`cam.reset` 落进 else 分支只 `captureTween`、不写 record。结果 `文字 @ cam.reset!` 与全局 `cam.reset` 语义分裂，seek 到 inline reset 后 `replayStageModifiers` 找不到边界。"共用 recorder" ≠ "共用真相"。

**违反后果**：同一命令在全局 vs inline/token-chain 写法下行为分裂；新增可分流命令时漏改一两条路径就静默回归。

**附带约束（聚合）**：跨层聚合 record 时（如 `SegmentBuilder` 把 `buildResult.stageModifierRecords` 并进 `allStageModifierRecords`）必须 spread 全部字段（`{...modRecord, timePosition}`），不能只挑已知字段拷贝——否则单字段（如 `isClearBoundary`）会在聚合点丢失。

**审计触发**：R2 review（SA-14）。

### INV-8: 外部依赖边界行为假设须可复现验证

GSAP / Pixi 等外部库的"易错但看起来对"的边界行为（零时长 tween 的 `onComplete` 时机、`overwrite` 语义、`Filter.destroy` 是否递归、filters 数组是否可 splice），不能只在注释里声称——必须有可复现验证（`pnpm exec node` 内联脚本 / 回归脚本 / test:parser 之外的 fixture），并在注释里标注"已验证于 GSAP x.x / Pixi v8.15"。

**原理**：SA-13 的实现和注释都声称 `duration:0` = "无衰减静态 modifier"，但没人验证过 GSAP 对零时长 tween 的实际行为（同步 `onComplete`）。SA-15 揭露这是 no-op。同类历史债：Pixi v8 `BlurFilter.destroy` 不递归子 pass（→ `destroyFilterDeep`）；filters 数组不可 splice（→ 重建赋值）。这些都是"注释声称 vs 实际行为"的债，靠注释不可靠。

**违反后果**：修复在注释里成立、在运行时不成立；review 时难以判断真伪（SA-13 正是过了 review 才被发现）。

**替代方案**：依赖边界行为时，优先选择**不依赖边界**的 API（如 `static:true` 显式参数，而非重载 `duration:0` 的零时长语义）。

**审计触发**：R2 review（SA-15）。已验证的反例库见下方"已验证外部依赖行为"小节。

---

## B-bis. 已验证外部依赖行为（INV-8 反例库）

下列行为已用可复现脚本验证（`pnpm exec node --input-type=module`），作为 INV-8 的"已确认真相"清单。新增依赖边界行为假设时，先查此清单，再决定是否需要新验证。

| 依赖 | 版本 | 行为 | 验证方式 | 代码后果 |
|---|---|---|---|---|
| GSAP | 3.x | `powerN.out` 用指数 N+1：`power1.out=1-(1-t)^2`、`power2.out=1-(1-t)^3`、`power3.out=1-(1-t)^4`…（不是直觉的 N 次方） | node 内联：`gsap.parseEase("power2.out")` 各点拟合 `(1-t)^3`（R3-4 触发） | cam.shake replay 用 `gsap.parseEase("power2.out")` 求 `strength*(1-ease(t))`，不硬编码 `(1-t)^2`（SA-13 公式曾错） |
| GSAP | 3.x | 零时长 `gsap.to` 同步触发 `onComplete` 并立即 set 目标值（等同 `set()`） | node 内联：`gsap.to(state,{duration:0,onComplete:...})` 后 `onComplete` 同步为 true | cam.shake 静态重放用 `static:true` 不用 `duration:0`（SA-15） |
| GSAP | 3.x | `paused:true` 的子 timeline 不被父 timeline 驱动（`parent.seek()` 不推进其子 tween） | node 内联：parent.add(pausedChild)+seek(0.5) → child 目标值仍为初始值 | captureTween/captureEntrance 不设 paused:true（TextPlayer.ts:133/384） |
| GSAP | 3.x | `timeline.kill()` 不触发子 tween 的 `onComplete` | node 内联：parent.seek(0.3)+kill() → onComplete 未触发 | entrance filter / stage modifier 不靠 onComplete 清理，走 explicit cleanup（INV-1） |
| GSAP | 3.x | `tween.kill()` 抑制该 tween 自身的 `onComplete`（与 timeline.kill 同理） | node 内联：`tween.kill()` 后等原 duration 过去 → onComplete 未触发（R6-2） | `StageRuntime.clearModifiers`/`removeModifier` kill 衰减 tween，防旧 onComplete 误删新 modifier（R6-2） |
| Pixi | v8.15 | `Container.destroy()` 不调用 `target.filters[i].destroy()` | node 内联：instrument filter.destroy 计数 → container.destroy 后 0 次 | clearInstantEffects/clearBehaviors 显式 destroyFilterDeep（stop/clearScreen） |
| Pixi | v8.15 | `BlurFilter.destroy()` 不销毁 `blurXFilter`/`blurYFilter` 子 pass | 见 `destroyFilterDeep` 注释引用 | `destroyFilterDeep` 递归 destroy 子 pass |
| Pixi | v8.15 | filters 数组元素 `configurable:false`，原地 splice 抛 "Cannot delete property '1'" | node 内联：`Object.getOwnPropertyDescriptor(filters,1).configurable===false`；splice 抛错 | 重建数组后整体赋值，不 splice（clearInstantEffects/clearBehaviors/clearEntranceFilters） |
| Pixi | v8.15 | `vec3<f32>` uniform setter 用 `v[0]/v[1]/v[2]` 数组索引（`gl.uniform3f(loc,v[0],v[1],v[2])`），传 `{x,y,z}` 对象 → `undefined`→0 | 源码引用：`generateUniformsSyncTypes.mjs` `UNIFORM_TO_SINGLE_SETTERS` | colorUtils.ts 用 Float32Array 不用 {x,y,z} |
| Pixi | v8.15 | 懒初始化 renderer——仅 `import` + 构造 `Container`/`Graphics`/`Filter` **不触发 WebGL/canvas/window**。`require('pixi.js')` 在 node 下 exit 0 无错 | node 内联：`node -e "require('pixi.js')"` exit 0；`node --import tsx -e "import('./src/core/player/PlaybackController.ts')"` 干净加载（SA-23 触发） | PlaybackController/ScriptPlayer 可在 `node --import tsx` 下 headless 测试，无需 mock pixi（`pnpm test:playback` 直接 import 真实模块） |
| tsx | 4.21 | CJS/ESM 互操作把 `import gsap from "gsap"` 当命名空间导入，默认导出落在 `.default`：`gsap.timeline` 是 `undefined`，`gsap.default.timeline` 是 function | node 内联：`import gsap from "gsap"` 后 `gsap.timeline===undefined`、`gsap.default.timeline===function`（SA-23 触发） | headless 测试用 `const G = (gsap as any).default ?? gsap` 解包；vite 生产环境标准 ESM 解析不受影响（各 preset 文件 `import gsap` 正常） |
| tsx/gsap | 4.21/3.x | 生产代码（SegmentBuilder/PlaybackController 等）直接调 `gsap.timeline()` / `gsap.core`（不经测试文件的 G 别名）。tsx 下 gsap 命名空间这些是 undefined → `gsap.timeline is not a function` | node 探针：`SegmentBuilder.build` 抛 `gsap.timeline is not a function`（R17/SA-32 触发） | 端到端真实管线测试（`final-playback-test.ts` §13）需 **gsap hoist shim**：把 `gsap.default` 的属性提升到 `gsap` 命名空间——`for (const k of Object.keys(G)) { if(!(k in gsap)) gsap[k]=G[k]; }`。仅测 PlaybackController 的 §1-§12 用 G 别名绕过，但驱动真实 SegmentBuilder 必须补此 shim |
| node/Pixi | v8.15 | KineticText 构造读 `(document as any).fonts`（`KineticText.ts:82`），node 下 `document` 未定义 → `ReferenceError` | node 探针：无 `document` 时构造 KineticText 抛 ReferenceError（R17/SA-32 触发） | 端到端测试需 **document stub**：`globalThis.document = { fonts:{ready:Promise.resolve()}, createElement:()=>({}) }`。**注意：不要 stub `window`**——`LayoutPlanner.isDiagnosticsEnabled` 检查 `typeof window`，未定义时早返回 false（line 348）；若 stub 了 window 会落到 `window.location.search` 崩溃 |
| node/Pixi | v8.15 | `CanvasTextMetrics.measureFont`（layout 路径 `LayoutPlanner:97` measureFontSafe 调）的 `_canvas` getter：先试 `OffscreenCanvas`（node 下 undefined）→ fallback `DOMAdapter.get().createCanvas()` → 默认 BrowserAdapter 用 `document.createElement("canvas")`（node 下崩） | node 探针：`LayoutPlanner.plan` 抛 `document.createElement is not a function`（R17/SA-32 触发） | 端到端测试需 **DOMAdapter canvas shim**：`DOMAdapter.set({ createCanvas:()=>({width:0,height:0,getContext:()=>({font:"",measureText(t){...合成度量}}),style:{}}), getCanvasRenderingContext2D:()=>({prototype:{...}}), ... })`。度量是合成的（width=charCount×fontSize×0.5）——几何不真实但 style/baseline/timing/seek 语义真实，足够测管线正确性。需几何精确则用 `canvas` npm 包 + `@pixi/node-adapter`（未安装）。pixi 升级若改 measureFont 路径，此 shim 可能需更新——§13 失败时先查 shim 是否过期，再查逻辑 |
| Pixi | v8.15 | `TextStyle.fill` 经 Pixi v8 规范化后读出来可能是 **Fill 对象**（`{color:number, alpha, texture, ...}`）而非原始字符串——取决于路径：block 路径（applyGroupEffects 同步写，不进规范化）保持字符串；char 级路径（LayoutPlanner 烘焙 + KineticChar 进容器后）规范成 Fill 对象 | node 探针：`f.red` block → fill 字符串 `#ff4d4f`；`f.red` char 级 → fill 对象 `color=0xff4d4f`（R17/SA-32 触发） | 测试断言不能假设 fill 是字符串——用 `fillHex(f)`：字符串直返，对象读 `.color` 转 hex（`"#"+(f.color>>>0).toString(16).padStart(6,"0")`）。fake char 用字符串 fill 会**掩盖真实类型**（SA-27 教训：§9-§12 fake 通过但 §13 真实管线断言失败） |
| KineticText | — | 默认 `fontSize=36`（`rebuild` 的 `_options` 默认 `fontSize:36`，`TextBuildContextResolver.fromTarget` 读 `target._options.fontSize`）——不是直觉的 24 | node 探针：`f.big` baseline=54（36×1.5），非 36（R17/SA-32 触发） | 测试断言不能假设默认 fontSize=24。相对样式 `big`（×1.5）/`small`（×0.8）的 baseline 须按真实默认 36 算（big→54, small→28.8）。fake char 硬编码 24 会**掩盖真实默认**（SA-27 教训：§12 fake 断言 36 通过但 §13 真实管线得 54） |

### B-bis-2. Headless 端到端管线测试配方（R17/SA-32 沉淀）

驱动真实 `parser → SegmentBuilder.build → PlaybackController.seekToTime` 在 `node --import tsx` 下跑端到端，需以下三件套 shim（已验证可跑，见 `final-playback-test.ts` §13 + 文件头）。**复制即用，按序置于文件头、import 真实模块之前**：

```ts
// @ts-nocheck  // shim 的 as any cast 需要
import gsap from "gsap";
// ── shim 1: gsap tsx 互操作（§B-bis 行 11/12）──
const G = ((gsap as any).default ?? gsap) as typeof gsap;
if (!(gsap as any).ticker) (gsap as any).ticker = { add: () => {}, remove: () => {} };
// 生产代码（SegmentBuilder 等）直接调 gsap.timeline()/gsap.core，不经测试的 G 别名 → hoist
if ((gsap as any).timeline !== G.timeline) {
  for (const k of Object.keys(G)) { try { if (!(k in (gsap as any))) (gsap as any)[k] = (G as any)[k]; } catch {} }
}
// ── shim 2: document stub（§B-bis 行 13）── 不要 stub window（isDiagnosticsEnabled 检查 typeof window）
if (!(globalThis as any).document) {
  (globalThis as any).document = { fonts: { ready: Promise.resolve() }, createElement: () => ({}) };
}
// ── shim 3: DOMAdapter canvas（§B-bis 行 14）── 让 measureFont 走合成度量
import { DOMAdapter } from "pixi.js";
const _ctxProto = { prototype: { letterSpacing: undefined, textLetterSpacing: undefined } };
const _makeCtx = () => ({
  font: "",
  measureText(t: string) {
    const sz = parseFloat((this.font || "24px").match(/(\d+)px/)?.[1] || "24");
    return { actualBoundingBoxAscent: sz * 0.8, actualBoundingBoxDescent: sz * 0.2, width: (t || "").length * sz * 0.5 };
  },
});
DOMAdapter.set({
  createCanvas: () => ({ width: 0, height: 0, getContext: () => _makeCtx(), style: {} }) as any,
  getCanvasRenderingContext2D: () => _ctxProto as any,
  createImage: () => ({}) as any,
  getBaseUrl: () => "file:///",
  getFontFaceSet: () => undefined,
} as any);
```

最小驱动（已验证，见 `final-playback-test.ts` §13 `buildAndSeek`）：

```ts
import { parser } from "./core/parser/Parser";
import { Container } from "pixi.js";
import { SegmentBuilder } from "./core/player/SegmentBuilder";
import { PlaybackController } from "./core/player/PlaybackController";

const result = parser.parse("[.red:block]\n{Hello} @ f.hold(1s).bold");
const playbackState = { isAutoPlaying: false, activeBehaviorCleanups: [], activeInstantCleanups: [] } as any;
const { segment, activeTexts } = await SegmentBuilder.build({
  container: new Container(),
  metadata: { variables: {} } as any,
  paragraphs: result.paragraphs,
  rawParagraphs: result.rawParagraphs,
  currentMode: "stage",
  playbackState,
});
const ch = activeTexts[0]._displayAssembly.chars.find((c: any) => c.text.trim()) ?? activeTexts[0]._displayAssembly.chars[0];
PlaybackController.seekToTime(segment, 1.5, playbackState);
// 断言：读 fill 用 fillHex（§B-bis 行 15，Pixi Fill 对象），读 fontSize 注意默认 36（§B-bis 行 16）
```

**适用范围与限制**：
- shim 度量是**合成的**（width=charCount×fontSize×0.5）——几何/换行不真实，但 style/baseline/timing/seek/record 语义真实。足够测管线正确性（style 应用、baseline 烘焙、record 注册与重放、seek 语义）。
- **filter 实例化在 headless 可行**（SA-34 探针确认）：pixi v8 `new BlurFilter()` 等构造 `GpuProgram`/`GlProgram` 数据结构但**懒加载 renderer 意味着不真正 compile/link shader**（要等 renderer 应用 filter 时才发生），故 `char.filters = [blur]` 在 node + 上述三件套 shim 下不崩——**不需额外 renderer stub**。故 behavior/instant/entrance filter 的 build+seek 幂等（registerBehaviors/clearBehaviors/destroyFilterDeep/registerInstantEffects/clearInstantEffects/captureEntrance）可在同一配方下测（§15-17）。**注意 filter 经 apply 创建后，在 seek 回退 destroy 时，其 ticker/modifier 仍可能被驱动写 uniform——cleanup 顺序（先 removeModifier/ticker 再 destroy）的正确性正是要测的真实风险**。
- **不能测**：精确布局坐标、真实字体度量、WebGL 渲染输出（filter 的实际视觉效果，但 filter 实例的 lifecycle/cleanup 可测）、premultiplied alpha（§B-bis 待验证）。
- **进程不退出**：gsap ticker stub 让事件循环保持活跃——一次性探针需 `process.exit(0)`，持久测试（`final-playback-test.ts`）跑完自然退出。
- **多 token/多段**：helper 默认取 `activeTexts[0]` 首个非空白 char；测多 token 需 `chars.filter(c=>c.text.trim())` 取多个，测多段需 `\n\n` 分段（KMD 段落分隔是双换行，单换行 `\n` 是段内）。
- **pixi 升级风险**：shim 依赖 pixi v8 `DOMAdapter.set` + `CanvasTextMetrics._canvas` 路径契约。pixi 升级若改这些路径，shim 可能失效——§13 失败时**先查 shim 是否过期**（对照 pixi 新版 measureFont/adapter），再查逻辑错。
- **只测 PlaybackController 的测试**（§1-§12）不需 shim 2/3（只构造 KineticChar 不进 layout 路径）；shim 1 的 ticker stub + gsap hoist 仍需（KineticChar 构造调 `gsap.ticker.add`）。**端到端真实 SegmentBuilder.build 必须 shim 1+2+3 全套**。

**待验证（INV-8 遗留 TODO）**：

| 依赖 | 版本 | 行为 | 状态 | 影响 |
|---|---|---|---|---|
| Pixi | v8.15 | filter 输入纹理是否预乘 alpha | ⚠️ **未验证**（node 无 WebGL，需浏览器渲染测试） | 高：约 15 个 filter 的"解预乘→运算→重新预乘"步骤（GrayFilter/BloomFilter 等）依赖此假设。注释写"**可能**是预乘"（GrayFilter.ts:22），未确证。Pixi v8 源码 grep 无 premultiplied 处理 → 怀疑该步骤可能多余/错误。需浏览器渲染半透明像素 + passthrough filter 验证。 |

---

## C. 覆盖矩阵（操作 × 资源）

> **F-2 播放状态维度（待补为一维列）**：seek/play 的行为依赖播放状态（playing/paused/ended），当前矩阵未建模。语义约定：
> - **seek-while-paused / seek-to-ended**：stage modifier 走 `static` 快照（恒定强度，不衰减）。
> - **seek-while-playing（progress<1）**：seek 先 `static` 快照，随后 `playSegment` resume 清旧 + `replayStageModifiers(live)`（衰减 tween 自删）。由 `ScriptPlayer.seekToTime` 的 `isAutoPlaying && progress<1` gate 触发（R5-1/R6-1）。
> - **resume from paused-mid**：`playSegment`（tl.time()>0）恒 `live`（衰减 tween）。
> - **seek-to-end（progress>=1）**：**R7-1 必须落地 ended**——`ScriptPlayer.seekToTime` 调 `settleEnded()`（设 `isAutoPlaying=false` + `pause` + `emit ended`），不止"读 `derivePhase` 阻止 resume"。F-2 的 `derivePhase` 只识别状态，**没有任何路径把识别出的 ended 写回**（§B-bis：GSAP `seek(duration)` 不触发 `onComplete` → `isAutoPlaying` 仍 true、不发 ended），这是 R6-1 的遗留缺口，R7-1 闭合。`playSegment` 对 ended 是 restart 语义，故 seek 到尾后任何 resume 都会从 0 重播——UI 侧（TimeLordBar scrub-resume）须用 seek 后的 `autoPlay` 镜像而非捕获的意图判定（R7-2）。
>
> `deriveReplayMode`（PlaybackController）是 seek 路径的 mode 派生 helper（当前恒 "static"，为状态机扩展的脚手架）；resume 路径显式 "live"。未来把 playing/paused/ended 提升为矩阵分列时，此 helper 分支化。

> **F-1 复合资源**：#11 是 #9 的子资源（cam.shake 一个 create 产 modifier fn + 衰减 tween）。#11 随 #9 的 clearModifiers 一并 kill（`StageRuntime.clearModifiers` 内部 kill `modifierTweens`）——所有 #9 ✅ 的操作列对 #11 也成立，不单列重复，仅在此标注复合关系。

| 资源 ↓ \ 操作 → | build | play (重播) | seek | stop | clearScreen | load |
|---|---|---|---|---|---|---|
| **1. char modifier** | 注册 closure（playback 期 apply） | ✅ clear | ✅ clear→reapply | ✅ clear | ✅ clear | ✅ stop 先清 |
| **2. container offset** | 注册 closure | ✅ clear | ✅ clear→reapply | ✅ clear+restore | ✅ clear+restore | ✅ stop 先清 |
| **3. gsap ticker callback** | 注册 closure | ✅ clear | ✅ clear→reapply | ✅ clear | ✅ clear | ✅ stop 先清 |
| **4. gsap tween (fadeShake)** | 注册 closure | ✅ clear(kill) | ✅ clear(kill)→reapply | ✅ kill | ✅ kill | ✅ stop 先清 |
| **5. behavior filter** | 注册 closure | ✅ clear | ✅ clear→reapply | ✅ clear+destroy | ✅ clear+destroy | ✅ stop 先清 |
| **6. instant filter** | 注册 closure | ✅ clear | ✅ clear→reapply | ✅ clear+destroy | ✅ clear+destroy | ✅ stop 先清 |
| **7. entrance filter** | ✅ build 期创建 | ❌ 不清（tween 重播） | ❌ 不碰（timeline 插值） | ✅ clear+destroy | ✅ clear+destroy | ✅ stop 先清 |
| **8. style record** | ✅ 收集 | ❌ 不清 | ✅ reset→replay | ❌ 不清（容器 destroy 覆盖） | ❌ 不清 | ✅ stop 先清 |
| **9. stage modifier fn** | ✅ stage apply + 记录 | ✅ clear | ✅ clear→replay（StageModifierRecord） | ✅ clear | ✅ clear | ✅ stop 先清 |
| **10. restoreProps** | 注册 closure | ✅ clear | ✅ clear→reapply | ✅ clear+restore | ✅ clear+restore | ✅ stop 先清 |
| **11. stage modifier decay tween**（F-1，#9 子资源） | ✅ `registerModifierTween` | ✅ 随 #9 clearModifiers kill | ✅ 随 #9 kill→replay(live) 重建 | ✅ 随 #9 kill | ✅ 随 #9 kill | ✅ stop 先清 |
| **12. BlurFilter 子 pass**（F-1，#5/#6 子资源） | ✅ 隐含于 filter create | ✅ destroyFilterDeep 递归 | ✅ destroyFilterDeep 递归 | ✅ destroyFilterDeep 递归 | ✅ destroyFilterDeep 递归 | ✅ stop 先清 |

**图例**：✅ 已覆盖 / ❌ 设计上不碰（正确） / ⚠️ 违反不变量（需修复）

---

## D. 自审计记录

### SA-1（High）：`load()` 不调 `stop()` — 已修
`load()`（ScriptPlayer.ts:205）依赖外部调用者 stop，`loadSourceContent` 已内部 stop。修复：`load()` 也加 `await this.stop()`。

### SA-2（Medium）：seek 不清 stage modifiers — 已修
`seekToTime` 不调 `clearModifiers`。cam.drift（无 tween）seek 后永久残留。修复：seek 在 `registerBehaviors` 前加 `stageManager.clearModifiers()`。注意：seek 不调 `loadState`（camera position 由时间线插值恢复，不应重置）。

### SA-3（Low）：`destroyContainerOffset` 死代码 — 已删
`ContainerBehaviorOffset.ts` 定义了 `destroyContainerOffset` 但从未调用。清理靠 `clearBehaviors` 的 per-effectId `removeContainerOffset`。已删除。

### SA-4（Low）：结尾重播不清 stage modifiers — 已修
`playSegment` 的 `tl.progress() >= 1` 分支清 behaviors + instantEffects 但不清 stage modifiers。cam.drift 重播时残留。修复：结尾重播分支加 `stageManager.clearModifiers()`。

### SA-5（High）：`blurIn:block` 逃出 lifecycle — 已修
`track:"entrance"` 的 block 级特效落 `blockRemaining` → `applyGroupEffects` 同步执行 → `{tween, filter}` 被 warn guard 漏掉 → tween 不进 timeline、filter 不进 entranceFilters。修复：补 `blockEntrance` 分流，build 期 apply 后 tween 入 segmentTl、filter 进 allEntranceFilters。warn guard 也补了 `{tween, filter}` 形状识别。

### SA-6（High）：seek 不重放 stage modifier — 已修
`cam.drift`/`cam.shake` 经 `tl.call` 触发，seek 跨过 call 不补触发 → modifier 缺失。修复：新增 `StageModifierRecord` 到 Segment，`applyStageConfigs` 记录 modifier 命令，`seekToTime` 调 `replayStageModifiers` 按 `timePosition <= clamped` 重放。

### SA-7（Medium）：seek 顺序导致 restoreProps 覆盖插值 alpha — 已修
原顺序 `timeline.seek → registerBehaviors(clearBehaviors)` → clearBehaviors 的 restoreProps 写回旧 alpha 覆盖 timeline 刚插值的 alpha（dim + blurIn 组合 seek 回 blurIn 中途）。修复：seek 顺序改为 `clearBehaviors → clearInstantEffects → timeline.seek → register*(replay)`。restoreProps 写回旧值 → timeline.seek 覆盖为插值结果 → 正确。

### SA-8（High）：cam.shake seek 到结束后被重新激活 — 已修
`replayStageModifiers` 对所有 `timePosition <= currentTime` 的 modifier 一律重放，但 `cam.shake` 有 duration（有限效果），seek 到结束后不应重放。修复：`StageModifierRecord` 加 `duration` 字段，`replayStageModifiers` 检查 `currentTime <= timePosition + duration`（无 duration = persistent，如 cam.drift，总是重放）。

### SA-9（High）：inline/token 级 stage modifier 不进 StageModifierRecord — 已修
原 `StageModifierRecord` 只覆盖 global 路径（`SegmentBuilder.applyStageConfigs`）。inline（`文字 @ cam.drift`）和 token-chain（effect chain 里的 stage 分支）走 `TextStageCueScheduler.schedule` 和 `TextPlayer.unrollGroupChain`/`unrollCharChain` 的 stage 分支，不记录 → seek 后丢失。修复：三路径共用同一 `stageModifierRecords` 数组——`TextStageCueScheduler.schedule` 加参数、`TextPlayer` 的 chain stage 分支加记录、`SegmentBuilder` 聚合 `buildResult.stageModifierRecords` 进 `allStageModifierRecords`。

### SA-10（Medium）：load/loadSourceContent 发 idle 闪烁 — 已修
`stop()` 固定发 `idle`，`load()`/`loadSourceContent()` 先发 `loading` 再 stop → `idle` → `ready` 让宿主 UI 闪烁。修复：`stop()` 加 `suppressIdle` 选项，load 路径调 `stop({ suppressIdle: true })`，非 load 路径正常发 idle。

### SA-11（High）：duration 提取不按命令语义 — 已修
原三路径用通用 `params[1]` 提取 duration：`cam.shake(10)` 的 `params[1]` undefined → persistent（错，应有 0.5s 默认）；`cam.drift(5, 0.001)` 的 `params[1]` = 0.001 → 0.001s 有限效果（错，cam.drift 是 persistent）。修复：新增 `getStageModifierDuration(command, params)` 按命令语义提取——`cam.shake`: `params.duration ?? params.d ?? params[1] ?? 0.5`（有限）；`cam.drift` 及其他：`undefined`（persistent）。三路径（global/inline/token-chain）共用此 helper。

### SA-12（High）：cam.reset clear boundary 未记录 — 已修
`cam.reset` 在正常播放时于 reset timeline 末尾 `clearModifiers()`，但 seek 的 `replayStageModifiers` 不知道此边界 → seek 到 reset 后仍重放 reset 前的 modifier（如 cam.drift）。修复：`StageModifierRecord` 加 `isClearBoundary` 字段，`cam.reset` 记录为 clear boundary。`replayStageModifiers` 先找 `currentTime` 前最后一个 clear boundary，boundary 之前的 modifier 不重放。

### SA-13（High）：cam.shake replay 从满强度启动 — 已修（SA-15 修正 duration:0；R3-4 修正缓动公式）
`replayStageModifiers` 调 `stageManager.apply("cam.shake", params)` 创建新 `gsap.to(state, {s:0, duration})` 从满强度开始，不是 seek 到的中间状态。修复：seek 到 shake 中途时用衰减曲线计算剩余强度，用此值作为 strength apply。**初版用 `duration:0` 做"无衰减"是有缺陷的**——GSAP 零时长 tween 会同步触发 `onComplete → removeModifier`，结果 modifier 立即被移除（no-op）。SA-15 用 `static:true` 替代（cam.shake 检测到 `static:true` 只 `addModifier`、不创建衰减 tween、不注册 `onComplete`，modifier 以恒定强度保留直到下次 `clearModifiers`）。

**R3-4 缓动公式纠正**：SA-13 初版用 `strength * (1 - elapsed/duration)^2` 计算剩余强度，**这是错的**。R3 用 `gsap.parseEase("power2.out")` 实测发现 GSAP `power2.out` 实为 `1-(1-t)^3`（GSAP `powerN` 用指数 N+1，详见 §B-bis），衰减 `s = strength * (1 - ease(t)) = strength*(1-t)^3`，与 `^2` 不符。R3-4 改用 `gsap.parseEase("power2.out")` 直接求值 `strength * (1 - ease(elapsed/duration))`，与正常播放的衰减 tween 逐帧一致（已验证 1e-6 误差内），且未来改 ease 不会漏。

### SA-15（Medium）：cam.shake 中途 seek 的"静态重放"立即自删 — 已修（R3-1/R3-3 补强）
SA-13 的中间强度重放用 `duration:0` 调 `cam.shake`，但 `stagePresets.cam.shake` 的 `gsap.to(state, {duration, onComplete: removeModifier})` 在 `duration:0` 下被 GSAP 当作 `set()` → `onComplete` 同步触发 → `removeModifier("shake")` 立即执行。seek 到 shake 中途不会保留剩余强度，"无衰减静态 modifier" 的注释/文档不成立（用 `pnpm exec node` 验证 GSAP 零时长 tween 同步 `onComplete`）。

修复：`cam.shake` 加显式 `p.static === true` 分支——只 `addModifier`、不创建衰减 tween、不注册 `onComplete`，modifier 以恒定强度保留。`replayStageModifiers` 改传 `static:true` + 计算出的剩余 strength（R3-4 改用 `gsap.parseEase` 求）。**不重载 `duration:0`**——那会改变用户可写参数 `cam.shake(…,0)` 的语义。static modifier 生命周期归 seek 流程管理（每次 `ScriptPlayer.seekToTime` 前 `clearModifiers`，不跨 seek 堆叠）。

**R3-1（High）补强**：`static:true` 经 `StageRuntime.apply()` 时被原逻辑数值化（`resolveNumeric(true,0)→0`），`p.static === true` 恒为 false → 静态重放仍创建衰减 tween。R3-1 修复 `StageRuntime.apply()` 的 resolve 循环：仅 `number|string` 参数才走 `resolveNumeric`，boolean/对象原样透传。
**R3-3（Medium）补强**：cam.shake 的 modifier 闭包原本读常量 `strength`（SR 引入的回归），衰减 tween 动 `state.s` 但闭包不读它 → 满强度抖到 `onComplete` 突然移除，`power2.out` 衰减不生效。R3-3 恢复闭包读 `state.s`，static 模式下 `state.s` 固定为传入 strength。已用 node 验证衰减 `state.s` 与 `power2.out` 曲线逐点一致。

**R4-1（High）补强**：R3 的 static:true 静态快照只在 seek（暂停态）正确；resume（playSegment，tl.time()>0）只调 registerBehaviors/registerInstantEffects，**不重放 stage modifier** → 静态 shake 永久残留（直到下次 seek/stop 的 clearModifiers）。R4-1 给 `replayStageModifiers` 加 `mode: "static"|"live"` 参数：seek 用 static（恒定快照），resume 用 live（创建真实衰减 tween：`remainingDuration` 从 `remainingStrength`→0，`onComplete` 自删 modifier）。`playSegment` resume 路径加 `clearModifiers()` + `replayStageModifiers(segment, tl.time(), "live")`，与 register* 对称。已用 node 验证：自由衰减 tween 在真实时间推进下自然结束并触发 `onComplete`（shake 自删），不残留。

**R4-3（Medium）补强**：`getStageModifierDuration` 原用 `Number(params[1])`，但执行经 `StageRuntime.apply()` 解析 `var.*`。`cam.shake(10, var.dur)` 的 record duration = `Number("var.dur")` = `NaN` → seek duration 过滤失效，结束后仍可能重放。R4-3 抽 `resolveStageNumeric(value, fallback)`（经 `RuntimeValueResolver.resolveReference` 解析变量，与 `StageRuntime.apply` 同源），`getStageModifierDuration` 与 `buildStageModifierRecord` 的 resetDuration 都改走它。已用 node 验证 `var.dur`(=1.5)→1.5、字面量 2→2、默认→0.5。

**R5-1（High）补强**：R4-1 的 live replay 只在 `playSegment` resume 路径触发，但公共 runtime `seek`（`ReaderRuntimeSession`）和 `editorStore.seekRelative` 只调 `scriptPlayer.seekToTime()`，而 `ScriptPlayer.seekToTime` 原本不 resume → 播放中经公共 API seek 到 shake 中途仍走 static → 永久震动。`seekTo`（段落跳转）早就 resume，但它是单独入口；公共 seek 的直接路径 `seekToTime` 没补。R5-1 在 `ScriptPlayer.seekToTime` 加 `isAutoPlaying` gate + `playSegment()` resume（与 `seekTo` 对齐），并删 `seekTo` 里因此冗余的重复 resume。暂停态 seek（`isAutoPlaying=false`，如 UI 拖条——拖前 `pauseSegment`）不触发，避免误恢复；TimeLordBar 拖后仍由自己的 `wasPlaying` gate 手动 resume，无双重恢复。reader runtime / seekRelative 播放中 seek 现在走 live replay，shake 衰减 tween 自删。

**R6-1（High）补强**：R5-1 的 `isAutoPlaying` gate 在 seek 到结尾（`progress>=1`）时仍会 resume → `playSegment` 对 `progress>=1` 的语义是清理+`seek(0)`+restart → "播放中拖到尾 / runtime seek({progress:1}) / 右方向 seek 到尾"变成从 0 重新播放，而非停在结尾（ended）。GSAP `tl.seek(duration)` 不触发 `onComplete` → `isAutoPlaying` 仍为 true → 误触发 restart。R6-1 把 gate 收紧为 `isAutoPlaying && segment.timeline.progress() < 1`：结尾 seek 停留（ended 态管理），仅中途 seek resume。已用 node 验证 `tl.seek(duration)` 后 progress=1 → gate 阻断 resume。

**R5-2（High）补强**：R4 的 shake-midway 判定用 `elapsed > 0 && elapsed < duration`，duration skip 用 `currentTime > start + duration`（严格大于）→ 起点（elapsed=0）与结束点（elapsed=duration）都 fall through 到正常 `stageManager.apply(record.command, record.params)`。暂停 seek 到 shake 起点会启动真实衰减 tween（墙钟时间里衰减，暂停态不该动）；seek 到结束点从满强度重新震一次。R5-2 改：duration skip 用 `>=`（结束点直接跳过），shake-midway 用 `elapsed >= 0 && elapsed < duration`（起点也走静态快照，remainingStrength=baseStrength）。已用 node 验证 start→static 满强度快照、mid→静态/衰减、end→SKIP、past-end→SKIP。

**R5-3（Medium）补强**：`replayStageModifiers` 的 `baseStrength` 原用 `Number(record.params?.strength ?? ...)`，未解析 `var.*`（与 R4-3 的 duration 同源问题）。`cam.shake(var.strong, 2s)` 正常播放 OK（经 `StageRuntime.apply` 解析），seek 到中途算出 `NaN` strength → camera modifier NaN 偏移。R5-3 改用 `resolveStageNumeric(record.params?.strength ?? record.params?.[0] ?? 5, 5)`。已用 node 验证 `var.strong`(=7)→7、字面量 10→10、默认→5。

**R6-2（High）补强**：cam.shake 正常（非 static）路径创建本地衰减 tween（`gsap.to(state,{s:0,onComplete:removeModifier("shake")})`），但 seek/stop/resume 只 `clearModifiers()`（清 modifier Map），**不 kill 这个 tween**。之后 live replay 新建 shake modifier，旧 tween 仍在跑 → 旧 tween `onComplete`（`removeModifier("shake")`）触发时把新 modifier 删掉（探针复现："after new true" → "after old complete false"）。R6-2 给 `StageRuntime` 加 `modifierTweens: Map<name, gsap.Tween>`：`cam.shake` 调 `stageRuntime.registerModifierTween("shake", tween)` 注册衰减 tween；`clearModifiers` / `removeModifier` 一并 kill 所有 tween（kill 阻止 onComplete + 释放逐帧驱动）。已用 node 验证 `tween.kill()` 后 onComplete 不触发 → 新 modifier 不被旧 tween 误删。这是 stage modifier 生命周期的第二资源维度（modifier fn + 衰减 tween），与 INV-1 的 "kill-before-clear" 对齐。

**R6-3（Medium）补强**：`ContainerBehaviorOffset` 的 base 只在首次 binding 时捕获，`removeContainerOffset` 清空 offsets 后只停 ticker + 恢复 base，**不删 WeakMap 记录**。若容器在 inactive 期间移动（layout 重排 / seek 后 position 变化），下次 `addContainerOffset` 复用过时 base → offset 叠加到错误基准。当前文本容器多数静态，爆炸面小；但作为 M2 生命周期基础设施应刷新。R6-3 在 `removeContainerOffset` 的 offsets 清空分支加 `bindings.delete(target)`：下次 `addContainerOffset` 的 `ensureBinding` 重建并重新快照 base。已用 node 验证：首次 add base=(100,200)、remove 后 binding 删除、容器移到 (150,250)、re-add base=(150,250) 刷新。

### SA-14（High）：cam.reset clear boundary 仅 global 路径记录 — 已修
SA-12 只在 `SegmentBuilder.applyStageConfigs` 的 global 路径特殊处理 `cam.reset`（记 `isClearBoundary`）。inline（`文字 @ cam.reset!`，走 `TextStageCueScheduler.schedule`）和 token-chain（effect chain 里的 stage，走 `TextPlayer.unrollGroupChain` / `unrollCharChain`）只判 `modifierBased`，而 `cam.reset` 的 metadata 是 `kind:"camera"`、`propertyKey:"camera.reset"`、无 `modifierBased` → 落非 modifier 分支只 `apply + captureTween`，**不写 `StageModifierRecord`**。结果：seek 到 inline reset 之后，`replayStageModifiers` 找不到边界，仍重放 reset 前的 persistent `cam.drift`。附带缺陷：`SegmentBuilder.ts` 聚合 `buildResult.stageModifierRecords` 进 `allStageModifierRecords` 时只拷 `command/params/timePosition/duration`，**漏掉 `isClearBoundary`**——即使 inline/token-chain 记了 boundary，聚合后也丢失。

修复：引入单一真相源 `buildStageModifierRecord(command, params)`（`stagePresets.ts`），返回 `cam.reset` 的 boundary 片段 / modifierBased 的 duration 片段 / 其余返回 `null`。global（`applyStageConfigs`）、inline（`TextStageCueScheduler.schedule`）、token-chain（`unrollGroupChain` + `unrollCharChain`）三路径共用此 helper，cam.reset 的 boundary 在任一写法下都一致记录。`SegmentBuilder` 聚合改为 `{...modRecord, timePosition: ...}` spread 全部字段（含 `isClearBoundary`）。`cam.reset` 是可 seek tween（reset timeline），三路径在记 boundary 后仍走 `apply + captureTween`（与 `cam.move` 等对称），不落 modifierBased 的 `tl.call` 延迟 apply 分支。

**R3-2（High）补强**：即使三路径都记了 boundary，`replayStageModifiers` 原第一轮扫描用 `timePosition > currentTime break`，假设 `stageModifierRecords` 有序。但 inline `cam.reset`（token-end / TextStageCueScheduler）与 token-chain modifier（chain pause 后写入）push 顺序不保证有序 → break 漏掉排在后面但 timePosition 更早的 reset boundary → 误重放 reset 前的 persistent drift。R3-2 在 replay 入口对 records 做稳定排序（拷贝 + sort，不就地改 build 产物），两轮扫描共用有序视图。已用 node 验证三种边界 case（drift 在 reset 前/后、unsorted push）均 order-invariant。

**R4-2（High）补强**：即使 boundary 记对了，replay 把 reset **起点**当 boundary 生效时间，但正常播放（buildMode）下 `cam.reset` 在 `resetTl.call(clearModifiers, [], duration)`——boundary 在 reset **结束**（`timePosition + resetDuration`）。seek 到 `cam.reset(2s)` 动画中途（起点后、结束前），replay 提前丢掉 reset 前仍应存在的 drift/shake。R4-2 给 `StageModifierRecord` 加 `resetDuration` 字段，`buildStageModifierRecord` 为 cam.reset 填它（经 `resolveStageNumeric` 解析变量）；`replayStageModifiers` 把 boundary effective time 改为 `timePosition + resetDuration`（仅当 ≤ currentTime 才视为已生效）。已用 node 验证：seek 到 reset 中途 boundary 仍为 -1（reset 前的 drift 正确重放），seek 到 reset 后 boundary = 起点+duration（drift 正确跳过）。

---

## D-bis. INV-7 全面自审计（2026-06-29，R2 后）

R2 修复（SA-14/SA-15）暴露了一个模式：**三路径分流逻辑各自一份 `if`，靠人肉保持一致**。引入 INV-7（三路径分流单一真相源）后做全面反向审计，找出既有代码里其他同类违反点。下列均为**既有技术债**（非 R2 引入），记为 SA-16..19 供后续修复，不在 R2 范围内动手。

### SA-16（High）：behavior fn 返回值解包逻辑三处复制 — 已修
behavior-track 特效的 fn 返回值解包（`Filter | Filter[] | BehaviorFilterResult | gsap.Tween | {restoreProps} | undefined` → `BehaviorCleanup` 字段）原本在**三处各写一份**，无共享 helper：
- `SegmentBuilder.ts`（block 路径 `segmentTl.call`）
- `SegmentBuilder.ts`（group 路径 `segmentTl.call`）
- `PlaybackController.ts`（`registerBehaviors` seek 重放）

原三份一致，但这是 cleanup 捕获的 chokepoint：新增返回 shape（新 BehaviorFilterResult 变体 / `{filters,tween}` 复合 / 显式 `gsap.core.Timeline`）须三处同步改，漏一处即静默丢 cleanup → seek/stop/clearScreen 资源泄漏（block 路径与 group 路径历史上已 drift 过一次）。与 R2 修的 `buildStageModifierRecord` 同构。

修复：抽 `PlaybackController.unpackBehaviorResult(result, target)` 单一 helper，返回 `BehaviorCleanup` 除 `char/modName/target` 外的字段（这三项由调用点从 `BehaviorRecord` 提供）。三处改为 `{char, modName, target, ...unpacked}`。新增返回 shape 只改 `unpackBehaviorResult` 一处。已用 node 内联脚本验证 7 种返回 shape（Filter/Filter[]/BFR+filters/BFR-only-tickerFn/Tween/restoreProps/undefined）解包结果与原逻辑逐字段一致。

### SA-17（Medium）：effect track 分类 block 路径绕过 helper — 已修
track 分类（instant/behavior/entrance）有单一 helper（`EffectProcessor.classifyByTrack` / `getTrack`，纯按 `track` 分桶），但 **block 路径绕过它**：`SegmentBuilder` 的 block 桶分流用 inline `meta.type === "filter" && meta.track === "instant"`（多了 `type==="filter"` 守卫），而 char/group 路径用 `classifyByTrack`/`getTrack`（无 type 守卫）。drift：`track:"instant"` 但 `type!=="filter"` 的特效在 block 作用域落 `blockRemaining`（无 cleanup record），在 char/group 作用域落 `instantEffects`（有 cleanup）——同一特效两套生命周期。当前所有 `track:"instant"` 特效恰好都是 `type:"filter"`（filter.ts），drift 未被触发（latent）。

修复：block 路径改调 `EffectProcessor.getTrack(cfg.name)`，与 char/group/chain 路径对齐。style 特效（`styleManager.has`）显式落 `blockRemaining`（经 `applyGroupEffects → applyStyleRecursively`，不挂 `target.filters`），与 char 路径的 `styleManager.has` gate 对称。

### SA-18（Medium）：effect level 分辨逻辑四处复制且 drift — 已修
char/group/block 级别分辨原本在**四处各写**，规则不一致：
- `inferDefaultLevel`：`targetType∈{char,both}` → char（无 action 守卫）——但 `defaultLevel` 字段从未被任何路由读取（dead output）
- `applyCharEffects`：`isBothCharMatch` **排除 `type==="action"`**
- `applyGroupEffects`：`isExplicitGroup ‖ isPureGroupType ‖ isActionDefault`（三段）
- TextPlayer `isCharLevel`：`targetType∈{char,both}` **无 action 守卫**

drift：`type:"action", targetType:"both"` 无显式 level 时，`inferDefaultLevel`/TextPlayer→char、`applyCharEffects`→非 char。路由决策与执行决策用不同定义。当前所有 `type:"action"` 都是 `track:"timing"`（go/slow/fast/wait），在路由前已被 `classifyByTrack`/`partition` 剔除，drift 未被触发（latent）。

修复：新增 `EffectProcessor.isCharLevelEffect(config)` 单一真相源——显式 `level==="char"` → 是；显式 group/block → 否；无 level + `targetType∈{char,both}` 且**排除 `type==="action"`** → 是；其余 → 否。`applyCharEffects`、`applyGroupEffects`（`!isCharLevelEffect` 即容器级，等价于原三段）、TextPlayer `isCharLevel`（前置 `!isStyle` gate 保留）三处改调此 helper。`inferDefaultLevel` 收窄（`targetType:"both"` 不再武断返回 char，交 `isCharLevelEffect` 判）。已用 node 内联脚本验证 7 种 level 组合的判定与统一后规则一致。

### SA-19（Low）：pause/hold duration 提取 7 处复制 — 已修
`Number(params.duration ?? params.d ?? params[0] ?? <default>)` 一行式原本复制 7 处（TextStageCueScheduler、SegmentBuilder、TextPlayer×3、timing.ts×2），仅 default 随上下文不同（pause=1、char-hold=0.5、delay=0）。

修复：抽 `EffectProcessor.resolvePauseDuration(params, defaultValue)`，7 处改调。`timing.ts` 的 `slow`/`fast` 用 `factor/f` 字段（非 duration），不在此次统一范围。

### SA-20（High）：seek 到结尾不落地 ended 状态（F-2 闭合后回归） — 已修（R7-1）
F-2 抽 `derivePhase` 时把它当只读派生——能识别"seek 到尾现在是 ended"，但 `ScriptPlayer.seekToTime` 只用它阻止 resume（R6-1），没有把识别出的 ended 写回：`isAutoPlaying` 仍 true（§B-bis：GSAP `seek(duration)` 不触发 `onComplete`，故 `segmentTl.onComplete` 里设 `isAutoPlaying=false` 的逻辑不会跑）、timeline 不 pause、`emitPlaybackState("ended")` 不发。结果：UI/宿主以为还在播放，timeline 实际停在末尾；后续任何 `playSegment()`（对 ended 是 restart 语义）从 0 重播。

修复：`ScriptPlayer.settleEnded()`（设 `isAutoPlaying=false` + `pause` + `emit ended`，与 `segmentTl.onComplete` 自然播完路径对称），`seekToTime` 落点 ended 时调它而非裸 return。node 验证 5 种落点（playing-mid/paused-mid/ended-from-playing/scrub-resume-after-settle/seek-back-to-0）分支正确。**根因：状态机的"读"（derivePhase）与"写"（settleEnded）分离，缺 settle 则识别出的状态是幽灵态。**

### SA-21（High）：TimeLordBar scrub-resume 用捕获意图而非 seek 后状态 — 已修（R7-2）
`handleScrubEnd` 原本 `if (wasPlaying.value) store.player?.playSegment()`——`wasPlaying` 是 scrub 开始时捕获的"拖拽前在播"意图。即使 R7-1 settle 了 ended（`isAutoPlaying=false`），这条无条件 `playSegment()` 仍触发，而 `playSegment` 对 ended 是 restart 语义 → 从 0 重播。Coco 复现：播放中拖时间条到末尾，松手后从 0 重播。

修复（R7-2）：resume 条件改双判定 `wasPlaying.value && (store.player?.autoPlay ?? false)`——`autoPlay` 是 `isAutoPlaying` 的镜像，R7-1 settle 为 false 后这里自然不 resume。node 验证 settle 后 `autoPlay=false` → resume gate false。**教训：UI 侧的播放意图须用 seek 后的实时状态判定，而非 scrub 开始时捕获的快照——否则 settle 落地的状态被旧意图覆盖。**

**SA-22 再修（方向 A）**：R7-2 的 `autoPlay` 镜像修复其实是双真相源的又一症状。审查发现 UI 侧"是否在播"有**两个不同步的真相源**：
- **Source A** `store.isPlaying`：由 adapter 写（`setPlaybackState(event) { store.isPlaying = event.isPlaying }`），把引擎发的 7 值 `event.state`（idle/loading/ready/playing/paused/ended/error）**塌缩成布尔**——这是信号链唯一的有损点（session 层 wrapCallbacks 完整保留 state，是 adapter 丢弃的）。KmdEditor/MonitorView 读它。
- **Source B** `store.player?.autoPlay`：直读 `playbackState.isAutoPlaying`（"用户播放意图"布尔）。TimeLordBar 读它（R7-2 当时的修复就用它）。

两者已证实漂移：Alt+Click 跳转（KmdEditor.vue）写 `store.isPlaying = true` 却调 `seekTo`（非 playSegment）→ Source A=true / Source B 不变，且无 emit 修正。`runScript`/`stopScript` 也有绕过 adapter 的乐观直接写。根因：**F-2 在引擎层抽了 PlaybackPhase，但信号传到 UI 的通道（adapter）降级了**——状态机语义在引擎层建模，到 UI 边界被抹平成布尔。

修复（SA-22 / 方向 A）：adapter `setPlaybackState` 同时写 `store.playbackState = event.state` + `store.isPlaying = event.isPlaying`（保留布尔兼容）；store 加 `playbackState` ref 作为单一真相源；删除 3 处绕过 adapter 的直接写（runScript/stopScript/Alt+Click 的 `isPlaying=`）；消费者统一改读 `store.playbackState`（TimeLordBar/KmdEditor watch/MonitorView）。TimeLordBar scrub-resume gate（R7-2）从 `wasPlaying && autoPlay` 改为 `wasPlaying && playbackState !== "ended"`——语义更准（playbackState 是 settle 后的真实状态）。**教训：状态机不止要在引擎层建模（F-2），信号贯通到 UI 的通道也不能降级——否则消费侧会自造第二个真相源（Source B），与引擎真相（Source A）漂移。这是 F-2 在消费侧的未完成部分，本轮闭合。**

### SA-23（High）：播放状态机零运行时回归测试 — 已修（方向 A）
R3-R7 每轮的验证都是一次性 node 探针，**复制逻辑**而非 import 真实模块，验证完即丢——下次改 seek/phase/resume 没有任何持久化回归阻止同类 bug 回归（这正是为什么每轮都能挑出新 High：没有任何东西阻止状态语义漂移）。INV-7/INV-8 守卫是静态文本扫描，管不到运行时行为。

**关键纠误**：长期以为"pixi.js 阻塞 headless 测试"——这是**误判**。实测 pixi v8 懒初始化 renderer，仅 `import` + 构造 `Container` 不触发 WebGL，`PlaybackController.ts`/`ScriptPlayer.ts` 在 `node --import tsx` 下干净加载。R3-R7 的"逻辑复制探针"是不必要的摩擦，且 `node -e` 变体因 tsx ESM 互操作 quirk 实际 flaky（gsap 默认导出落在 `.default`）。正确做法：提交真实 `.ts` 测试文件直接 import 真实模块，用真实 `gsap.timeline()` + 结构合法的空 segment 驱动（record 数组空 → register/replay 退化为 no-op，只跑 clamp + 真实 gsap.seek + onTimeUpdate）。

修复：新建 `src/final-playback-test.ts`（对齐 final-parser-test.ts 风格）+ `pnpm test:playback` script。穷举 `derivePhase`（F-2 单一真相源，最高价值：null/playing/paused/ended 五种组合）、`seekToTime` 边界（clamp + onTimeUpdate 回调）、`playSegment` 状态转换（ended 分支 vs resume 分支）。22 case 全过，锁定 R5-1/R6-1/R7-1 的 seek/phase/resume 语义不回归。**这是阻止 R8 出现的关键杠杆**——把 F-4（强制机制）的理念从静态扫描扩展到运行时行为。

### SA-24（High）：reset boundary 过滤用单一标量表达二维 clear 语义（三轮） — 已修（R8-1+R8-2+R8-3）
`replayStageModifiers` 的 boundary skip 反复在同一类问题上打地鼠，R8 经三轮才闭合。**根因不在任何一轮的具体形态，而在建模本身**：试图用**单一标量阈值**表达 reset 的 clear 语义，但 reset 的 clear 是**二维的**——它清掉"clear 动作触发时已 apply 且未被后续清除的所有 modifier"。三轮各自只堵了一个方向：

- **R8-1（reset 后新 modifier 丢失）**：原 `record.timePosition <= effectiveTime` 把 `timePosition === effectiveTime` 的新 drift 也跳过。改 `< boundary.timePosition`。
- **R8-2（同 timestamp、reset 前创建的 modifier 复活）**：`< boundary.timePosition` 放过 `drift@1==reset@1`（1<1 false）。改 `i <= boundaryIndex`（ordered 索引作 sequence）。
- **R8-3（reset 动画窗口内 apply 的 modifier 复活，Coco 第三轮）**：`i <= boundaryIndex` 只跳 reset 命令本身，`drift@1.5`（index 在 reset 后、但 `timePosition < effectiveTime`）不被跳。真实可达——`SegmentBuilder` 只在 `config.blocking` 时推进 cursor（SegmentBuilder.ts:708），非 blocking reset 不占位，后续 modifier 可落在 reset 动画窗口 `[timePosition, effectiveTime)` 内。Coco 用真实 `PlaybackController` 探针 + GSAP 正向时间线确认：正常播放 `drift@1.5` apply → `reset@2.0` clearModifiers 清掉它，但 seek 到 2.5 仍 replay drift。

**真正的模型（R8-3 闭合）**：reset 在 `effectiveTime` 调 `clearModifiers()` 是 **clear-all** 语义——清掉当时所有存活 modifier，**不分创建序**。skip 条件 = `timePosition < effectiveTime`（唯一）：reset 在 effectiveTime 清掉所有 `timePosition < effectiveTime` 的存活 modifier（clear 前已 apply），`timePosition === effectiveTime` 的新 modifier 在 clear 后 apply 不跳。三轮的三个场景全由此单一条件正确处理：
  - R8-1：drift@2 == effectiveTime → 2<2 false → 不 skip ✓
  - R8-2：drift@1 → 1<2 → skip ✓
  - R8-3：drift@1.5 → 1.5<2 → skip ✓

**为什么三轮**：前两轮把 reset 误当成"clear-before-this-record"（清掉创建序 ≤ reset 的），但它是 clear-all（清掉 clear 时刻所有存活的）。R8-2 引入的"创建序"维度（ordered 索引）是**多余且错误**的——reset 不区分 modifier 是 reset 命令之前还是之后创建，只看"clear 动作时它是否已 apply"（`timePosition < effectiveTime`）。R8-3 证明 R8-2 的 sequence 方向也错了：drift@1.5 创建序 > reset 但仍应被清。**教训：不要给 clear-all 操作加"创建序"维度——它的语义就是"清掉当前存活的一切"，单一时间阈值（effectiveTime）足够，多维反而漏边。** Coco 建议的 sequence 字段经 R8-3 证明**不需要**——`timePosition < effectiveTime` 单条件覆盖全部。

测试：`final-playback-test.ts` [5] 加 20 case（逻辑复制 replayStageModifiers 的 boundary+skip 循环——因 stageManager.apply 触 StageRuntime 的 gsap.getTweensOf，tsx 下 headless 不可跑非空 records，故复制过滤逻辑验证，SA-23 记录的方法）。42 case 全过，覆盖 R8-1（reset→drift 恢复）+ R8-2（同 timestamp drift skip）+ R8-3（窗口内 drift skip）+ 三种组合 + reset 动画中途/起点/之前 + reset 前 shake skip。**R8-3 复现点 `reset@1 dur=1 → drift@1.5 → seek@2.5` 已锁进回归。**

**R9-High 补强（多 reset 重叠，第四轮 Coco）**：R8-3 的 clear-all 模型漏了"多个已生效 reset 取哪个"。原 boundary 循环按 timePosition 顺序赋值 `lastClearBoundaryEffectiveTime`——后 push 的小 effectiveTime reset 覆盖先 push 的大 effectiveTime reset。复现：`reset@1 dur=10 (effective@11)` + `reset@5 dur=1 (effective@6)` + `drift@7`，seek@12。正常播放 reset@1 在 11.0 清掉 drift@7，但 replay 把阈值覆盖成 6 → drift@7（7>6）不被 skip → 错误重放。修复：取**最大** effective clear time（`if (effectiveTime > lastClearBoundaryEffectiveTime)`）——seek 时"当前应生效的 clear"是**最近触发的**（effectiveTime 最大），它清掉了之前所有存活 modifier。drift@7（7<11）被 skip ✓；drift@12（12>11）恢复 ✓。**教训：clear-all 在多 reset 下是"取最近触发的"，不是"取最后 push 的"——effectiveTime 的 max 表达"最近触发"，顺序赋值错把它当"最后创建"。** 回归加 5 case（多 reset 取 max + 仅小 reset 生效时 drift 仍在 + 大 effective 之后 drift 恢复）。

**R10 补强（resetDuration=0 同 timestamp 复活，第五轮 Coco）**：R8-3 误删创建序维度（以为 clear-all 不需要），但 `resetDuration=0` 时 `effectiveTime === timePosition`，时间维度 `timePosition < effectiveTime`（`1 < 1` false）失效——同 timestamp、reset 之前 push 的 drift 不被 skip → 复活。复现：非 blocking `drift@1` + 默认 `cam.reset`（resetDuration=0）共享 cursor → `drift@1 + reset@1`。正常播放：drift 的 `segmentTl.call` 先触发（push 在前）→ reset `clearModifiers` 清它；但 replay 放过 drift。Coco 探针确认：正常播放 `drift@0.02 → reset-clear@0.02`，当前 replay 仍 replay drift。

**真正的模型（R10 闭合）**：skip 须**双维度合取**——`timePosition < effectiveTime`（时间维度，resetDuration>0 时覆盖窗口+reset 前）**或** `timePosition === effectiveTime 且 i <= boundaryIndex`（创建序维度，resetDuration=0 退化为同 timestamp 时唯一判据）。R8-2 的 `i <= boundaryIndex` 不是多余——它在 `timePosition === effectiveTime` 时必需；R8-3 删它是因为 resetDuration>0 时时间维度已覆盖，但忘了 resetDuration=0 的退化。**教训：clear-all 的"时间维度"在 `effectiveTime === timePosition` 时失效，创建序维度是它的退化判据——两维度合取才覆盖 resetDuration>0 与 =0 两种情况。删维度前要验证它在所有退化情形下都不需要，不能只看正常情形。** 修复：boundary 循环同时跟踪 `lastClearBoundaryEffectiveTime`（max）+ `lastClearBoundaryIndex`（同 max 取较大 index）；skip 循环双条件。回归加 7 case（resetDuration=0 同 timestamp skip + 组合 reset 后同 timestamp drift 恢复）。Coco 建议的 `(effectiveTime, clearEventOrder)` 双维度即此——ordered 索引作 clearEventOrder。

**R11 补强（>>> overlap 创建序必须是 build/push 序而非 ordered 索引，第六轮 Coco）**：R10 用 ordered 索引作创建序，但 **ordered 索引是排序后的位置，不是 build/push 序**——stable sort 只在**同 timePosition** 时保留 push 顺序，不同 timePosition 的 push 顺序会被排序打乱。>>> overlap 复现：p1 child timeline（>>> 让 p2 从 1 开始）含 `drift@global2.0`（p1 先 push），p2 含 `reset@1 duration=1`（p2 后 push，effective@2.0）。正常播放：p1 的 drift segmentTl.call 先触发（p1 先 add，overlap 时同 tick 内 p1 call 在前）→ p2 reset clearModifiers@2 清掉 drift。但排序后 reset@1（ordered index 0）在 drift@2（ordered index 1）前 → drift index 1 > boundaryIndex 0 → 不 skip → 复活。Coco 探针确认。**根因：R8-R10 一直用 ordered 索引代替真实 build 序，Coco 从 R8-2 起就建议"加稳定 sequence 字段"，我回避到 R11 才落地——ordered 索引在 timePosition 不同时根本不是创建序。**

**最终模型（R11 闭合）**：给 `StageModifierRecord` 加 `sequence` 字段（build/push 顺序，由 SegmentBuilder 在 push 时填 `allStageModifierRecords.length`）。skip 创建序维度用 `record.sequence <= boundarySequence`，**不用 ordered 索引**。未携 sequence（R11 前旧 record）回退到 ordered 索引（同 timestamp 时等价，兼容）。回归加 9 case（>>> overlap skip + 组合 + 验证无 sequence 时 ordered 索引错误复活——证明 sequence 必需）。**教训：Coco 从 R8-2 起就建议的"稳定 sequence 字段"是对的——ordered 索引只是同 timestamp 退化时的近似，不是真正的创建序。回避显式字段五轮才落地，是这次链路反复的最深教训。**

### SA-25（Medium）：resolvePauseDuration 不解析 var.* — 已修（R9-Medium）
SA-19 抽 `EffectProcessor.resolvePauseDuration` 集中 pause/hold 时长提取，但用 `Number(...)` 不解析 `var.*` 引用——`Number("var.delay_val")=NaN`，导致 `hold(var.delay_val)` / `pause(var.delay_val)` 时长失效。Coco 实测 `resolvePauseDuration({0:'var.delay_val'}, 0.5)` 返回 NaN。与样例 `apps/editor/public/tests/10-variables.kmd` 的"变量 hold 时长"预期冲突。

根因：SA-19 集中时只复制了原 `Number(...)` 逻辑，没和 stage 路径的 `resolveStageNumeric`（F-3）对齐——stage modifier 的 duration 早已用 `RuntimeValueResolver.resolveNumeric` 解析变量，但 pause/hold 的 helper 漏了。同源债的另一侧：两套"时长解析"（stage 走 resolveStageNumeric、pause 走 Number）各算各的，与 F-3 同构。

修复：`resolvePauseDuration` 改用 `RuntimeValueResolver.resolveNumeric(raw, defaultValue)`——与 stage 路径同源，解析 `var.*` / 数值 / 缺省回退。回归加 6 case（纯数值/d 字段/位置参数/缺省/var 解析/未注册回退）。**教训：抽 helper 时要核对所有调用路径的既有行为——SA-19 集中了复制，但没把"stage 路径已修的变量解析"同步过来，留下了同源债。**

### SA-26（High）：instant 特效 cleanup 只认 filter，Graphics 特效 seek 回退残留 — 已修（R12）
`bg`/`border` 的 `meta.track === "instant"` 但 `meta.type === "style"` 返回 `void`——它们画 `Graphics`（`target.getGraphicsLayer(name).clear()` + 重绘），不创建 filter 实例。instant 特效的 cleanup 通道（`activeInstantCleanups` + `clearInstantEffects`）原只处理 `filterInstance`：`segmentTl.call` 与 `registerInstantEffects` 都 `if (filterInstance) push cleanup`，`bg`/`border` 返回 void 不进 cleanup → seek 回退 Graphics 残留不被清。Coco 复现：播放到 `[.bg:block]` 再 seek 回它之前，bg Graphics 残留。

根因：instant 特效的 cleanup 模型假设"返回值即清理目标"，但有两子类：filter 特效返回 `Filter` 实例（从 `target.filters` 移除 + destroy），Graphics 特效返回 void（画到持久 Graphics 层，清理 = `g.clear()`）。通道只建了 filter 子类，Graphics 子类无 cleanup 记录。

修复（R12）：`InstantCleanup` 加 `graphicsLayer?: string` 字段（与 `filterInstance` 互斥）。`registerInstantEffects` 与 SegmentBuilder 两处 `segmentTl.call` 对 void result 查 `effectManager.getMetadata(name).mutexGroup` 作 Graphics 层名（bg/border 的 mutexGroup = "bg"/"border" = 层名），push `graphicsLayer` cleanup。`clearInstantEffects` 对 `graphicsLayer` 条目调 `target.getGraphicsLayer(layer).clear()`。filter 通道独立不受影响。回归加 4 case（clearInstantEffects 清 bg 层 / 清 border 层 / 清空数组 / filter cleanup 不调 getGraphicsLayer）。**教训：特效 cleanup 模型不能只按"返回值类型"建一类——同类 track 下可能有两种副作用子类（filter / Graphics），各自的 cleanup 语义不同（destroy filter vs clear layer）。新增 instant 特效时确认它返回 filter 还是 Graphics，后者走 graphicsLayer 通道。**

### SA-27（High）：R12 graphicsLayer cleanup 对 block 级 KineticText 失效 + visual.ts 坐标原点 bug — 已修（R12-block）
SA-26 的 R12 修复闭合了「Graphics 子类无 cleanup 通道」，但**对 block 级 target 静默失效**：block 级 instant target = `paragraphText`（`KineticText`），而 `KineticText` 只有 `getContentBounds`、**无 `getGraphicsLayer`**。失效在两处：(1) `visual.ts` 的 bg/border 守卫 `!t.getGraphicsLayer` 命中 → warn + 早退，**什么都不画**；(2) `SegmentBuilder.ts` / `PlaybackController.ts` 的 R12 graphicsLayer cleanup 守卫 `typeof target.getGraphicsLayer === "function"` 为 false → cleanup 不登记。净效果：block 级 `[.bg:block]`/`[.border:block]` 只 warn 不画、无残留（因没画就没残留），R12 的清理通道对它完全不生效。Section 7 的回归用 **fake target 带 layer** 盖住了这个真实差异——fake 满足守卫，真实 `KineticText` 不满足。Coco 复现：跑只读探针确认真实 `KineticText` 实例 `{ hasContentBounds: 'function', hasGraphicsLayer: 'undefined' }`。

连带发现**预存坐标 bug**（影响 TokenWrapper + KineticText 两条路由）：`visual.ts` 画在 `rect(-padding, -padding, bounds.width+2pad, bounds.height+2pad)`，忽略 `bounds.x/y`。但 `getContentBounds()` 对 `align:"center"`/`"right"` 或 `indent>0` 返回**非零原点**（center 时 `bounds.x≈300`）——两容器的 `getContentBounds` 都基于段落 layout 坐标（`TokenWrapper.addChars` 已是死代码，不再 token-local 归零），原画法会把框/底偏在内容左侧 `bounds.x + padding` 像素。`getContentBounds` 的唯一消费者就是 visual.ts（grep 确认），补偿修法局部安全。

修复（R12-block）：(A) `KineticText` 补与 `TokenWrapper` 同构的 `getGraphicsLayer(name)`（`Map<string,Graphics>` + `addChildAt(g,0)` 底层；`rebuild` 的 `removeChildren()` 前清 Map 防 getGraphicsLayer 返回已脱离容器的旧引用——TokenWrapper 无 rebuild 故无此路径）。(B) `visual.ts` 的 bg/border 改以 `bounds.x - padding` / `bounds.y - padding` 起画（对 align:left + indent:0 退化为原行为，向后兼容）。(C) 回归 Section 8 用**真实 KineticText + 真实 effectManager.apply + 真实 Graphics 指令检查**（pixi v8 `g.context.instructions` 是 CPU 侧懒记录，headless 可读：rect/roundRect 后含 `{action, data:{path:{instructions:[{action, data:[x,y,w,h,...]}]}}}`，`g.clear()` 清空）——16 case 覆盖：apply 真画到 KineticText 层 / void 返回 / 坐标补偿（含 align:center bounds.x=280 显著非零）/ registerInstantEffects 真实链路对真实 KineticText 登记 graphicsLayer cleanup / clearInstantEffects 清该层。test:playback 现 87 case（71 + R12-block 16）。**教训（接 SA-26）：建 cleanup 通道时不仅要枚举同类下的副作用子类，还要核对**守卫条件对真实 target 是否满足**——fake target 满足守卫不等于真实 target 满足，回归必须用真实对象跑一遍。坐标 bug 是连带暴露的预存债：effect 画法假设 bounds 原点为 0，但 getContentBounds 基于段落 layout 坐标，对 center/right/indent 非零——effect 与 layout 的坐标系契约须显式写清。**

### SA-28（High）：replayStyles seek 回退不清已应用样式 — 已修（R13）
`replayStyles` 旧逻辑只 reset `timePosition <= currentTime` 的字符：先 reset 满足时间窗口的 char，再对同一窗口的 record 重 apply。问题在于 **seek 可以回退**——若先 seek/play 跨过样式生效点（如 `f.hold(1s).red` 红色在 1s 生效），再 seek 回退到生效点之前（如 0.5s），**没有任何 style record 满足 `timePosition <= currentTime`** → 不 reset、不 apply → 字符残留旧样式（红色不退）。最小真实探针：seek 1.5s 后 `fill=#ff4d4f`，seek 回 0.5s 仍 `#ff4d4f`。

根因：把两个语义不同的窗口错误耦合到同一个 `timePosition <= currentTime` 判定——「reset 的窗口」（哪些 char 可能已被样式污染）与「apply 的窗口」（哪些样式在当前时间生效）。seek 只能向前推进 apply 窗口，但**已应用的样式是历史副作用，不在 timeline 上**（style 靠 `TextStyle` 快照，不像 entrance tween 靠 `timeline.seek` 插值回退）——所以生效点之后的样式不会随 seek 回退自动消失，必须靠 reset 显式清。旧逻辑让 reset 与 apply 共用同一时间过滤，等于假设"回退到生效点之前时该 char 不需要 reset"，但恰恰那时 char 仍带着之前的样式。

修复（R13）：reset 阶段去掉 `timePosition <= currentTime` 过滤，覆盖**所有出现在 `styleRecords` 里的 char**（清回 `baseStyleSnapshot`）；reapply 阶段仍按 `timePosition <= currentTime` 过滤。两窗口解耦后语义自洽：seek 回退 → 全清回 base → 只重放当前时间生效的样式；向前 seek / 从头播 / 多次往返 seek 都幂等（reset→base 后只重放 currentTime 前的样式）。回归 Section 9 加 12 case：核心 seek 跨生效点再回退清回 base / 跨生效点后停留保持生效样式 / 从头 seek 生效点前 base / 多次往返幂等 / 多 char 各自生效时间独立（seek 回退只清各自生效过的）。test:playback 现 99 case（87 + R13 12）。**教训（接 SA-24）：reset/clear 的"清理窗口"与 apply/replay 的"生效窗口"是两个独立语义维度——seek 可回退意味着"已生效"≠"当前时间生效"。凡是不在时间线上、靠 record 重放的资源（style 快照、behavior modifier、instant filter、Graphics 层），reset 阶段都必须覆盖所有可能已被污染的目标，不能与 apply 共用时间过滤。** R8-R12 的 reset boundary（`replayStageModifiers`）反而没踩这个坑——因为 cam.reset 的 boundary 本就是"clear-all"语义（清所有存活 modifier），天然解耦；`replayStyles` 漏看是因为它把 reset 写成了"逐 char 按 record 时间判定"，而非"clear-all 后重放"。

### SA-29（High）：playSegment ended 重播不清 style（R13 的同源、不同路径） — 已修（R14）
SA-28（R13）修了 `replayStyles` 内部的"窗口耦合"，但**同一种 style 资源还有第二个清理路径漏洞**：`playSegment` 的 ended 重播分支。ended 分支只 `clearBehaviors + clearInstantEffects + clearModifiers + tl.seek(0)`，而 `replayStyles` 只在 `seekToTime` 里调用——ended 重播不经过 `seekToTime`，于是已生效的样式（如 `f.hold(1s).red` 染红）会随 `tl.seek(0)` 时间线回 0 但**样式残留**。真实探针：seek 1.5s→`#ff4d4f`；seek 2.0s ended→`#ff4d4f`；playSegment 重播→`#ff4d4f time 0 progress 0`（残留）。

根因（接 SA-28）：SA-28 揭示的是"同一 reset 内两个窗口耦合"，SA-29 揭示的是**另一维度——同一种资源有多个 reset 路径，apply 能去到的状态必须每条路径都能清回**。style 资源的清理散落在四条操作路径：`seekToTime`（R13 修）、`playSegment`-ended（本 R14 修）、`stop`、`clearScreen`。每条路径独立实现清理逻辑，漏一条就残留。这又是 INV-7（多路径单一真相源）的一个新形态——不是"同一判定散落各路径"，而是"同一资源的清理责任散落各路径、无单一真相"。ended 重播语义上 = "回到时间起点"，应等价于 `seekToTime(0)` 的最终态（base + 仅 timePosition<=0 的样式），但 ended 分支没复用 replayStyles，而是自己手写了一份"漏了 style 的清理"。

修复（R14）：ended 分支 `tl.seek(0)` 后调 `this.replayStyles(segment, 0)`。`tl.time()` 已为 0，replayStyles 按 R13 的 reset 覆盖全部 styleRecords（清回 base），只重放 `timePosition<=0` 的样式（通常无，但 red@0 这种起点生效样式会正确保留）→ 干净回到时间起点，且不误清起点生效的样式。回归 Section 10 加 16 case：核心 seek 生效→ended→重播回 base / 多次重播幂等 / red@0 重播后保留（防误清起点样式）/ 多 char 重播后各自回到起点应有状态。test:playback 现 115 case（99 + R14 16）。**教训（接 SA-28）：record-driven 资源的"多路径清理一致性"是 INV-7 的隐形态——抽 reset helper（如 replayStyles）后，必须审计所有"apply 这资源"的操作路径是否都调到了这个 helper，不能让任何路径手写一份清理。** ended 分支当初只照搬了 behavior/instant/modifier 的清理（它们各自有 clear* 入口），却忘了 style 也有独立 reset 语义——因为它和 seekToTime 是两条路径，没人对照。检查清单新增（见 §G）：凡是引入新的"回到时间起点的操作"（ended 重播 / stop / 重 load），必须确认它调了所有 record-driven 资源的 reset helper，与 seekToTime(0) 的最终态对齐。

### SA-30（High）：reset baseline 错位 + pre-hold 样式被当 record 重放（R13/R14 的第三维度） — 已修（R15）
SA-28/R13 修了 `replayStyles` 内部"reset 窗口 vs apply 窗口耦合"，SA-29/R14 修了"多路径清理责任散落"，但 **R13/R14 都假设 reset 的 baseline 是正确的**——它不是。`replayStyles` 的 `resetStyle()` 把字符清回 `baseStyleSnapshot`，而这个 snapshot 是**原始 base**（`LayoutPlanner:70` 在 `applyInitialStylesToStyle` 烘焙 pre-hold 样式之前捕获），不是构建期烘焙后的真实起始态。于是 `f.red`（红色构建期已烘到字符 style）的字符，seek 到 0 时 `resetStyle()` 清回黑色，而构建期样式**没有自然播放 `tl.call`** 来重上 → 字符永远黑。真实探针：构建期烘焙后 fill `#ff4d4f`；seek 0 后 `#000000`（丢失红）。

叠加第二层：site 1（`placeCharOnTimeline`）把 pre-hold 样式注册成 `StyleRecord`（timePosition=字符揭示点），site 3（`unrollCharChain`）对 hold:char 链场景把**所有非 hold:char effect**（含 pre-hold）注册 record + `tl.call`。若只把 baseline 改成烘焙态而不动 record，`big/small`（相对样式，`fontSize *= 1.5`）会重复放大：构建期 24→36 烘到 baseline，seek 重放或 chain `tl.call` 再 apply 一次 → 36→54。探针确认：连续 apply `big` 两次得 54（相对操作非幂等）；`red`（绝对操作）两次仍 `#ff4d4f`（幂等）。

根因（接 SA-28/29）：SA-28 是"reset 窗口与 apply 窗口共用过滤"，SA-29 是"清理责任散落多路径"，**SA-30 是第三维度——reset baseline 语义错位 + record 集合与 baseline 职责重叠**。pre-hold 样式在构建期已烘焙进字符 style，它是字符的**起始状态**而非"运行时才生效的动态变更"，不该进 record 重放集合。旧设计把它当 record 注册（site 1）+ 当 `tl.call` 重上（site 3），同时 baseline 又回原始 base——三个位置对同一种样式的语义互相矛盾：构建期说"它是初始态"，record/tl.call 说"它是运行时变更"，baseline 说"它不存在"。**这是 INV-7 的第三种形态——不是"判定散落"也不是"清理责任散落"，而是"同一资源的语义身份在多位置不一致：它到底是初始态还是动态变更"**。

修复（R15，三处协同）：
- **change A**（`DisplayAssembler:112-113`）：`baseStyleSnapshot` = `glyphPlan.style`（构建期烘焙态）。删除 `Object.assign(char.baseStyleSnapshot, glyphPlan.baseStyleSnapshot)`——不再用原始 base 覆盖。KineticChar 构造时已从 `glyphPlan.style` 捕获正确快照，旧代码又覆盖回原始 base 是 bug 根源。`glyphPlan.baseStyleSnapshot` 字段保留不删（避免改 LayoutPlanner 类型 + 多分支涟漪），仅停止用作 reset baseline。
- **change B**（`TextPlayer.ts:292-304` site 1）：删除整段 pre-hold StyleRecord 注册循环。pre-hold 样式已在 baseline，不需 record 重放（重放 `big` 会重复放大）。
- **change C**（`TextPlayer.ts:682-694` site 3）：`unrollCharChain` 内算出 pre-hold 边界（与构建期 `applyInitialStylesToStyle` 对齐：`hold||blocking||level==="group"||"block"`），pre-hold 区的样式 effect 跳过 `tl.call` + record（已在 baseline），post-hold 区照常。site 2（`unrollGroupChain`）本就 `if (isStyle) return false` 跳过 pre-hold 样式，无需改。

**附带修复**：site 1 旧边界判定（`hold||blocking`）与构建期 `applyInitialStylesToStyle`（`hold||blocking||level==="group"||"block"`）**不一致**——site 1 漏 group/block 级 blocking 判定。R15 删除 site 1 注册后此不一致随之消除；site 3 新边界显式对齐构建期。

回归：§11（`testPreHoldStyleBaseline`，16 case，fake char）锁 replayStyles 运行时语义（baseline=烘焙态 + pre-hold 不进 record + post-hold record 仍重放 + ended 重播不残留 + 多 char 各自 baseline）；§11b（`testDisplayAssemblerBaseline`，4 case，**真实 KineticChar**）锁 change A 的构建期 baseline 捕获——§11 用 fake char 会掩盖 DisplayAssembler 真实路径（SA-27 教训：fake 满足语义≠真实代码满足），§11b 用真实 KineticChar（gsap.ticker stub，见测试文件头）直接调 `materializeGlyphPlan` 验证 `char.baseStyleSnapshot = glyphPlan.style`（烘焙态）而非 `glyphPlan.baseStyleSnapshot`（原始 base）。反向验证：回退 change A → §11b 报 4 失败而 §11 仍通过，证明 §11 fake 掩盖真实差异、§11b 补这个洞。test:playback 现 135 case（115 + R15 §11 16 + §11b 4）。**教训（接 SA-27）：测构建期数据流/真实对象能力时，fake char 会掩盖真实代码路径差异——必须用真实对象（必要时 stub 环境，如 gsap.ticker）直接跑被测代码，不只 fake 的行为契约。§11+§11b 的"fake 锁运行时契约 + 真实锁构建期路径"双层覆盖是 SA-27 教训的落地形态。**

### SA-31（High）：block/global 初始样式经 applyGroupEffects 在构造后写入，不进 baseline — 已修（R16）
SA-30（R15）修了 pre-hold 初始样式进 baseline，但那只覆盖 **DisplayAssembler 路径**（`LayoutPlanner.applyInitialStylesToStyle` 烘焙进 `glyphPlan.style`，KineticChar 构造时捕获 snapshot）。block/global 初始样式走的是**另一条构建路径**：`SegmentBuilder.ts:242` 的 `EffectProcessor.applyGroupEffects(paragraphText, blockRemaining)` 在 KineticChar 构造**之后**同步把 block 样式写入 char.style（`force=true`，`applyStyleRecursively` 逐字）。此时 `baseStyleSnapshot` 已在构造时固化（R15 的 pre-hold 烘焙态，不含 block 样式）——block 样式只在 char.style、不在 baseline、不在 styleRecords。一旦同字符后续有动态样式 record（如 `f.hold(1s).bold` 的 bold 走 site 2/3 record 路径），`replayStyles` 的 `resetStyle()` 回 baseline（无 block 样式）→ **block 样式丢失**。

复现形态：`[.red:block]\n{Hello} @ f.hold(1s).bold` → seek 1.5 预期 red+bold，实际 base+bold（red 丢）。探针确认：block red 经 applyGroupEffects 同步应用后 `style.fill=#ff4d4f`，但 `baseline.fill` 仍 `#000000`（block 样式没进 baseline）。

根因（接 SA-30）：SA-30 揭示"baseline 与 record 职责重叠 + 语义身份多位置不一致"，**SA-31 是同源病的第二条构建路径**——pre-hold 初始样式有两条写入路径：(a) DisplayAssembler 烘焙（R15 修，进 baseline）；(b) SegmentBuilder 的 applyGroupEffects 同步应用（R16 修前不进 baseline）。R15 只修了 (a)，漏了 (b)。block/global 样式经 (b) 写入，在构造之后，snapshot 已固化，于是又落回"构建期说初始态、baseline 说不存在"的矛盾。**这是 SA-30 的多路径维度——同一种"初始样式进 baseline"语义散落在多条构建路径上，每条独立实现就漏一条**（与 SA-29 的"多路径清理责任散落"同构，只是这里散落的是"baseline 烘焙责任"而非"清理责任"）。

修复（R16）：`KineticChar` 新增 `recaptureBaseStyleSnapshot()`（从当前 style 重新捕获，字段集与构造/resetStyle 一致）；`SegmentBuilder.ts:242` 在 `applyGroupEffects` 后遍历 `paragraphText.tokens` 的所有 char 调 `recaptureBaseStyleSnapshot()`，把 block/global 构建期样式烘进 baseline。与 R15 同模型——构建期已应用的初始样式进 baseline（不进 record 重放），避免相对样式 big/small 重复放大。

回归：§12（`testBlockStyleBaselineRecapture`，16 case，**真实 KineticChar**，gsap.ticker stub）锁 recapture 契约：构造（baseline=raw）→ 同步应用 block red → recapture（baseline 含 red）→ 动态 bold record seek 1.5 后 red+bold 都在 / seek 0.5 仅 red / resetStyle 回 recaptured baseline / block big 不重复放大（36 非 54）/ ended 重播不残留 bold。**覆盖范围说明（SA-27 教训延续）：§12 测的是 `recaptureBaseStyleSnapshot` 契约（真实 KineticChar 上的方法行为），与 §11b 测 `materializeGlyphPlan` 同级。SegmentBuilder 的调用点（applyGroupEffects 后遍历 tokens 调 recapture）是构建期接线，§12 不直接覆盖该遍历——但接线是 3 行简单遍历+调用，recapture 契约已由 §12 完整锁定，且现有 151 case 的 build 链路间接覆盖。若未来出现 block 样式经第三条构建路径写入，须再审计是否进 baseline（SA-31 的多路径维度）。** test:playback 现 151 case（135 + R16 §12 16）。

### SA-32（架构根治）：style 资源身份判定单一真相源 + 端到端真实管线回归 — 已修（R17）
SA-28/29/30/31 四轮修了 INV-7 在 style 数据流的四个形态（窗口耦合 / 多路径清理 / baseline 错位 / 第二条构建路径），但都是**逐点补丁**——"初始态 vs 动态变更"判定 + pre-hold 边界仍散落在 P1-P5 各写入路径，每条独立实现。`shouldApplyAsInitialStyle`（EffectProcessor.ts:398）已是"初始样式"判定的 90% 真相源，但只被 P1 用，P2-P5 各自手写。R17 把它扩为 `classifyStyleWrite(config) → {isStyle, isBlocking}` 单一真相源，P1-P5 全部改调它——pre-hold 边界统一为 `hold||blocking||level==="group"||"block"`（消除 site1 旧 `hold||blocking` 漏 group/block 的不一致，固化防回退），isStyle 统一经 `styleManager.has`。replayStyles（P5）不改逻辑，只更新注释——它只消费 baseline + record 集合，职责分离由 P1-P4 经 helper 保证。

**行为零变化是核心承诺**：改动 1-6 都是"把已有判定改调 helper"，helper 产出与各点原判定相同（逐点核对：P1 边界本就是 `hold||blocking||group||block`；P3 site2 本就 `isStyle→false`；P4 site3 R15 已对齐；P5 不改逻辑）。现有 151 case 全过验证。**这是 INV-7 在 style 数据流的根治**——不是新加一处判定，而是把散落的五处判定收敛到一个无状态 helper，未来新增第六条 style 写入路径经它分流即可，不再手工对齐（消除 SA-31 复发条件）。

**端到端真实管线回归（§13，SA-27 教训关键落地）**：§9-§12 用手动构造的 char/segment 锁定语义，但**掩盖真实 SegmentBuilder 路径**（fake 满足语义≠真实代码满足）。§13 用真实 `parser → SegmentBuilder.build → PlaybackController.seekToTime` 端到端驱动（headless shim：gsap 互操作 hoist + document stub + DOMAdapter canvas 合成度量），11 case 覆盖 block red / char red / char big / ended 重播。**§13 上线即暴露两个测试假设错误**（非 bug）：(1) `f.red` char 级 fill 经 Pixi v8 规范化成 Fill 对象（color=0xff4d4f），不是字符串——fake char 用字符串 fill 掩盖了真实类型，§13 改用 `fillHex` 读 Fill.color 转 hex；(2) `f.big` baseline=54 不是 36——KineticText 默认 fontSize=36（rebuild _options 默认），big ×1.5=54 是单次应用的正确结果，fake char 假设默认 24 掩盖了真实默认。两者都证明 SA-27 教训：**真实管线测试才暴露 fake 掩盖的假设错误**。test:playback 现 162 case（151 + R17 §13 11）。

### SA-33（High）：显式 `:group` / token 级 `:block` style 被吞（R17 单一真相源的边界 bug） — 已修（R19）
R17 把"初始态 vs 动态 + pre-hold 边界"收敛到 `classifyStyleWrite(config) → {isStyle, isBlocking}` 单一真相源，承诺"行为零变化"。但收敛时把**原始边界表达式**（`isBlocking = hold||blocking||level==="group"||level==="block"`）原样固化进 helper——而这个表达式是 **v1.0.0 遗留、无设计理由**的规则（git pickaxe 确认：commit 9ad54bd 起就在，早于 R13-R17 全部审计；SA-30/31/32 只把它当"继承不变量保留"，从未验证 group-scoped *style* 命令的后果）。该规则对**非 style 容器级特效**（filter/timing/stage）是正确的——它们不该被折叠进逐字初始快照，故 level group/block 终止烘焙。但对 **style** 是错误的：style 经 `applyStyleRecursively` 最终落到每个 KineticChar，不分容器/逐字语义，应与 char/block 同模型进 baseline。

后果（用户探针确认）：显式 group style（`f.red:group`）+ token 级 block style（`f.red:block`，注意段落广播 `[.red:block]` 走 P2 recapture 已正确）落进两套规则的缝——(1) P1 `applyInitialStylesToStyle` 遇 `isBlocking=true` 直接 `break` → 不烘焙 baseline、不进测量；(2) site2 `unrollGroupChain` 的 `shouldExecute` 里 `if(isStyle) return false` → 不注册 StyleRecord。→ 既不在 baseline、也不在 record，自然播放 + seek 全失效（静默吞掉，无报错）。**根因不是"少了一条路径"，而是 R17 收敛时把"边界规则"与"身份判定"耦合——边界对 style 和非 style 用了同一份表达式**。

修复（R19）：在 `classifyStyleWrite` 内把 **style 与非 style 边界解耦**——`isStyleScoped = isStyle && (level==="group"||"block")`；`isBlocking = !isStyleScoped && (hold||blocking||level group/block)`。即 style 不受 level 边界阻断（只有非 style 容器级特效才终止烘焙）。`shouldApplyAsInitialStyle`（同源 helper，产物 `participatesInStylePreview` 目前无消费方但保持同源防漂移）改为复用 `classifyStyleWrite`。site2 `unrollGroupChain` 的本地 `isBlocking`（R17 漏收敛、仍 `hold||blocking`）改为走 `classifyStyleWrite` 单一真相源（与 site3/SegmentBuilder 对齐）。于是显式 group/block style 经 P1 烘焙进 baseline（与 char/block 同模型），测量同步应用 big/small（避免"测量 36、应用 54"几何错位），site2 仍 `if(isStyle) return false` 跳过 pre-hold（避免双重放大）；post-hold 的 group/block style 仍经 site2 进 record（groupHoldEncountered=true → shouldExecute=true）。

回归：§14（`testGroupBlockStyleBaseline`，20 case，**真实 parser→SegmentBuilder→seek 管线**，复用 §13 headless shim + fillHex）覆盖：f.red:group / f.red:block(token) 进 baseline 不进 record / f.big:group baseline=54 不双重放大 / seek 回退幂等 / f.red:group.hold(1s).bold（pre-hold red 进 baseline + post-hold bold 进 record，对应用户探针最后一行）/ f.hold(1s).red:group（post-hold red 进 record 不进 baseline，seek 0.5 无红/1.5 有红/0 回退无红）/ f.red char 级对照（防 R15/R17 回归）。test:playback 现 182 case（162 + R19 §14 20）。**教训（接 SA-32）：抽单一真相源 helper 时，"行为零变化"承诺必须逐点核对**——R17 核对了 P1-P5 各点原判定与 helper 产出相同，但漏核对了**边界表达式本身对 style 是否正确**（把 v1.0.0 遗留规则当不变量固化）。单一真相源收敛的是"散落判定"，不等于"判定正确"——若被收敛的判定本身有 bug，收敛只会让 bug 更隐蔽（五处一致地错）。凡是从既有代码提取 helper，必须区分"收敛散落逻辑"与"背书该逻辑的正确性"——后者需要独立验证（本例：level group/block 对 style 是否该终止烘焙，应从 style 的语义模型推导，而非继承表达式）。检查清单新增第 13 条（见 §E）。

### SA-34（Medium）：E2E 回归补三条未覆盖 track + 多 token/多段 + 发现 R20 — 已补（SA-34）
§13/§14 只覆盖了 style track 的 E2E（真实 parser→SegmentBuilder→seek）。behavior / instant / entrance filter 三条 track 的 cleanup 契约只在 §7/§8 用 fake target 测——真实管线的三段独立接线（unrollGroupChain behavior 分流 + registerBehaviors 的 unpackBehaviorResult + gsap.ticker 驱动 / SegmentBuilder blockInstant 分流 + InstantEffectRecord + clearInstantEffects 从真实 filters 移除 / captureEntrance 解包 {tween,filter} + EntranceFilterRecord）fake 会掩盖分流错误。helper 也只取 activeTexts[0] 首个非空白 char——多 token、跨 token 交互、char_stagger、多段落零覆盖。

**前置探针确认 headless 可行性**（SA-27 教训：先验证再写测）：pixi v8 filter 实例化（`new BlurFilter()` 等）构造 `GpuProgram`/`GlProgram` 数据结构但**懒加载 renderer 意味着不真正 compile/link shader**（要等 renderer 应用 filter 时才发生），故 `char.filters = [blur]` 在 node + 现有 DOMAdapter shim 下不崩。7 个 filter 探针（blur/pixelate/gray/blurIn char 级 + blur:group/gray:block 容器级）全过，**不需额外 renderer stub**——现有 §13 配方（gsap 互操作 + document stub + DOMAdapter canvas）足够。

补测（§15-§19，31 case，全真实管线）：§15 behavior blur（build 后 filter 未 apply、seek 时 registerBehaviors 才 apply + 登记 cleanup，seek 来回幂等不堆积）+ blurIn+blur 共存不互误清；§16 instant pixelate（同模型 + post-hold pixelate seek 0.5 无/1.5 有/回退移除）；§17 entrance blurIn（build 时 apply、seek 不清理靠 timeline 插值、ended 不清理）+ blurIn+red 两管线不互扰；§18 多 token（`{Hello} {World}` 各自染红）+ hold:group.red post-hold 进 record；§19 多段落（`\n\n` 分段，段1 red:block 不污染段0）。

**关键发现 1（§16 副产物）**：`gray`/`threshold`/`posterize` 等同时在 styleManager 与 effectManager 注册（双重身份），`classifyStyleWrite({name:"gray"}).isStyle === true` → 走 style 管线（baseline/record）非 instant filter。故 instant filter E2E 必须用 `pixelate`（纯 effect，isStyle:false）。这是真实的身份分流，非 bug。

**关键发现 2（§18 暴露 R20 bug）**：`f.hold:char(0.1s).red` 的 red **被吞**（records=[]、fill 非红）——与 R19 同类的边界 bug。对照：`f.hold:group(0.1s).red` 的 red 正确进 record（red@0.3），`f.hold:char(0.1s).hold(1s).red` 也正确进 record（第二个 hold 让 red 落 post-hold）——只有"hold:char 之后、无其他 blocking 之前"的 style 被吞。根因初判：site3 `unrollCharChain` 过滤掉 hold:char 后，`firstPostHoldIndex` 计算把 red 落到 `i < firstPostHoldIndex` 被跳过，但 red 实际是 post-hold（在原 hold:char 之后）应进 record。**R20 待修**，§18 已用 xfail 断言登记（当前 red 确实被吞——records 空、fill 非红——R20 修后此断言会失败，届时翻转为正向）。test:playback 现 213 case（182 + SA-34 §15-19 31）。**教训**：E2E 补测本身就会暴露真实 bug（§18 的多 token 场景触发了单 token 测不到的 hold:char 链路径）——这正是补测的价值，也是 SA-27"真实管线才暴露 fake 掩盖"的延续。

### SA-35（High）：hold:char 链 post-hold style 被吞（R19 同类的 site3 边界 bug） — 已修（R20）
SA-34 §18 多 token E2E 暴露：`f.hold:char(0.1s).red` 的 red 被吞。根因（4 场景探针确认）：site3 `unrollCharChain`（TextPlayer.ts:677-717）的 pre-hold 边界计算**顺序错误**——`:678` 先把 hold:char 从 `activeEffects` 滤掉（char_stagger 模式下 hold:char 是 stagger 间距参数 `holdDelay`，不是链步骤），`:686-694` 才在**已过滤的** activeEffects 上找 blocking。hold:char 是 `name==="hold"` → `classifyStyleWrite.isBlocking=true`，本是边界触发点，但已被滤掉 → 边界循环找不到 blocking → `firstPostHoldIndex=activeEffects.length` → 所有剩余 style 落 `i < firstPostHoldIndex` → 被 `continue` 跳过 → 被吞。

**P1 与 site2 都对**：探针确认 `f.red.hold:char` 的 red 进 baseline（P1 在 hold:char 处 break 前 apply）；site2（group 链）不过滤 hold:char 故边界正确。**只有 site3（char 链）**因 hold:char 提前过滤而边界失效。完整病态：`f.hold:char.red` / `f.hold:char.bold.red`（全吞）/ `f.red.hold:char.bold`（red 进 baseline 但 bold 被吞）。

修复（R20）：把 `firstBlockingOrigIdx` 的计算从"过滤后的 activeEffects"改为"**原始 visualConfigs**"（含 hold:char）。`activeEffects` 改为携带每个 effect 的 `origIdx`（原始链位置）；stagger 循环的 pre-hold 判定改为 `origIdx < firstBlockingOrigIdx`。一致性：`f.red.hold:char`（firstBlockingOrigIdx=1，red origIdx=0 < 1 → pre-hold 跳过，已在 baseline ✓）；`f.hold:char.red`（firstBlockingOrigIdx=0，red origIdx=1 >= 0 → post-hold 进 record ✓）；`f.red.hold:char.bold`（red pre-hold 烘焙 + bold post-hold record ✓）；`f.hold:char.hold(1s).red`（firstBlockingOrigIdx=0，red post-hold，与现状一致无回归 ✓）。无 hold:char 的链不走 site3（chainPlanning.ts:64 路由条件），不影响 site2/placeCharOnTimeline。

回归：§18 的 2 个 xfail 翻转为正向（red 进 record + seek 生效）+ 补 3 case（`f.red.hold:char` pre-hold 烘焙、`f.red.hold:char.bold` 混合 pre/post、`f.hold:char.bold.red` 两 post-hold）。test:playback 现 219 case（213 + R20 §18 翻转+补 6）。**教训（接 SA-33）**：R19 修了 classifyStyleWrite 的边界（style vs 非 style 解耦），但 site3 有**第二处独立的边界计算**（firstPostHoldIndex），它复用了 `classifyStyleWrite` 的 isBlocking 判定却**自己持有了一份"哪些 config 在边界之前"的列表**（activeEffects 过滤），这份列表与 P1 的原始链顺序脱节。这是 INV-7 的又一形态：**边界判定的"游标载体"（承载 blocking config 的列表）与"判定真值源"（classifyStyleWrite）不同源**——真值源对了，但游标载体丢了 hold:char，判定仍错。修单个 helper 不够，还要核对每个调用点"它喂给 helper 的 config 集合"是否完整。检查清单第 15 条（见 §E）。

### SA-36（High）：block/global post-hold style 被吞 + 墙钟副作用（R19/R20 同类的 block 链边界 bug） — 已修（R21）
R13-R20 把 char / group / char-chain / token 级 block 的 pre-hold/post-hold 边界逐条修对（SA-30..35），但 **paragraph 级 `[....:block]` / global 这条路径**整条经 `applyGroupEffects` 同步应用，**没有按 pre-hold / post-hold 拆分**。完整病态（探针确认）：
- `[.hold:block(0.05s).red:block]`：red 既不进 baseline（`#ffffff`）也不进 record（`[]`），但 hold 到点后 `applyStyleRecursively` 触发 → 不播不 seek，加载后过 120ms **自己染红**（`#ff4d4f`），seek/reset 都管不住（墙钟副作用）。
- `[.red:block.hold:block(1s).bold:block]`：red 进 baseline（pre-hold 正确），但 bold 不进 record → seek 1.5 无 bold（hold 到点后会墙钟触发，但已离开 seek 管线）。

根因（SegmentBuilder.ts:241-256 旧代码）：`blockRemaining`（style + hold + timing/unknown）整条丢给 `applyGroupEffects(paragraphText, [...blockRemaining])` **且不 await**。`applyGroupEffects` 内（EffectProcessor.ts:231-298）`hold:block` 返回 `gsap.delayedCall` promise → `:280` `await result` → 函数挂起。两个并发后果：(a) 构建期同步的 `recaptureBaseStyleSnapshot` 跑在 hold resolve **之前** → post-hold style 漏 baseline；(b) applyGroupEffects 无 `styleRecords` 概念 → post-hold style 不进 record。最终 hold 到点后函数恢复 → `applyStyleRecursively` 把 style 写进 `char.style` → **墙钟副作用**（不经 timeline、不经 record，seek/reset 管不到）。

修复（R21）：block 链按 pre-hold / post-hold 边界拆分（**镜像 site2 `unrollGroupChain` + site3 hold:char 模型**，`classifyStyleWrite` 单一真相源判边界）：
- pre-hold style → `applyGroupEffects` 同步应用 + `recaptureBaseStyleSnapshot`（R16/P2 模型不变）。
- `hold` → 推进 `chainCursor`（构建期**不真等**，与 site2 `chainCursor += dur` 一致）——抽走不进 applyGroupEffects。
- post-hold style → `segmentTl.call` + `allStyleRecords`（seek 由 `replayStyles` 重放；正向播放 segmentTl.call 触发 apply）。
- 非 style 非 timing 残留（unknown）→ 仍经 applyGroupEffects（hold 已抽走不阻塞）。

**对照 SA-30..35 的渐进收敛**：R13-R16 建 baseline/record 模型 + recapture；R17 收敛 `classifyStyleWrite` 单一真相源；R19 解耦 style vs 非 style 边界；R20 修 site3 hold:char 链的"游标载体"不同源。R21 是把**最后一条未拆分的 style 写入路径**（paragraph block 链）纳入同一模型——此前它一直是"整条同步应用"的特例，没人把它按 pre/post-hold 拆。这印证 SA-35 的教训："修单个 helper 不够，还要核对每个调用点"——`classifyStyleWrite` 对了，但 block 路径根本没调用它做边界拆分，而是整条经 applyGroupEffects。**根因是模型未覆盖到这条路径**，而非 helper 判定错。

回归：§20（`testBlockPostHoldStyleE2E`，16 case，真实 parser→SegmentBuilder→seek 管线，复用 §13 headless shim）。覆盖：用户报告的 case A/B（post-hold red 墙钟检测 + red+bold 混合 seek 往返）/ pre-hold 对照（防 R16 回归）/ big 相对样式 post-hold 防双重放大 / hold 在末尾无 post-hold 退化。**关键断言**：case A 在 `setTimeout(120ms)` 后断言 `style.fill !== "#ff4d4f"`——直接锁墙钟副作用（不播不 seek 过了 hold 时间，style 必须未被触发）。test:playback 现 235 case（219 + R21 §20 16）。**教训（接 SA-33/35）**：style 的 pre-hold/post-hold 模型在 char / group / char-chain / token-block 四条路径修对后，**第五条路径**（paragraph block 链）仍走旧的"整条同步"特例。每次收敛一条路径，都要全局 grep 确认"同语义的其他写入路径"是否也走了新模型——block 链一直藏在 `applyGroupEffects` 同步路径里（不是独立 site），不像 site2/site3 那样显式，容易被遗漏。检查清单第 16 条（见 §E）。

### SA-37（High）：exact-boundary 双 apply——seek 与 play 共享 tick 跨越事件（R22） — 已修（R22）
R13-R21 把 record-driven 资源的"构建期分工"模型逐条修对（baseline/record 职责分离、reset/apply 窗口解耦、多路径 reset 覆盖），但 **exact-boundary（seek 落在 record.timePosition 上、随后 play）这条 seam** 是模型盲区——它不是"构建期两驱动撞车"（R15 那类），而是"运行时两个驱动共享同一 GSAP tick 跨越事件"。

**探针验证前提（2026-06-30，gsap 3.14.2）**：`tl.call(fn, [], t)` **不是** `tl.play()` 同步触发的——而是在 ticker tick 上、当 `tl.time()` 跨越 t（从 =t 推进到 >t）那一刻触发。生产代码 `PlaybackController.ts:138`（旧注释）写"tl.play() 同步触发的 0 秒 segmentTl.call"**不准确**——生产之所以工作，是因为 `isAutoPlaying` 在 play 前已置 true（145 行），call 在 play 后首个 tick 跨越 0 时触发、读到 true 放行，而非 play() 同步触发。探针 D1/R1 锁定：seek(1.0) → play() → calls=0（play 不触发）→ tick(1/60) → calls=1（tick 跨越 1.0 触发）。

**病态**：seek 落在 record.timePosition 上、随后 play，首个 tick 让 tl.time 从 =timePosition 推进到 >timePosition——这是"跨越"，同一 record 的 tl.call 会再 apply 一次，与 seek 的 register*/replayStyles/replayStageModifiers 双 apply：
- `{Hi} @ f.pixelate`：seek(0) → filter=1；play() 一 tick → filter=2，cleanup=3（双 push）。
- `{Hi} @ f.blur`：同形。
- `[.hold:block(1s).big:block]\nHello`：seek(1.0) → fontSize=54；play() → 81（big ×1.5 两次=×2.25，几何错）。

**两个候选抑制机制的探针裁决**：
- **flip-the-guard**（`isAutoPlaying=false→play()→=true`）：**FAILS**——call 是 deferred 到 tick 的，flip 在 play() 返回时已恢复 true，tick 触发时 guard 已开（探针 D1：`CALL fired isAutoPlaying=true`，calls=1）。
- **ownership-flag**（`state.lastSeekTime` 单值，boundary tl.call guard 检查 `record.timePosition===lastSeekTime` 跳过）：**WORKS**——flag 在 play() 与 deferred tick 之间存活（探针 M1：boundary tl.call SKIPPED，calls 不增）。

**修复（R22）**：
- `PlaybackRuntimeState` 加 `lastSeekTime?: number` 字段（有状态所有权 flag——项目"靠构建期分工不靠运行时判重"约定的**有状态例外**，因 GSAP deferred 语义使构建期让两驱动不撞车在 exact-boundary 上不可能）。
- `seekToTime` 末设 `lastSeekTime = clamped`；`playSegment` 在 register* 前设 `lastSeekTime = tl.time()`（统一三条路径：t=0 fresh-build / t=0 ended-replay / t>0 resume）。
- 所有 boundary `tl.call`（style 3 处 + stage modifier 4 处 + behavior/instant 4 处）加 guard：`if (state.lastSeekTime === record.timePosition) return;`——seek 已应用过该 record，play 的 tl.call 让位给快照消费者。
- `playSegment` 去掉原 `tl.time()>0` gate，统一调 `register*` + `replayStyles` + `replayStageModifiers` 单一拥有当前态——原 t=0/ended 路径靠 0s tl.call 驱动 behavior/instant/stage-modifier，现翻转：快照消费者驱动，0s tl.call 让位（否则抑制后 0s cam.shake/cam.drift 丢失）。这是 R22 的范围扩展——原 R21 只修了 style 这条 seam，stage-modifier 的 t=0 路径一直靠 tl.call 驱动、未进 replayStageModifiers。
- `playbackState` 经 `TextTimelineBuildOptions` 传入 `TextPlayer.buildTimeline` → `unrollGroupChain`/`unrollCharChain`/`TextStageCueScheduler.schedule`（这些 tl.call 闭包需读 lastSeekTime）。

**浮点 === 安全**（探针 T1-T5 验证）：seek 的 clamped 与 record.timePosition 同源（record = 构建期 cursor 算术；seek = UI 从 onTimeUpdate(clamped*1000) 回传 /1000），bit-identical；seek 落非 record 时间时 tl.time() 可能被 gsap 量化（T5），但此时无 record.timePosition 等于它，guard 不触发——量化只发生在"无 boundary 要抑制"的情况，无害。

回归：§21（`testR22LastSeekTimeLifecycle`，lastSeekTime 生命周期 5 case，同步不需 ticker）/ §22（`testR22GsapPremise`，GSAP deferred-fire 前提探针 3 case，锁定 load-bearing 假设防 gsap 升级静默破坏）/ §23（`testR22BoundaryGuardMechanism`，A/B/C/D 端到端 9 case）。test:playback 现 252 case。**测试环境局限**：套件 stub gsap.ticker（add/remove no-op），tl.play() 不推进时间、deferred boundary tl.call 不在套件内触发——无法直接复现 seek+play 双 apply（需浏览器 rAF 驱动 ticker）。故 §23 用「seek 后验证 lastSeekTime===record.timePosition + guard 判定应 skip」锁定机制正确性，不依赖 ticker 触发。§22 用 G.default 的真实 ticker 验证 deferred 前提（弱断言：flip 失败 calls=1 / flag 成功 calls=0，环境不稳时降级）。

**教训（接 SA-30..36）**：R13-R21 把"构建期分工"作为去重约定（每时刻只有一个 apply 驱动，靠 construction 不靠运行时判重），但 **GSAP 的 deferred 触发语义**使这条约定在 exact-boundary 上**物理不可能**——seek 与 play 共享同一 tick 跨越事件，两驱动必然撞车。ownership-flag 是"构建期分工"约定在 GSAP 语义下的**必要例外**，而非约定的失败。判别：若两驱动的触发时机在构建期可分离（如 baseline vs record、不同时间线段）→ 靠 construction；若两驱动共享同一运行时事件（如 seek 与 play 共享 tick 跨越）→ 需有状态 flag 让位。**教训二**：探针先于写代码——R22 最初 approved plan 用 flip-the-guard（同步触发假设），探针证伪后才转 ownership-flag；若直接写 flip 会在浏览器环境暴露失败（套件 stub ticker 掩盖，生产 rAF 才暴露）。**教训三**：注释中"同步触发"这类对底层库行为的断言须探针验证后写——PlaybackController.ts:138 旧注释的不准确误导了多轮修复方向。

### SA-38（Medium）：stage modifier 默认参数 seek/自然播放不一致 — 已修（R22-followup）
审查者（非阻塞）发现 `cam.shake(var.missing, var.missingDur)` 下 seek 重放与自然播放不一致。根因不是"默认值没设好"，而是 stage modifier **有两条参数解析路径、用了不同 fallback 约定**，而视觉特效体系只有一条。

**病态**：
- seek 重放（`buildStageModifierRecord` / `getStageModifierDuration`，stagePresets.ts:90/108/160）：`resolveStageNumeric(raw, 0.5)` / `SHAKE_STRENGTH_FALLBACK(=5)` → 缺失变量 fallback **命令预设默认值** → strength=5/duration=0.5（正常 shake）。
- 自然播放（`tl.call` 传 raw `config.params` → `StageRuntime.apply` 二次解析，StageRuntime.ts:146/158）：`resolveValue(val, 0)` → 缺失变量 fallback **0** → strength=0/duration=0（几乎无效果）。

**对照视觉特效体系（安全面）**：`EffectProcessor.resolveParams`（EffectProcessor.ts:169）构建期一次性解析（只引用替换、不替换 fallback），结果存进 record；seek 的 `register*`/`replayStyles` 与正向 `tl.call` **读同一份 pre-resolved params**，经同一 preset `fn`（内部 `||`/`??` 默认）→ 两路径必然同值。`EffectManager.apply`/`StyleManager.apply` 都不再解析，透传 params。视觉特效没有"第二条解析路径换 fallback"的机会，故无此裂缝。

**修复（R22-followup）**：把 stage modifier 接到视觉特效同模型——构建期一次性预解析，两条路径共享。新增 `buildStageModifierApplyParams(command, rawParams)`（stagePresets.ts）：缺失变量按命令预设默认值解析（与 `stagePresets["cam.shake"]`/`["cam.drift"]` 的 `??` 默认同源），非数值字段（如 `static:true`）原样透传。四处 stage modifier `tl.call`（SegmentBuilder.applyStageConfigs / TextPlayer.unrollGroupChain / unrollCharChain / TextStageCueScheduler.schedule）改传预解析 params 而非 raw。`StageRuntime.apply` 见数字直接透传（`resolveNumeric` 对 number 原样返回），不再 fallback 0。

**单一真相源**：默认值常量（`SHAKE_STRENGTH_FALLBACK`/`DRIFT_SPEED_FALLBACK`/`getStageModifierDuration` 的 0.5）须与 `stagePresets["cam.shake"]`/`["cam.drift"]` 的 `??` 默认同步——新增 modifierBased 命令时 `buildStageModifierApplyParams` 与 preset 同步更新，否则两边默认值又会裂。

**范围**：仅 modifierBased（cam.shake/cam.drift）。可 seek tween 命令（cam.move/zoom/rotate/offset）无 seek 重放路径消耗数值（timeline 插值），不在此次修复范围——它们的自然播放 fallback（StageRuntime 的 `(before as any)[key] ?? 0`）是"当前相机状态"语义，与 modifierBased 的"命令预设默认值"语义不同，不强行统一。

回归：§24（`testStageDefaultParamAlignment`，8 case）：(1) `cam.shake(var.missing)` 两路径默认值一致（5/0.5）；(2) `cam.shake(var.defined)` 两路径解析成定义值；(3) `cam.drift(var.missing)` 自然播放默认值（5/0.001）；(4) 数字直接传两路径原样透传。test:playback 现 260 case。

**教训（接 SA-37）**：R22 修 exact-boundary 双 apply 时，审查者已标出此 Medium 残余风险——"未定义变量下 record replay 与自然播放不一致，不挡合并但后续最好统一"。本修正是该残余的闭合。**根因不是单个默认值错，而是缺乏"构建期解析一次、两条路径共享"的结构**——stage modifier 自然路径一直用 raw params + 运行时二次解析，没接 pre-resolved record 模型。判别：凡 seek 重放路径与自然播放路径都消耗同一资源的数值参数，必须共享一份构建期 pre-resolved 解析，不能各解析各的（视觉特效体系的结构优势）。这是 INV-7（多路径单一真相源）在"参数解析"维度的体现——之前 SA-16..19 是"分流逻辑"维度，SA-30..37 是"apply 驱动"维度，SA-38 是"参数解析"维度。

### 审计方法学注记
本次审计用 §C 覆盖矩阵 + §E 清单 + INV-7（多路径单一真相）+ INV-8（外部依赖已验证）四把尺子反向核对。**发现集中于 INV-7**（SA-16/17/18/19 全是多路径分流分裂），说明 INV-7 是本仓库结构性的反复发病点——R2 的 stage modifier 分裂只是最新一例。SA-16..19 已在同轮修复（抽 `unpackBehaviorResult` / `isCharLevelEffect` / `resolvePauseDuration` / 改调 `getTrack`），并用 node 内联脚本验证解包/level/duration 逻辑与原代码逐字段/逐 case 一致（无行为回归）。§B-bis 已验证清单（SA-15 触发建立）现覆盖 14 条 GSAP/Pixi/tsx 边界行为（SA-23 补 pixi headless + tsx gsap 互操作 2 条；SA-32/R17 补端到端管线 headless shim 6 条：gsap hoist / document stub / DOMAdapter canvas / Pixi Fill 对象 vs 字符串 / KineticText 默认 fontSize 36 / measureFont 路径），剩 1 条（premultiplied alpha）待浏览器渲染验证。SA-22/23（方向 A）把尺子从静态扫描扩展到运行时回归（`pnpm test:playback` 现 235 case 锁定 seek/phase/resume + reset boundary 过滤双维度(sequence) + 多 reset 取 max + resolvePauseDuration 变量解析 + Graphics instant seek 回退清理 + bg/border:block 真实 KineticText 路径 + replayStyles seek 回退清 style + playSegment ended 重播清 style + pre-hold baseline 错位 + record 去重 + block/global baseline recapture + 端到端真实管线 + 显式 :group/token :block style baseline + behavior/instant/entrance filter build+seek 幂等 + 多 token/多段落 + hold:char 链 pre/post-hold style 分流 + block/global post-hold style 边界）。SA-34 补三条未覆盖 track 的 E2E（behavior/instant/entrance filter，§15-19 31 case），前置探针确认 pixi filter 实例化在 headless 不需 renderer stub（懒加载，构造 GpuProgram 数据但不 compile shader），并暴露 R20。SA-35（R20）修 site3 hold:char 链边界 bug——§18 多 token E2E 触发，根因是边界判定的"游标载体"（过滤后的 activeEffects）与"判定真值源"（classifyStyleWrite）不同源（hold:char 被提前过滤），§18 xfail 翻转 + 补 case。SA-36（R21）修 paragraph block 链 post-hold style 被吞 + 墙钟副作用——block/global 路径整条经 applyGroupEffects（不 await）未按 pre/post-hold 拆分，§20 补 block post-hold E2E（含墙钟副作用检测断言）。SA-24（R8）经六轮（R8-1/R8-2/R8-3/R9-High/R10/R11）闭合，根因是建模而非具体形态——六轮都把 reset 的 clear-all 语义误表达（单标量 / 仅创建序 / 顺序赋值 / 仅时间漏退化 / ordered 索引非 build 序），最终用 `sequence` 字段（build/push 序）+ `effectiveTime`（max）双维度闭合。Coco 从 R8-2 起就建议的"稳定 sequence 字段"到 R11 才落地——回避显式字段是最深教训。SA-25（R9-Medium）是 SA-19 集中时的同源债遗漏。SA-26（R12）是 instant cleanup 模型只建 filter 子类、漏 Graphics 子类——同类 track 下的两种副作用子类各需独立 cleanup。SA-27（R12-block）是 SA-26 的同源延续：R12 的 graphicsLayer cleanup 守卫对真实 block 级 `KineticText`（无 getGraphicsLayer）静默失效，回归用 fake target 盖住真实差异——fake 满足守卫不等于真实 target 满足，回归必须用真实对象跑一遍。连带暴露 visual.ts 坐标原点预存 bug（getContentBounds 对 center/right/indent 返回非零 x/y，effect 画法假设原点 0）。SA-28（R13）是 R8-R12 之外的又一类"窗口耦合"病：`replayStyles` 把 reset 窗口与 apply 窗口共用 `timePosition <= currentTime` 过滤，seek 回退到生效点之前时无 record 命中 → 不 reset → 样式残留。SA-29（R14）是 SA-28 的同源、不同路径：style 资源有四条清理路径（seekToTime / playSegment-ended / stop / clearScreen），R13 修了 seekToTime，ended 重播分支自己手写了一份"漏了 style 的清理"——同一种资源的 reset 责任散落多路径、无单一真相（INV-7 隐形态）。SA-30（R15）是第三维度：reset baseline 错位（`baseStyleSnapshot`=原始 base 而非构建期烘焙态）+ pre-hold 样式被当 record 重放/`tl.call` 重上（构建期说"初始态"、record 说"动态变更"、baseline 说"不存在"——同一种资源在三处语义身份不一致）+ big/small 相对样式重复放大。SA-31（R16）是 SA-30 的同源、第二条构建路径：pre-hold 初始样式有两条写入路径——(a) DisplayAssembler 烘焙（R15 修进 baseline）、(b) SegmentBuilder 的 applyGroupEffects 同步应用（R16 修前不进 baseline）。R15 只修 (a) 漏 (b)，block/global 样式经 (b) 在构造后写入、snapshot 已固化 → 又落回"baseline 说不存在"。SA-32（R17）是架构根治：四轮逐点补丁后，把散落 P1-P5 的"初始态 vs 动态变更 + pre-hold 边界"判定收敛到 `classifyStyleWrite` 单一真相源，P1-P5 全部改调它——消除 INV-7 在 style 数据流的复发条件（未来第六条写入路径经它分流即可）。并补 §13 端到端真实管线回归（parser→SegmentBuilder→seek，headless shim），暴露两个 fake char 掩盖的测试假设错误（Pixi Fill 对象 vs 字符串、KineticText 默认 fontSize 36 vs 24），证明 SA-27 教训：真实管线测试才暴露 fake 掩盖的假设。SA-33（R19）是 SA-32 的直接后续：R17 收敛时把 v1.0.0 遗留的边界表达式（`level group/block` 终止烘焙）原样固化进 helper，但该规则对 style 是错误的——显式 `f.red:group` / token 级 `f.red:block` 既不进 baseline 也不进 record，被吞。修复在 helper 内解耦 style vs 非 style 边界。教训：收敛散落判定 ≠ 背书判定正确——若被收敛的判定本身有 bug，五处一致地错更隐蔽。教训：回归测试要覆盖**语义的全部边 + 退化情形 + 全部操作路径 + 构建期 vs 运行期数据流 + 同一语义的多条构建路径**（R8-2 测同 timestamp 没测窗口内 → R8-3 漏网；R8-3 测单 reset 没测多 reset → R9-High 漏网；R8-3 删创建序没测 resetDuration=0 退化 → R10 漏网；R10 用 ordered 索引没测 >>> overlap → R11 漏网；R12 用 fake target 没测真实 KineticText → R12-block 漏网；replayStyles 只测"seek 到生效点之后"没测"seek 回退到生效点之前" → SA-28 漏网；replayStyles 只测 seekToTime 路径没测 playSegment-ended 路径 → SA-29 漏网；R15 §11 用 fake char 锁运行时契约但 fake 的 baseline 捕获是手写的、掩盖 DisplayAssembler 真实路径 → §11b 用真实 KineticChar 补构建期路径；R15 只修 DisplayAssembler 烘焙路径没修 SegmentBuilder applyGroupEffects 同步应用路径 → SA-31 漏网），且抽 helper 要核对所有调用路径的既有行为，删维度前要验证它在所有退化情形下都不需要，近似（ordered 索引）不能代替真实序（build sequence），cleanup 模型要覆盖同类下的所有副作用子类（filter / Graphics），**回归要用真实对象而非 fake 验证守卫条件/构建期数据流**（fake 满足语义掩盖真实代码不满足——§11+§11b 双层覆盖是 SA-27 教训的落地），凡是不在时间线上、靠 record 重放的资源，reset 阶段必须覆盖所有可能已被污染的目标，不能与 apply 共用时间过滤，所有"回到时间起点"的操作路径都必须调到该资源的 reset helper（ended 重播 / stop / 重 load 与 seekToTime(0) 最终态对齐），且**reset baseline 必须等于构建期烘焙态，构建期已应用的初始样式不进 record 重放集合**（否则相对样式 big/small 重复放大），且**"初始样式进 baseline"的语义要覆盖所有构建期写入路径**（DisplayAssembler 烘焙 + SegmentBuilder applyGroupEffects 同步应用），不只修一条。

**R8-R12 元方法论**：上述逐轮教训从第一性原理提炼为可复用预防框架，见 §G——"为什么会反复发病"（三个第一性原因：近似代替真实序 / 删维度漏退化 / 只测一侧）+ "反复发病的四个机制"（含实例与预防）+ "预防框架"（建模阶段 3 条 + 验证阶段 3 条检查清单）。§G 适用于所有时序/生命周期建模，不止 cam.reset，引入新特性前对照 §G 检查清单可避免重复付 R8-R12 的学费。

---

## E. 新增特效时的硬约束检查清单

新增一个 effect preset 时，逐条确认：

1. **modifier id = effectName**？`addModifier` 第一参数 = `defineEffect` 导出名。
2. **返回值契约**？char 级 return `Filter | Filter[]`；容器级 filter return `{filters, tickerFn}`；容器级位移 return `{tickerFn}`；容器级属性 return `{restoreProps}`；char 级 state tween return tween；纯 modifier 不 return。
3. **ticker 不写 timeline 属性**？若 ticker 写 `target.alpha`，改用 `restoreProps`。
4. **block 级特效路由**？`track:"behavior"` 进 `blockBehavior`；`track:"instant"` 进 `blockInstant`；`track:"entrance"` 进 `blockEntrance`。不落 `blockRemaining`（返回值被丢弃）。
5. **destroyFilterDeep 覆盖**？若 filter 有内部子 pass（如 BlurFilter 的 blurXFilter/blurYFilter），确认 `destroyFilterDeep` 能销毁它们。
6. **seek 幂等**？fn 重 apply 是否安全（instant filter 幂等 OK；entrance filter 不幂等 → 走 entranceFilters 非 instantEffects）。
7. **stage modifier 清理**？若用 `stageRuntime.addModifier`，确认 stop/clearScreen/seek/重播 路径能清到（靠 `clearModifiers` 统一清）。
8. **load 前清旧**？若新增 load 入口，确认先 `stop()`。
9. **三路径分流单一真相源**（INV-7）？若新增/修改可分流命令（modifierBased / clearBoundary / 可 seek tween），分流逻辑必须过 `buildStageModifierRecord`——禁止在 global / inline / token-chain 任一路径里新写 `if (modifierBased)` 或 `if (name === "...")` 特判。聚合 record 时 spread 全字段。
10. **外部依赖边界行为已验证**（INV-8）？若代码依赖 GSAP / Pixi 的边界行为（零时长 tween、`overwrite`、`destroy` 递归、filters 数组操作），先查 §B-bis "已验证外部依赖行为"清单；清单未覆盖的，必须用可复现脚本验证后再写进注释。优先选不依赖边界的 API。
11. **behavior-track 特效返回值契约**？若新增/修改 behavior-track 特效的 fn 返回新 shape（非 `Filter | Filter[] | BehaviorFilterResult | gsap.Tween | {restoreProps} | undefined`），必须同步更新 `PlaybackController.unpackBehaviorResult` 单一真相源——它是三调用点（SegmentBuilder block/group 路径、registerBehaviors）共用的解包 helper，漏改即静默丢 cleanup → seek/stop/clearScreen 资源泄漏（SA-16）。
12. **effect track/level 路由过单一 helper**（INV-7）？若新增特效或改 track/level 判定，必须经 `EffectProcessor.getTrack` / `classifyByTrack` / `isCharLevelEffect` 三 helper 之一，禁止在 SegmentBuilder block 桶或 TextPlayer/applyCharEffects/applyGroupEffects 里 inline 读 `meta.type`/`meta.track`/`meta.targetType`（SA-17/18）。
13. **style 边界对 style vs 非 style 解耦**（SA-33）？若改 `classifyStyleWrite` 的 `isBlocking` 边界，必须区分"style 身份"与"非 style 容器级特效边界"——style 经 `applyStyleRecursively` 落到每个 KineticChar，不受 `level==="group"/"block"` 终止烘焙（否则显式 `f.red:group` / token 级 `f.red:block` 既不进 baseline 也不进 record，被吞）。从既有代码提取/收敛 helper 时，区分"收敛散落逻辑"与"背书该逻辑正确性"——后者需从语义模型独立验证，不能继承 v1.0.0 表达式当不变量。
14. **收敛散落判定时独立验证被收敛逻辑的正确性**（SA-33）？（接第 13 条的执行细节）从既有代码提取单一真相源 helper 时，"收敛散落逻辑" ≠ "背书该逻辑正确"——若被收敛的判定本身有 bug，收敛只会让 bug 更隐蔽（五处一致地错）。R17 把 `classifyStyleWrite` 收敛时把 v1.0.0 遗留边界表达式（`level group/block` 终止烘焙）原样固化，但该规则对 style 错误。判别：style 身份与"非 style 容器级特效边界"必须解耦。回归须覆盖**每个 level 变体**（char/group/block × style/filter）+ pre-hold vs post-hold，不只测最常见的 char 级。
15. **边界判定的"游标载体"与"判定真值源"必须同源**（SA-35）？若某调用点用 helper（如 `classifyStyleWrite.isBlocking`）判边界，但**自己持有了一份承载 blocking config 的列表**（如 site3 先过滤 hold:char 得 activeEffects 再算 firstPostHoldIndex），这份列表与构建期的原始链顺序脱节 → 即使 helper 判定对了，列表丢了某 config（hold:char 被滤掉），边界仍错 → post-hold style 被当 pre-hold 跳过被吞。修单个 helper 不够，还要核对每个调用点"它喂给 helper 的 config 集合"是否完整、是否与构建期（P1）的原始链顺序一致。site3 修复：边界在原始 `visualConfigs`（含 hold:char）上算，activeEffects 携带 origIdx 标记原始位置。
16. **收敛一条 style 写入路径后，全局确认同语义的其他路径也走了新模型**（SA-36）？style 的 pre-hold/post-hold 模型修对一条路径（char / group / char-chain / token-block）后，必须 grep 所有"把 style 链交给构建/运行期处理"的调用点，确认它们都走了 pre/post-hold 拆分（而非旧的"整条同步应用"特例）。SA-36 漏的 paragraph block 链藏在 `applyGroupEffects(paragraphText, blockRemaining)` 同步路径里（不是独立 site，不像 site2/site3 那样显式），一直没被纳入新模型——`hold:block` 在 applyGroupEffects 内 await 导致墙钟副作用 + post-hold style 不进 record/不进 baseline。特征：若某路径的 style 处理经 `applyGroupEffects`（同步/异步）而非 `tl.call`+`styleRecords`，且链可能含 `hold`，就是 SA-36 同类隐患。

---

## F. 架构债务：R2-R6 审查暴露的系统性盲区（2026-06-29）

R2-R6 的 SA 序列反复在几个点打地鼠。逐条修是对的，但每个 SA 都在同一类架构缺口上长出来——说明模型本身的维度不够，未建模的边会持续冒出来。下列四条不是单点 bug，是**模型缺失**。登记在此作为后续重构方向，补齐前不应视为可收敛。

### F-1（High）：资源粒度建模缺"复合生命周期"维度

§A 把资源分 10 类，每类是"1 个 create + 1 个 cleanup + 1 个追踪位置"——1:1 映射。但 **stage modifier 是复合资源**：cam.shake 同时持有 modifier fn（`addModifier`）**和**衰减 tween（`onComplete → removeModifier`），两者互相引用、需独立 cleanup。R6-2 暴露 cleanup 只清 modifier Map、没清 tween，因为 §A 把它当单资源。同类历史债：`BlurFilter.destroy()` 不递归子 pass（→ `destroyFilterDeep`）；filters 数组不可 splice。

**缺口**：§A 没有"一个 create 产生多个需独立 cleanup 的子资源"的位置，INV-1 的 kill-before-clear 只管 timeline 内 tween，没覆盖 timeline 外的 modifier 衰减 tween。R6-2 的 `modifierTweens` Map 是补丁，不是建模。

**待补**：§A 加"复合资源"行（create 产 N 个子资源，cleanup 须覆盖全部子资源）；把 `StageRuntime.modifierTweens` 提升为一等追踪维度，覆盖矩阵加 modifier tween 行。

**补齐状态（2026-06-29）**：✅ §A 扩为 12 类（加 #11 stage modifier decay tween、#12 BlurFilter 子 pass），标注复合关系；§C 覆盖矩阵加 #11/#11 行并注明随 #9 clearModifiers 一并 kill。代码侧 R6-2 已实现 `StageRuntime.modifierTweens` + `clearModifiers`/`removeModifier` kill。维度补齐完成，后续按"复合资源须列全部子资源"建模新特效。

### F-2（High）：不变量矩阵只建模"操作 × 资源"，没建模"播放状态 × 操作"

§C 覆盖矩阵列是 build / play / seek / stop / clearScreen / load——**操作**。但 R4-R6 的 bug 几乎全是**状态转换**语义：seek-while-playing vs paused（R5-1、R6-1）、seek-to-mid vs seek-to-end（R6-1）、seek 落在精确边界点 vs 内（R5-2）、resume 后 static 转 live（R4-1）。矩阵能说"seek 时清 modifier"，但说不清"seek 到结尾且正在播放时该停 ended 还是 restart"。

**缺口**：播放状态（playing/paused/ended）是 seek/play 行为的决定因素，却不在不变量里。R5-1 的 `isAutoPlaying` gate、R4-1 的 `mode: "static"|"live"` 都是**把状态机塞进布尔参数**——修一个子态又漏下一个（R5-1 加 gate → R6-1 seek-to-end 又漏）。这是为什么"方向对但还能挑出 High"。

**待补**：把播放状态（playing/paused/ended）提升为 §C 矩阵的一维，seek/play 按状态分列；把散落各处的 `isAutoPlaying` gate 收敛成显式状态机，`replayStageModifiers` 的 mode 由状态机派生而非传参。

**补齐状态（2026-06-29，R7 后）**：✅ 补齐。§C 加 F-2 播放状态维度注释；代码侧抽 `PlaybackPhase`（playing/paused/ended）类型 + `PlaybackController.derivePhase(segment, state)` 单一真相源（公开，供 ScriptPlayer 共用），把散落的 `tl.progress()>=1` / `isAutoPlaying && progress<1` 判定收敛到此：
- `playSegment` 的重播分支改 `derivePhase(...) === "ended"`（不再散落 `tl.progress()>=1`）。
- `ScriptPlayer.seekToTime` 的 resume gate 改 `derivePhase(...) === "playing"`（不再散落 `isAutoPlaying && progress<1`）。
- `deriveReplayMode` 调 `derivePhase`（seek 路径 mode 据阶段派生，当前恒 static）。
`isAutoPlaying` 保留为"用户播放意图"布尔（不破坏外部消费者——editorStore/TimeLordBar/segmentTl.call guard 都读它）。已用 node 验证 5 种阶段组合（playing-mid/paused-mid/ended-onComplete/ended-seek-to-end/at-start）派生正确，resume gate 仅 playing 触发。状态语义集中，子态不再散落重算。

**R7 补强（2026-06-29，F-2 闭合后再次暴露）**：F-2 抽 `derivePhase` 时把它当**只读派生**——识别"现在 ended"，但 seek 到尾后没有路径把识别出的 ended **写回**（`isAutoPlaying` 仍 true、`onComplete` 不触发、`emit ended` 不发）。R6-1 只用 `derivePhase` 阻止 resume，漏了"识别出 ended 须 settle"。R7-1 加 `ScriptPlayer.settleEnded()`（设 `isAutoPlaying=false` + `pause` + `emit ended`，与 `segmentTl.onComplete` 自然播完路径对称），seek 落点 ended 时调它而非裸 return。教训：**状态机的"读"与"写"是两件事——`derivePhase` 回答"现在哪种状态"，`settleEnded` 回答"到达 ended 时怎么落地"，缺任一都会让识别出的状态变成幽灵态。** UI 侧 R7-2：TimeLordBar 的 scrub-resume 原本用捕获的 `wasPlaying` 意图，被 R7-1 settle 后须改用 seek 后的 `autoPlay` 镜像（seek 到尾 settle 为 false → 自然不 resume），否则 `playSegment()` 对 ended 的 restart 语义会从 0 重播。

### F-3（High）：时间线驱动与 record 重放是两套并行模型，缺共享 effective-time/value 来源

stage modifier 有两条真相来源：
- **正常播放**：timeline `tl.call` 触发，cam.reset 在 resetTl **末尾** clearModifiers（R4-2 boundary 错点），cam.shake 衰减由 timeline 内 tween 驱动（power2.out，R3-4），strength/duration 经 `StageRuntime.apply` 解析 `var.*`（R4-3/R5-3）
- **seek 重放**：`StageModifierRecord` 驱动，boundary 取 timePosition（R4-2 错）、strength 用 `Number()` 不解析（R5-3 错）、duration 用 `Number()` 不解析（R4-3 错）、衰减用 `^2` 公式而 timeline 用 `power2.out` `^3`（R3-4 错）

两套模型**必须逐字段对齐**，否则 seek 到的点与正常播放到的点视觉不一致。R3-4/R4-2/R4-3/R5-3 全是"record 说 A、timeline 说 B"。架构上没有"单一 effective-time/effective-value 来源"——build 期产 record、运行期产 tween，各算各的，靠注释承诺一致。与 INV-7（三路径分流）同构，只是这次是"两个时间模型"而非"三个路径"。

**缺口**：record 是 replay 的真相，但它的字段是从未解析的 params 重算的，与 timeline 执行不同源；cam.reset 跨两边（tween + 末尾副作用），boundary 时间点两套各取各的。

**待补**：record 在 build 期从**已解析的值**生成（duration/strength 经 `resolveStageNumeric`、boundary time = `timePosition + resetDuration`、衰减曲线名从 preset 的 ease 读），replay 只读 record 不重算。两套模型共享同一真相，不需要"注释承诺一致"。

**补齐状态（2026-06-29）**：✅ 补齐。`StageModifierRecord` 加 `baseStrength` + `easeName` 字段（build 期由 `buildStageModifierRecord` 填，经 `resolveStageNumeric` 解析变量、ease 名从 `CAM_SHAKE_EASE` 常量读）；`replayStageModifiers` 优先读 record，未携时回退到 `resolveStageNumeric`/`CAM_SHAKE_EASE`（兼容旧 record）。duration（R4-3）、resetDuration（R4-2）此前已在 build 期解析。两套模型现在共享同一真相源，replay 不重算。已用 node 验证 build 期解析一次、replay 纯读不重算。

### F-4（Medium）：INV-7/INV-8 是事后归纳的约定，无强制机制

INV-7（三路径分流单一真相源）和 INV-8（外部依赖边界行为须验证）是 R2 后写成的不变量，但**仍是人肉 checklist**：
- INV-7 是约定（"必须过 helper"），没有 lint/类型层守卫。SA-16/17/18 修了既有的，但下一个新增可分流命令仍可能再分裂——没有编译期拦截。
- INV-8 是事后补的验证库（§B-bis），但代码里没有"注释声称边界行为 → 必须有 §B-bis 引用或验证脚本"的闸门。R3-4 的 `^2` 公式、R6-2 的 kill-onComplete 都是又踩同型坑才补进库的。

**缺口**：§E 清单（新增特效检查）试图把合约前置，但它仍依赖审查者逐条过，不是类型/编译期约束。元缺陷：INV-1..8 全是 bug 之后写的，代码的覆盖面永远跑在合约前面，未建模的边持续冒出来，直到维度补齐。

**待补**：给 INV-7 加 lint 级守卫（分流逻辑必须过已注册 helper，禁止 inline `if (meta.track==="instant")`）；给 INV-8 加闸门（边界行为注释必须引 §B-bis 或附验证脚本路径）。理想态是这些从人肉 checklist 升级为类型/编译期约束，但至少先有可执行的检查脚本。

**补齐状态（2026-06-29，方向 A 后）**：✅ 可执行守卫已建。`pnpm test:invariants`（`src/test-invariants.ts`）扫描 `core/`：INV-7 检 stage-modifier/effect 分流 inline 特判（regex 匹配 `if (...meta.modifierBased)` / `if (meta.type==="filter" && meta.track==="instant")`）；INV-8 检声称 GSAP/Pixi 边界行为的注释是否引 §B-bis/已验证。已跑通——修了 13 处遗漏的 §B-bis 引用（BloomFilter/GrayFilter/colorUtils/PlaybackController/ScriptPlayer/StageRuntime/stagePresets/TextPlayer/KineticChar）。豁免机制：`INV-7-allow`/`INV-8-allow` 行内标注。非编译期约束，但已是 CI-可执行闸门，下一步可挂进 pre-commit/CI。

**方向 A 扩展（SA-23）**：F-4 的强制机制从**静态文本扫描**（test:invariants）扩展到**运行时行为回归**（`pnpm test:playback`，22 case 锁定 derivePhase/seekToTime/playSegment 的 seek/phase/resume 语义）。原 INV-8 守卫只管"注释声称的边界行为是否引用 §B-bis"，管不到"运行时状态语义是否被破坏"——SA-23 的回归测试补上这个维度，R3-R7 的状态 bug 现在有了持久化的回归防线。pixi v8 headless 可测（§B-bis 已验证）消除了"pixi 阻塞 headless"的旧误判，是建立运行时回归的前提。

### 收敛判断

F-1/F-2/F-3 是 R2-R6 反复发病的**模型维度缺口**，F-4 是**强制机制缺失**。**当前状态：F-1（✅）、F-2（✅，R7-1/R7-2 闭合 settle 缺口，SA-22 闭合消费侧信号降级缺口）、F-3（✅）维度全部补齐，F-4（✅）可执行守卫已建（SA-23 扩展到运行时回归）——四条全部收敛。**

- F-1（✅）：§A 扩为 12 类（加复合资源子项），§C 矩阵加 #11/#12 行；代码 R6-2 已实现 `modifierTweens` 随 clearModifiers kill。
- F-2（✅）：`PlaybackPhase`（playing/paused/ended）+ `derivePhase` 单一真相源，散落的 `progress>=1`/`isAutoPlaying && progress<1` 判定全部收敛；`isAutoPlaying` 保留为意图布尔（兼容）。
- F-3（✅）：`StageModifierRecord` 携 build 期已解析的 `baseStrength`/`easeName`/`duration`/`resetDuration`，replay 纯读不重算，两模型共享真相。
- F-4（✅）：`pnpm test:invariants` 守卫（INV-7 分流 inline 特判 + INV-8 边界行为注释须引 §B-bis），CI-可执行，已修 13 处遗漏引用。

预期：R2-R6 反复在 stage modifier 生命周期上打地鼠的三类根因（复合资源、状态转换、两模型对齐）均已建模型，后续同类 bug 应停止增长。F-4 守卫防止未来回归（新分流 inline / 新边界行为裸声称会被 CI 拦）。本节标记为全部收敛。

下一步（非阻塞，可选优化）：F-4 守卫挂进 pre-commit/CI；§B-bis premultiplied alpha 待浏览器渲染验证；`isAutoPlaying` 若未来要从布尔升级为显式状态机，F-2 的 `derivePhase` 是过渡基础。

---

## G. 审查-修复循环的元方法论（R8-R12 提炼，2026-06-30；R12-block 补 2026-06-29；R13 补 2026-06-30）

> §F 记 R2-R6 的架构维度缺口（已闭合）。本节记 R8-R13 审查-修复循环暴露的**元模式**——不是单个 bug，而是"为什么同一类问题反复发病、为什么每轮都从另一侧漏、如何预防"的方法论。SA-24..28 是单点记录，本节是从第一性原理提炼的可复用预防框架。适用于所有时序/生命周期建模，不止 cam.reset。

### G.1 为什么会反复发病：三个第一性原因

R8-R12 的七轮（R8-1/R8-2/R8-3/R9-High/R10/R11/R12/R12-block）不是七个独立 bug，是同一类建模错误在七个形态上的表现。根因不在任何一轮，而在三个第一性机制：

**1. 用近似代替真实序，回避显式建模**
R8-R11 的核心病灶。`timePosition` 是连续时间标量，但 clear-all 的"创建序"是离散的 build/push 顺序——两者是不同维度。R8-R10 一直用 ordered 索引（排序后的位置）近似"创建序"，但 ordered 索引只在同 timePosition 时等于 push 顺序（stable sort 的副产品），不同 timePosition 时被排序打乱。>>> overlap（R11）就暴露这点：drift@2（push 序 0）+ reset@1（push 序 1），排序后 reset 在前，ordered 索引表达不了 drift 先于 reset 创建。

Coco 从 R8-2 起就建议"加稳定 sequence 字段"，我回避了五轮——理由是"ordered 索引够用 / 加字段改动大"。但回避显式建模的代价是五轮反复，每轮堵一个形态又从另一个形态漏。**第一性原理：当一个量被反复需要、但用近似表达时，近似迟早会在某个退化情形失效——回避显式建模不是省事，是推迟代价并放大它。**

**2. 删维度前只验证正常情形，不验证退化情形**
R8-3 删创建序维度（以为 clear-all 不需要），理由是"resetDuration>0 时时间维度 `timePosition < effectiveTime` 已覆盖"。但 resetDuration=0 是时间维度失效的退化情形（`effectiveTime === timePosition`，`1<1` false）——R10 就从这个退化漏了。删维度时的验证只看了正常情形（resetDuration>0），没看退化（=0）。

**第一性原理：任何判定条件都有失效的退化情形（边界值、零值、空值、退化）。删一个维度前，必须验证它在所有退化情形下都不需要，不能只看正常情形。退化情形正是 bug 藏的地方。**

**3. 回归测试只测复现的那一侧，不测语义的全部边**
R8-2 测了"同 timestamp"没测"窗口内" → R8-3 漏网。R8-3 测了"单 reset"没测"多 reset" → R9-High 漏网。R8-3 删创建序没测"resetDuration=0 退化" → R10 漏网。R10 用 ordered 索引没测">>> overlap" → R11 漏网。R12 用 fake target（带 getGraphicsLayer）测 cleanup 通道，没测真实 KineticText（无 getGraphicsLayer）→ R12-block 漏网：守卫 `typeof target.getGraphicsLayer === "function"` 对 fake 为 true、对真实 KineticText 为 false，R12 修复对 block 级静默失效。每轮的回归测试只覆盖当轮复现的那一个形态，下一个形态从另一侧漏。

**第一性原理：一个语义有多个"边"（正常/窗口/同 timestamp/多实例/零值/overlap/fake-vs-real）。只测复现的那一侧等于只验了一个边，其余边是空的——下一轮的 bug 必从空边来。fake 满足守卫不等于真实 target 满足守卫，回归必须用真实对象跑一遍。回归测试要覆盖语义的全部边，不只复现点。**

### G.2 反复发病的八个机制（R8-R16 实例）

| 机制 | 实例 | 第一性原理 | 预防 |
|---|---|---|---|
| **近似代替真实序** | R8-R11：ordered 索引近似 build 序，>>> overlap 失效 | 连续标量表达不了离散序；近似在退化情形失效 | 被反复需要的量要显式建模，不用近似（R11 加 `sequence` 字段） |
| **删维度漏退化** | R8-3 删创建序漏 resetDuration=0；R8-3 删创建序漏窗口内 | 判定条件有失效的退化情形；删维度要验证全部退化 | 删维度前列出所有退化情形逐一验证 |
| **只测一侧** | R8-2 测同 timestamp 没测窗口内；R10 测单 reset 没测 overlap；R12 测 fake target 没测真实 KineticText；R13 旧测只测"seek 到生效点之后"没测"seek 回退到生效点之前"；R14 旧测只测 seekToTime 路径没测 playSegment-ended 重播路径；R15 §11 用 fake char 锁运行时契约但 fake 的 baseline 捕获是手写的、掩盖 DisplayAssembler 真实路径 → §11b 用真实 KineticChar 补 | 语义有多边，只测一边其余是空的；fake 满足守卫/语义掩盖真实 target/代码不满足；seek 是双向的，只测推进方向漏回退方向；同一资源有多条操作路径，只测一条漏其余；构建期数据流与运行时契约是两层，fake 锁运行时契约不等于真实代码锁构建期路径 | 回归测试覆盖语义全部边（正常+窗口+同 timestamp+多实例+零值+overlap+seek 双向+全部操作路径），且用真实对象验证守卫条件/构建期数据流——必要时 stub 环境（如 gsap.ticker）让真实对象可构造 |
| **多路径清理/烘焙责任散落** | R14（SA-29）：style 资源有四条清理路径（seekToTime / playSegment-ended / stop / clearScreen），R13 只修了 seekToTime，ended 分支自己手写了一份"漏了 style 的清理"——抽了 reset helper 却没审计所有 apply 路径是否都调到它；R16（SA-31）：pre-hold 初始样式有两条构建期写入路径——DisplayAssembler 烘焙（R15 修进 baseline）+ SegmentBuilder applyGroupEffects 同步应用（R16 修前不进 baseline），R15 只修一条漏另一条 | 同一种 record-driven 资源的清理/烘焙责任散落在多条操作路径/构建路径上，每条独立实现就漏一条；这是 INV-7 的隐形态（不是"判定散落"而是"责任散落、无单一真相"——既可能是清理责任，也可能是 baseline 烘焙责任） | 抽 reset helper / 建 baseline 语义后，审计所有"apply/重置/写入该资源"的操作路径**与构建路径**是否都调到它/纳入它；凡"回到时间起点"的操作（ended 重播 / stop / 重 load）必须与 seekToTime(0) 最终态对齐；凡构建期写入初始样式的路径（DisplayAssembler 烘焙 / applyGroupEffects 同步应用）都必须进 baseline |
| **同类子类只建一类** | R12：instant track 下 filter / Graphics 两子类，只建 filter cleanup | 同类下可能有多种副作用子类，cleanup 语义各不同 | 建 cleanup/通道时枚举同类下的所有副作用子类 |
| **fake 掩盖真实守卫不满足** | R12-block：fake target 带 getGraphicsLayer 满足守卫，真实 KineticText 无 getGraphicsLayer 不满足 → R12 对 block 级静默失效；R15 §11 fake char 的 baseline 捕获手写正确、掩盖 DisplayAssembler 真实覆盖 bug → §11b 真实 KineticChar 补 | 守卫条件的真值依赖真实 target 的能力/真实代码路径，fake 替身可能满足真实不满足 | 回归守卫/能力检查/构建期数据流类逻辑时用真实 target/真实代码，不只 fake；核对「真实对象是否真有守卫要求的方法」与「真实代码路径是否真做了该做的事」 |
| **两个语义维度共用一个过滤** | R13（SA-28）：`replayStyles` 的 reset 窗口与 apply 窗口共用 `timePosition <= currentTime` → seek 回退到生效点之前时两者同时落空 → 不 reset、样式残留 | 「清理窗口」（哪些目标可能已被污染）与「生效窗口」（哪些副作用在当前时间生效）是独立维度；seek 可回退意味着"已生效"≠"当前时间生效"；不在时间线上、靠 record 重放的资源不会随 seek 回退自动消失 | 凡是 record 驱动重放的资源（style 快照 / behavior modifier / instant filter / Graphics 层），reset 阶段必须覆盖所有可能已被污染的目标，不能与 apply 共用时间过滤——reset 用"是否曾在 record 中出现"，apply 用"当前时间是否生效" |
| **baseline 与 record 职责重叠 + 语义身份多位置不一致** | R15（SA-30）：pre-hold 样式构建期已烘焙进字符 style（= 初始态），却同时在 site 1 注册成 record、site 3 `tl.call` 重上（= 动态变更），且 baseline 回原始 base（= 不存在）——三处对同一种样式的语义身份矛盾；叠加 big/small 相对样式在 record/tl.call 重放时重复放大 | 构建期烘焙的初始样式是"起始状态"（进 baseline），不是"运行时变更"（不进 record/不 tl.call）；baseline、record、tl.call 三者对同一资源的语义身份必须一致——要么是初始态（进 baseline，不重放），要么是动态变更（不进 baseline，进 record/tl.call），不能既是又非 | 凡构建期烘焙进字符的样式，reset baseline 必须等于烘焙态（不是原始 base），且不进 record 重放集合、不 tl.call 重上；判别：资源是构建期初始态（进 baseline）还是运行时动态变更（进 record）——二选一，不让同一资源在多处既是初始态又是变更 |

### G.3 预防框架（引入新时序/生命周期特性时的检查清单）

**建模阶段**：
1. **被反复需要的量，显式建模**——不要用近似（ordered 索引、时间标量近似离散序）。问"这个量会在不同情形下被需要吗？"——是则建字段/类型，不靠副产品（stable sort 顺序、排序位置）。
2. **枚举同类下的所有副作用子类**——`track:"instant"` 不只一种（filter / Graphics），`isClearBoundary` 不只一种 clear 语义（clear-all / clear-before）。建通道/模型前先枚举子类，每子类独立 cleanup/判定。
3. **判别 clear-all vs clear-before**——读 preset 实现：clear 调 `clearModifiers()`（全清）还是 `removeModifier(name)`（指定）。clear-all 用时间 + 创建序双维度，不要默认 clear-before。

**验证阶段**：
4. **删维度前列出所有退化情形**——resetDuration=0、空数组、同 timestamp、零值、overlap。逐一验证该维度在每个退化下都不需要，不能只看正常情形。
5. **回归测试覆盖语义全部边**——不只测复现点。每个语义枚举：正常 / 窗口内 / 同 timestamp / 多实例 / 零值退化 / overlap。加 case 到 `final-playback-test.ts`，不用一次性探针。
6. **验证"近似不能代替真实"**——若用近似（如 ordered 索引），加一个 case 验证近似在退化情形下错误（R11 的"无 sequence 时 ordered 索引复活 drift"case 即此）。
7. **守卫/能力检查类逻辑用真实 target 验证**——fake 替身可能满足守卫而真实 target 不满足（R12-block：fake 带 getGraphicsLayer，真实 KineticText 无）。回归此类逻辑时构造真实 target 跑一遍，不只 fake。问"守卫要求的方法，真实 target 真有吗？"——查代码确认，不靠 fake 推断。
8. **seek 双向 + 语义维度解耦（R13/SA-28）**——seek 是双向的（可回退），回归必须既测"seek 推进到生效点之后"也测"seek 回退到生效点之前"，不能只测推进方向。凡是 record 驱动重放的资源（不在 timeline 上、靠快照/注册），问两个问题：(a)「清理窗口」与「生效窗口」是否被同一过滤耦合？若是，解耦——reset 覆盖所有曾在 record 中出现的目标，apply 按当前时间生效。(b) 资源会不会随 seek 回退自动消失？若是（entrance tween 在 timeline 上）则靠 seek 插值；若否（style 快照 / modifier / filter / Graphics）则必须靠 reset 显式清。
9. **多路径清理审计（R14/SA-29）**——抽了 reset helper（如 replayStyles）后，审计所有"apply 或重置该资源"的操作路径是否都调到了它。record-driven 资源的清理责任容易散落在多条操作路径（seekToTime / playSegment-ended / stop / clearScreen），每条独立手写就漏一条。特别地：凡"回到时间起点"的操作（ended 重播 / stop / 重 load）必须与 `seekToTime(0)` 的最终态对齐——回归要为每条这样的路径单独加 case（不只是 seekToTime 一条）。
10. **baseline = 构建期烘焙态 + 初始样式不进 record（R15/SA-30）**——凡构建期烘焙进字符的初始样式，reset baseline 必须等于烘焙态（不是原始 base），且不进 record 重放集合、不 tl.call 重上。判别：资源是构建期初始态（进 baseline，不重放）还是运行时动态变更（不进 baseline，进 record/tl.call）——二选一，不让同一资源在多处既是初始态又是变更。问两个问题：(a) baseline 快照是否在构建期烘焙之后捕获？（b) 构建期已烘焙的样式是否还出现在 record/tl.call 里？两者都是"是"则重复应用风险（相对样式 big/small 重复放大）。
11. **构建期数据流用真实代码路径验证（R15/SA-30，接 SA-27）**——测构建期数据流（如 DisplayAssembler 的 baseline 捕获）时，fake char 的行为契约是手写的，会掩盖真实代码路径差异（fake baseline 捕获正确 ≠ DisplayAssembler 真实捕获正确）。必须用真实对象/真实代码直接跑被测路径——若真实对象因环境依赖（如 gsap.ticker）不可直接构造，stub 环境（`gsap.ticker = {add, remove} no-op`）让真实对象可构造，而非退回 fake。"fake 锁运行时契约 + 真实锁构建期路径"双层覆盖是 SA-27 教训的落地形态。
12. **同一语义的多条构建路径审计（R16/SA-31，接 SA-29/SA-30）**——"初始样式进 baseline"是一条语义，但它散落在多条构建期写入路径：DisplayAssembler 烘焙（`LayoutPlanner.applyInitialStylesToStyle` → `glyphPlan.style` → 构造捕获）+ SegmentBuilder applyGroupEffects 同步应用（构造后 `applyStyleRecursively` force=true）。修一条不等于修全部——R15 修了前者漏后者（SA-31）。凡是为某资源建立"进 baseline / 进 record / 进 cleanup"语义，审计所有**构建期写入路径**（不止运行期操作路径）是否都纳入该语义。问："该资源有几条构建期写入路径？每条是否都进 baseline（若是初始态）或进 record（若是动态变更）？"

### G.4 元教训

R8-R12 六轮（含 R12-block 七轮、R13 八轮、R14 九轮、R15 十轮、R16 十一轮）的最大教训不是任何一个具体 bug，而是**回避显式建模的代价是指数级的**：R8-2 该加 sequence 字段时回避，代价是 R8-3/R10/R11 三轮反复——每轮都在为回避付利息。若 R8-2 就落地 sequence，R10/R11 不会发生。R12-block 是另一面的同源债：建了 cleanup 通道（显式建模对了），但回归用 fake target 跑——fake 满足守卫掩盖了真实 KineticText 不满足，使"已修"的结论在 block 级落空。R13（SA-28）是第三种形态：`replayStyles` 把两个独立语义维度（清理窗口 / 生效窗口）共用一个时间过滤耦合在一起——SA-24 的 reset boundary 反而没踩这个坑（它的 boundary 本就是 clear-all 语义，天然解耦），但 `replayStyles` 把 reset 写成"逐 char 按 record 时间判定"而非"clear-all 后重放"，漏看了 seek 回退时清理窗口需要比生效窗口更宽。R14（SA-29）是第四种形态、R13 的同源延续：修了 `replayStyles` 内部的窗口耦合，但同一种 style 资源还有 ended 重播这第二条清理路径没调到它——抽了 helper 却没审计所有操作路径是否复用，清理责任散落、无单一真相（INV-7 隐形态）。R15（SA-30）是第五种形态、前两轮的基底假设崩塌：R13/R14 都假设"reset 的 baseline 是正确的"，但 baseline 一直是原始 base 而非构建期烘焙态——pre-hold 样式在构建期说"初始态"、record 说"动态变更"、baseline 说"不存在"，三处语义身份矛盾；叠加 big/small 相对样式重复放大。R16（SA-31）是第六种形态、R15 的同源延续：R15 只修了 pre-hold 初始样式的**第一条**构建写入路径（DisplayAssembler 烘焙），漏了第二条（SegmentBuilder applyGroupEffects 同步应用）——"初始样式进 baseline"的语义散落在多条构建路径上，修一条不等于修全部。六回合教训串起来：**显式建模（建字段）+ 用真实对象验证 + 语义维度显式解耦（不共用过滤）+ 多路径清理审计（helper 抽出后核对所有运行期路径复用）+ baseline 与 record 职责不重叠（初始态 vs 动态变更二选一）+ 多构建路径审计（同一语义的所有构建期写入路径都纳入）**——任一缺失都会让"已修"的结论在某个边、某条路径、或某条构建路径落空。

这对应 §F-4 的理念（强制机制），但比 INV-7/INV-8 守卫更深一层：守卫防"分裂/未验证"，但防不了"用近似代替真实"——后者是建模决策，不是代码模式。唯一的预防是在建模阶段就认"被反复需要的量要显式建模"，而不是等审查五轮后被迫落地。

**给未来引入时序指令链/生命周期特性的人**：读 §G 三个第一性原因，对照检查清单 12 条。R8-R16 的学费已付，不必再付。