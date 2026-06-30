import gsap from "gsap";
import { Container } from "pixi.js";

/**
 * 容器级 behavior offset 叠加机制，与 `KineticChar.modifiers` 对称。
 *
 * 背景：char 级 behavior（shake/wave/pulse…）用 `addModifier` 返回 `{x,y,…}`，
 * `KineticChar.syncProperties` 每帧把它叠加到布局位置（`x = layoutX + sum(modifier.x)`），
 * `removeModifier` 后下一帧自动归零——这是"可清零 offset"语义。
 *
 * 容器级（`TokenWrapper`/`KineticText`）原本没有这套机制，`shake:group`/`:block` 只能
 * 直接 tween `target.pivot`。但 `pivot` 是布局中心值（`TokenWrapper` 构造时设为几何中心，
 * `KineticText` 的 position 由段落定位写入），不是临时 offset——tween 污染它后 `kill()`
 * 不恢复，seek/stop/clearScreen 后 wrapper 永久错位。
 *
 * 本机制给任意 `Container` 提供与 char 级同构的 offset 叠加：
 * - `addOffset(id, fn)`：注册逐帧 fn（返回 `{x?, y?}`），首次注册时快照当前
 *   `position` 为 base，启动 ticker 每帧 `position = base + sum(offsets)`。
 * - `removeOffset(id)`：移除 fn；offsets 清空时恢复 `position = base`
 *   并停止 ticker（惰性）。
 *
 * **仅支持 position offset（x/y），不支持 alpha**：alpha 与 timeline 驱动
 * （如 blurIn 的 alpha 动画）写入同一属性会冲突——ticker 每帧覆盖 timeline
 * 的 alpha 动画。容器级 alpha 行为（dim）用 `restoreProps` 机制（记录原始值，
 * cleanup 恢复），不在此 ticker 叠加。
 * - `destroy()`：清空全部 offset、恢复 base、移除 ticker（`clearBehaviors` 路径用不到，
 *   因为 cleanup 是 per-EffectId removeOffset；保留供容器自身 destroy 兜底）。
 *
 * 用 WeakMap 绑定实例，不污染 `TokenWrapper`/`KineticText` 类定义。ticker 暴露为
 * `tickerFn` 返回给 fn，纳入 `BehaviorFilterResult` 风格的 cleanup 契约（`gsap.ticker.remove`）。
 *
 * 与 char 级 modifier 的差异：char 级 modifier 写进 `KineticChar.modifiers` Map 由
 * `KineticChar.update` 统一驱动（一个 ticker 服务所有 char modifier）；容器级每个绑定
 * 的 offset 独占一个 ticker（容器数量远少于 char，开销可接受，且避免容器类引入 update 钩子）。
 */

type OffsetFn = (time: number) => { x?: number; y?: number };

interface OffsetBinding {
  base: { x: number; y: number };
  offsets: Map<string, OffsetFn>;
  tickerFn: () => void;
  active: boolean;
}

const bindings = new WeakMap<Container, OffsetBinding>();

function ensureBinding(target: Container): OffsetBinding {
  let binding = bindings.get(target);
  if (!binding) {
    const base = { x: target.x, y: target.y };
    const offsets = new Map<string, OffsetFn>();
    const tickerFn = () => {
      let ox = 0;
      let oy = 0;
      const time = gsap.ticker.time * 1000;
      for (const fn of offsets.values()) {
        const o = fn(time);
        if (o.x !== undefined) ox += o.x;
        if (o.y !== undefined) oy += o.y;
      }
      target.x = base.x + ox;
      target.y = base.y + oy;
    };
    binding = { base, offsets, tickerFn, active: false };
    bindings.set(target, binding);
  }
  return binding;
}

/**
 * 给容器注册一个逐帧 offset。返回该绑定的 ticker fn，供调用方纳入
 * `BehaviorFilterResult.tickerFn` cleanup 契约（`gsap.ticker.remove`）。
 *
 * 首次注册时快照当前 `position` 为 base，启动 ticker；后续 add 复用同一 ticker。
 * `id` 应等于 effectName（与 `KineticChar.addModifier` 的 id 对齐约定一致）。
 */
export function addContainerOffset(target: Container, id: string, fn: OffsetFn): () => void {
  const binding = ensureBinding(target);
  binding.offsets.set(id, fn);
  if (!binding.active) {
    gsap.ticker.add(binding.tickerFn);
    binding.active = true;
  }
  return binding.tickerFn;
}

/**
 * 移除一个 offset。offsets 清空时恢复 `position = base` 并停止 ticker（惰性释放）。
 * `clearBehaviors` 的 per-EffectId cleanup 调此；若同容器还有其他 offset 在跑，
 * position 仍由剩余 offset 驱动，不会误恢复。
 */
export function removeContainerOffset(target: Container, id: string): void {
  const binding = bindings.get(target);
  if (!binding) return;
  binding.offsets.delete(id);
  if (binding.offsets.size === 0 && binding.active) {
    gsap.ticker.remove(binding.tickerFn);
    target.x = binding.base.x;
    target.y = binding.base.y;
    binding.active = false;
    // R6-3：清空 offsets 后删除 WeakMap 记录——下次 addOffset 会重新 capture base。
    // 原逻辑只停 ticker + 恢复 base，但保留 binding（base 不刷新）。若容器在 inactive 期间移动了
    // （如 layout 重排 / seek 后 position 变化），下次 addOffset 复用过时 base → offset 叠加到错误
    // 基准。M2 生命周期基础设施须在重新激活时刷新 base。删除记录后 ensureBinding 会重建并重新快照。
    bindings.delete(target);
  }
}

// 注：原 destroyContainerOffset 已删除（死代码——从未调用）。container offset 清理完全靠
// clearBehaviors 的 per-effectId removeContainerOffset。若需容器 destroy 兜底，
// 未来可在 KineticText.rebuild / destroy 路径补充，但当前 rebuild 是 build 期且 cleanups 为空。