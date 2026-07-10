# Effect Preset 与插件贡献契约草案

> 状态：Draft，尚未实现 plugin loader，也不是稳定公开 API。
> 目标：在开放第三方 effect 之前，先固定贡献数据、surface capability、参数所有权和资源生命周期的边界。

## 背景与范围

内建 effect 已支持 `EffectDefinition.profiles`，但当前注册表仍由 editor runtime 构造时直接加载 presets。`core/filters` 的 effect-first 目录只改善内建实现可维护性，不应成为插件作者必须复制的结构。真正的生态边界必须是可验证、可查询、尽量不暴露 editor 私有对象的 contribution contract。

本草案覆盖 effect/preset 注册、metadata 与执行结果。它不实现包发现、下载、沙箱、签名、热更新、插件市场、语法糖注册或通用 runtime hook。

## 候选贡献模型

```ts
interface EffectContribution {
  name: string;
  definition: EffectDefinition;
  capabilities: {
    surfaces: Partial<Record<EffectSurface, SurfaceCapability>>;
  };
  params?: EffectParameterSchema;
  diagnostics?: {
    profileId?: Partial<Record<EffectSurface, string>>;
  };
}

interface SurfaceCapability {
  status: "supported" | "unsupported";
  reason?: string;
}
```

这里的 `EffectDefinition` 是当前模型的演进起点，不承诺直接作为最终公开类型。开放前需要消除 `any` 返回值，并把 profile、metadata、参数 schema 与 cleanup result 变成可静态验证的结构。

## Surface capability 与不支持语义

- 作者效果名代表稳定视觉语义；surface profile 是内部实现选择，不衍生 `textDuotone` 之类公开命令名。
- contribution 必须显式声明支持的 surface。未声明或标记 `unsupported` 时，runtime 应产生结构化诊断并跳过，不应静默回退到可能使用错误信号模型的默认 fn。
- `text`、`background` 是当前能力；`frame` 只有挂载点与生命周期契约稳定后才能加入，不通过扩张 `CommandLevel` 偷渡。
- capability 描述能否正确运行；目录位置不参与能力判断。

当前 `EffectManager` 仍使用 `profiles[surface] ?? fn` fallback。迁移到开放插件前，必须先引入显式 capability 检查，并为旧内建 preset 提供兼容适配。

## 参数 schema 与默认值所有权

参数 schema 至少需要表达类型、必填性、默认值、范围、枚举、单位和面向工具的说明。默认值只能有一个权威来源：建议由 schema 或独立 resolver 拥有，profile 实现消费已解析参数，不能各自在自然播放、seek replay、Inspector 中重新提供不同 fallback。

同一效果的 profile 可以有不同参数解释或默认值，但差异必须在 surface schema 中显式声明。LSP、Inspector、reader runtime 与测试应消费同一份 metadata，避免手写镜像表漂移。

## 组合、互斥与叠加

- `mutexGroup`、`stackable` 继续属于效果语义 metadata，不由 shader 类或目录推断。
- 组合 preset（如 `underwater`）必须复用已注册 profile 或共享构造器，不复制 shader。
- 组合的资源返回值必须完整列出子 filter/ticker/tween，cleanup 不能只覆盖外层 preset。
- 冲突、覆盖和插件 override 策略必须由未来 plugin manager 统一决定；单个 contribution 不得直接篡改另一个插件的 registry entry。

## 生命周期与 cleanup 契约

公开契约应使用判别联合替代当前宽泛返回值，至少区分：

- instant：挂载的 filter 列表与销毁责任；
- behavior：filter、ticker、modifier、tween、属性恢复句柄；
- entrance：timeline-owned tween 与持久 filter；
- composite：所有子资源及其 cleanup 顺序。

runtime 拥有调度与最终 cleanup；插件实现拥有资源创建，并必须通过结果对象把所有资源交给 runtime。插件不得启动无法取消的全局 ticker、timer 或 tween。自然播放、seek/replay、stop、clear、source reload 都必须走同一参数和资源所有权模型。

## 工具链与 reader 消费

贡献 metadata 应可序列化或可投影成序列化 manifest，供以下消费者使用：

- LSP/Monaco：补全、参数提示、surface 不支持诊断；
- Inspector：按 schema 生成控件并安全改写源码；
- reader runtime：只加载运行所需的实现与 metadata，不依赖 editor UI；
- 测试与文档生成：枚举效果、surface 支持矩阵、默认值和 profile 诊断标识。

运行函数和 Pixi/GSAP 对象不能进入 manifest；工具链消费的是稳定 metadata 投影。

## 禁止依赖的内部边界

第三方 effect 不得直接依赖 `TextPlayer`、`SegmentBuilder`、`PlaybackController`、editor Pinia store、Vue component 或 `StageManager` singleton。它们属于调度或宿主内部，直接依赖会让插件绕过 seek、cleanup 和 reader/editor 包边界。

若 effect 需要背景、时钟、资源加载或诊断，应由受限的 `EffectRuntimeContext` 提供能力接口；context 的具体形状需在 package extraction 与多实例 runtime 稳定后另行决策。

## Core plugin 迁移门槛

只有满足以下条件，内建 presets 才从构造函数硬编码注册迁移为 core plugin：

1. contribution schema 与冲突策略有回归覆盖；
2. effect result/cleanup 不再依赖 `any` 或 manager 私有知识；
3. editor 与 reader runtime 能从同一入口安装 core contributions；
4. 多 runtime 实例不共享可变 singleton 状态；
5. LSP/Inspector 可消费 metadata 投影而不加载 Pixi shader；
6. 现有 build、playback、invariants、shader 与 browser e2e 门禁覆盖迁移前后等价性。

在这些门槛之前，保持内建 preset 注册方式，不为了“看起来插件化”增加 loader 包装层。

## 后续决策点

- `EffectContribution` 与通用 `KMDPlugin` 的关系：子贡献还是独立 registry API。
- surface capability 的版本协商与 fallback policy。
- 参数 schema 的格式：仓库自有类型、JSON Schema 子集或其他可序列化方案。
- plugin package 的权限、隔离、资源 URL 与 CSP 模型。
- effect runtime context 的最小能力面，以及 editor/reader 是否共享同一实现。

这些问题解决前，本文件只作为规划约束，不授权实现 plugin loader。
