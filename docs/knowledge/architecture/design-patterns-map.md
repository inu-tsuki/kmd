# KMD 设计模式地图（House Style）

> 最近更新：2026-07-07
> 来源：2026-07 架构体检（见 `docs/planning/architecture-health-check-2026-07.md`）。
> 用途：长期事实。回答"各模块采用什么设计模式、为什么"，并定义本仓库的一致性判据（house style）。
> 审阅方案时的配套工具：`docs/knowledge/decisions/TEMPLATE.md`（提案/ADR 模板）。

## 为什么需要这份文档

KMD 的模式不是随机堆砌，而是一套自洽体系。评审新方案时，最便宜且有效的问题是：
**"这个方案与下表的既有做法一致吗？若偏离，理由是什么？"**
说不出理由的偏离应当被质疑。

## 模式总表

| 子系统 / 文件 | 模式 | 回应的"力"（为什么） |
| --- | --- | --- |
| `EffectManager` / `StyleManager` / `LayoutManager` / `StageRuntime` | **注册表（Registry）+ 元数据驱动** | 扩展频繁：新增命令只需注册 `{ fn, meta }`，引擎零改动；parser 经 registry 验证命令存在性。是 Phase P 插件生态的地基 |
| `effects/presets/`、`stagePresets.ts`、`layoutExpanders.ts` | **自动批量注册（registerBatch + barrel export）** | 新增预设 = 新增一个导出，无需手工接线 |
| `EffectManager.activeMutexes`（WeakMap） | **互斥组冲突检测** | 同一容器上不可叠加的效果需要声明式冲突规则；WeakMap 随 Pixi 容器销毁自动回收，防泄漏 |
| `StageManager` | **门面（Façade）** | 组合 `PresentationManager` / `StageHostSession` / `stageRuntime` / `AuditPort`，对外一张脸；边界外不感知内部结构 |
| `StageManager` ↔ `StageRuntime` 连接方式 | **Provider / 回调注入** | 组件间靠函数契约（`setDesignMetricsProvider`、`resolveComposedCameraState`）而非硬引用；这是 reader-runtime 能干净抽出的原因 |
| `layoutExpanders.ts` | **策略（Strategy）+ 宏展开 / 脱糖** | 高层布局命令与底层布局流指令解耦；每个命令是一个 `LayoutExpander` 函数，返回 `{ pre, post }` |
| `Parser → AstParser → lowering → ParagraphIR` | **编译器管线（Pipeline）** | AST 只管结构，lowering 只管语义路由，IR 是中间产物；为 Phase B 语法演进留出分层 |
| `CompatProjector` / `CompatBinder` | **防腐层（Anti-Corruption Layer）** | 新 IR 投影为旧格式，新旧世界隔离共存；是有偿还计划的刻意债务（清退计划见体检处方 8） |
| `SegmentBuilder` | **建造者（Builder）** | 分步骤把段落装配成时间线执行计划 |
| scene-bake（`pData.snapshot`） | **备忘录 / 烘焙（Memento / Bake）** | 把运行时昂贵计算搬到构建期，换取 `seekTo()` 瞬时恢复 |
| `BehaviorRecord` / `StyleRecord` / `InstantEffectRecord` | **命令模式（Command）— record & replay** | 把"做了什么"物化为不可变数据，同一份数据支持播放、倒带、跳转；**seek 幂等性整体建立在此之上** |
| `src/runtime/readerRuntimeEditorAdapter.ts` | **适配器（Adapter）** | core 与 Vue/Pinia 之间唯一的翻译官；core 不感知 UI |
| `AuditBus` / 诊断收集器 | **观察者 / 事件总线** | 各子系统发事件、不感知监听者；构建期 collector 与运行期 bus 分离 |
| `ReaderRuntimeSession` + 协议信封（`version/id/type/payload`） | **门面 + 版本化消息契约** | 跨端（Android WebView）通信可演进、可校验 |
| 模块级单例（`effectManager` 等 8 个） | **模块单例（Service-Locator 近似）** | 单人+AI 项目的合理取舍；代价是测试替换难、隐式共享状态。**约束：不再新增全局可变状态** |

## House Style 一句话总结

**"注册表 + 元数据"管扩展，"门面"管边界，"记录 + 重放"管时间，"快照"管跳转，"防腐层"管过渡。**

## 一致性检查清单（评审新方案时逐条过）

- 新命令/特效走 registry 注册了吗？还是在引擎里硬编码了分支？
- 新的跨模块通信走回调注入/契约了吗？还是直接 import 对方单例？
- 新的时间相关状态支持 record/replay 吗？是否破坏 seek 幂等？
- 是否新增了全局单例或 `globalThis` 挂载？（默认否决，需专门论证）
- 同一件事是否出现了第二条路径？（参照既有守则：`---` 只走 `scene.clear` 一条路）
- 是否触碰 `docs/knowledge/runtime/core/lifecycle-invariants.md` 中的不变量？

## 已知偏离与债务（含糊处不列，只列已确认的）

- `(globalThis as any).KmdRuntimeConfig`：无 schema 校验的全局配置（体检处方 10）。
- Pixi 私有内部访问（`renderer.batchPipe` 等，`App.ts`）：版本升级集中风险点，宜收拢进 adapter（处方 10）。
- CompatProjector/CompatBinder 遗留层约 40 处引用：待定清退死线（处方 8）。
