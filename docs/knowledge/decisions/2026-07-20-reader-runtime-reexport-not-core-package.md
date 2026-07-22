# reader-runtime 相对路径 re-export，而非立即抽 packages/core

- 日期：2026-07-20
- 状态：已采纳（追溯归档，处方 9）

## 回应的力

`@kmd/reader-runtime-web` 需要复用 core（parser / layout / effect / player）。问题：要不要**立即**抽一个纯 `packages/core` 包让 reader 依赖？

core API 此刻并不稳定——Phase B 将大改 parser / execution / segment 模型。现在抽 `packages/core` = 把一个不稳定的内部 API 冻结成公开契约，Phase B 期间每次改动都要动 core 包的导出与版本，维护成本极高。

## 决策

**暂不抽 `packages/core`。** reader-runtime-web 以**相对路径 re-export** 用到的 core 模块；reader 边界由“禁止 editor-only import” + `reader:typecheck` 强制守护，而非物理分包。等 core API 稳定（`repository-strategy.md` §11 触发条件满足）再物理抽包。

## 方案对比

### 方案 A：立即抽 packages/core
做法：物理分包，reader 依赖纯 core 包。
代价 / 局限：过早冻结不稳定 API；Phase B 每次改动牵动 core 包导出/版本；在 core 还在剧烈演进时背上包版本管理的负担。

### 方案 B：相对路径 re-export（采纳）
做法：reader-runtime-web 用相对路径 re-export core 模块；边界靠 import 规则 + typecheck 守。
代价 / 局限：边界不是物理隔离，靠纪律 + 自动检查维持；将来抽包时需要一次 re-export → 包依赖的替换。
为什么最简方案不够用：repository-strategy 明确“core API 未稳定前不拆物理包”；现在抽包是把负债当资产。

## 触碰的不变量

- **reader-runtime-web 边界**（无 editor-only import）——守护：`reader:typecheck` + import grep + e2e。
- **单一 core 真相源**（不复制 core 代码，只 re-export）。
- 参照 `docs/planning/ecosystem/repository-strategy.md` §11 拆分触发条件、`docs/planning/packages/reader-runtime-web.md`。

## 与 house style 的关系

与 repository-strategy 的分段策略（A→R→B→C，触发条件 §11）一致——“先在文档声明边界、后由触发条件驱动物理拆包”。reader-runtime 的抽取门槛条目之一即“Phase B IR/state/segment-graph 上主线或设计评审通过”。

## 可逆性

高。相对路径 re-export 将来可平滑替换为对 `packages/core` 的依赖（触发条件满足时）；不锁死任何文件格式、协议或公开 API。

## 结果

reader-runtime-web 已用相对路径 re-export 正常工作（`packages/reader-runtime-web/src/index.ts`），Android 经本地 HTTPS 虚拟域名消费真实 bundle。`packages/core` 抽取保持 gated：晚于 reader-runtime-web、待 core API 稳定后由 repository-strategy §11 触发。
