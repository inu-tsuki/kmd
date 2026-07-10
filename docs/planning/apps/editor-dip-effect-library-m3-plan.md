# DIP-FX M3 Closure Plan

> 状态：Ready for implementation
> 最近更新：2026-07-11
> 上游：`editor-dip-effect-library.md`、`editor-dip-effect-library-spec.md`
> 目标：用作品级验证收束 DIP-FX，补齐必要的非 DIP 运动半边，并形成可用于课程报告的证据链。

## 1. 当前基线

M0-M2、M3.0 surface profile gate 和背景 profile 修复已经完成。当前已有：

- 17 个 DIP-FX 效果及其示例；
- `duotone` / `emboss` 的 text/background profile，`gray` 的共享实现；
- `fx-cyberpunk-title.kmd` 七段 demo；
- `fx-bg.kmd` 的 production Chromium 自然播放与 seek e2e；
- shader、playback、invariants 和 browser e2e CI gate。

M3 不再扩张完整 `bg.*` / `frame.*`、插件 loader 或滤镜数量。未来插件契约仍是草案，不能成为本阶段重构 runtime 的理由。

## 2. 已观察到的作品缺口

当前赛博朋克 demo 能证明滤镜存在，但更接近逐项能力陈列：镜头之间缺少明确的运动叙事，`underwater` 段也只有滤镜半边，没有表现原规划中的“文字落水/浪花”。

现有非 DIP 能力已经包含 `gravity`、`jump` / `jumpIn`、`wave`、`shake`、`dissolve` 等。尚无证据证明必须新增 `splash` 或粒子系统。因此 M3 采用“审计后决定”的 gate：先尝试用已有 behavior 编排完整镜头，仅在真实作品验证表明表达力不足时，才提出一个最小的新 behavior。

## 3. 工作包

### M3.1 作品观感审计

在 production reader bundle 中完整自然播放 `fx-cyberpunk-title.kmd`，保存桌面视口截图或视频证据，并记录：

- 每段是否能一眼辨认目标视觉语义；
- 段落切换是否形成作品节奏，而非测试清单；
- underwater 镜头是否同时具有运动和滤镜两半；
- browser console、Pixi filter、背景纹理生命周期是否稳定；
- stop、replay、前后 seek 后是否与自然播放一致。

审计结论写回本文件或相邻 review 记录。不要仅凭代码阅读决定新增 behavior。

### M3.2 Demo 重编

优先只修改样例，使用现有 behavior 把关键镜头编排完整：

- underwater 镜头至少组合一个明确的进入/下沉运动与 `underwater` filter；
- 保留一个真实背景 profile 镜头，证明效果语义按 surface 选择实现；
- 减少纯回归说明式画面；回归专用 case 继续留在各 `fx-*.kmd` 与自动化测试中；
- 样例注释明确区分 DIP filter 与非 DIP transform/behavior，但画面本身应无需注释才能看懂。

若 KMD 当前链语法无法把既有 entrance/behavior 与 block filter 安全组合，先记录具体路由证据；不要顺手扩写 Phase B 语法。

### M3.3 条件式 behavior 补充

只有 M3.1/M3.2 证明现有 `gravity` / `jump` / `wave` 无法完成目标镜头时才进入本包。新 behavior 必须：

- 只负责图元运动，不伪装成 DIP filter；
- 复用既有 behavior track、`KineticChar.addModifier` 或 `ContainerBehaviorOffset`；
- 不直接 tween `pivot`，不自建 ticker 所有权；
- modifier id 与 effect name 一致；
- 覆盖自然播放、seek 前后、ended replay、stop、clearScreen；
- 在 spec 与报告中明确标为“非 DIP 配套 behavior”。

粒子 `splash` 不是默认交付项。若它要求新显示对象池、粒子资源或独立 cleanup shape，应另立任务，不塞进 M3 收尾。

### M3.4 报告叙事与交付索引

整理一份短报告提纲，围绕以下主线：

1. 库边界：DIP 处理像素，behavior 移动图元；完整镜头由两者组合。
2. 算法族：点运算、量化、卷积/邻域、形态学近似、位移与程序噪声。
3. surface profile：复用的是视觉语义，不是强制复用同一 shader。
4. 工程正确性：预乘 alpha、padding、参数单位、seek/replay cleanup、Pixi 资源生命周期。
5. 证据：shader compile gate、playback regression、production Chromium e2e 和最终 demo。

报告不得把 `:bg` 描述为终态语法，也不得把当前内部 `EffectDefinition` 描述为稳定插件 API。

## 4. 提交与分支建议

从最新 `main` 创建 `feat/dip-fx-m3-closure`。建议保持以下可独立审查的提交：

1. `test(demo): capture DIP-FX M3 visual baseline`（若新增 e2e/探针）；
2. `feat(demo): compose DIP-FX M3 showcase`（样例编排）；
3. `feat(fx): add <name> companion behavior`（仅在 gate 触发时存在）；
4. `docs(fx): close DIP-FX M3 report narrative`。

不要重写或 squash 已合并的 M0-M2、background profile、CI、community sample 和 filter organization 历史。PR 合并时再 squash 为一个 M3 交付提交即可。

## 5. 验收

必跑：

- `pnpm build`
- `pnpm test:parser`
- `pnpm --filter @kmd/editor test:playback`
- `pnpm --filter @kmd/editor test:invariants`
- `pnpm test:e2e`

若修改任何 `*Filter.ts`，追加 `pnpm test:shaders`。M3 默认不应修改 shader；若观感问题迫使修改，必须先给出 shader/profile 错误的浏览器证据。

完成条件：production Chromium 中自然播放、seek、stop/replay 均稳定；关键镜头能辨认“运动 + 滤镜”的组合；文档能从源码、测试和 demo 追溯报告中的每项声明。

## 6. 给代码编写者的提示词

```text
你将在 KMD 仓库实现 DIP-FX M3 收尾。请先阅读根目录 AGENTS.md，以及：

- docs/planning/apps/editor-dip-effect-library-m3-plan.md
- docs/planning/apps/editor-dip-effect-library.md
- docs/planning/apps/editor-dip-effect-library-spec.md
- docs/planning/apps/editor-dip-effect-library-review.md
- docs/knowledge/runtime/core/effect-pipeline.md
- docs/knowledge/runtime/core/lifecycle-invariants.md
- docs/knowledge/decisions/2026-07-10-dip-fx-surface-profiles.md

先不要新增 effect。第一步在 production reader bundle + Playwright Chromium 中完整自然播放 apps/editor/public/tests/fx-cyberpunk-title.kmd，核对各镜头的画面差异、console/Pixi 错误、背景纹理存活，以及 seek、stop、replay 一致性，并把证据记录到 M3 plan。

然后优先只重编 demo，使用现有 gravity、jump/jumpIn、wave、shake、dissolve 与 underwater，做出至少一个明确的“运动 + DIP filter”镜头。保持 DIP filter 与非 DIP behavior 的边界，不扩张完整 bg.* / frame.*，不实现插件 loader，不改变 :bg 兼容语法。

只有浏览器证据证明现有 behavior 无法表达目标镜头时，才提出并实现一个最小配套 behavior。若新增 behavior，必须复用现有 behavior track 和 cleanup 契约，modifier id 等于 effect name，容器位移使用 ContainerBehaviorOffset，不直接 tween pivot，并覆盖自然播放、双向 seek、ended replay、stop、clearScreen。粒子系统或新资源所有权模型应另立任务，不得顺手塞入本 PR。

同步整理课程报告叙事：DIP 处理像素，behavior 移动图元；surface profile 复用视觉语义而非强制复用 shader。不要把当前 EffectDefinition 或内部目录当成稳定插件 API。

按计划保持小提交。完成后运行 build、parser、playback、invariants、e2e；只有修改 *Filter.ts 时才额外运行 shaders。提交 PR 前给出：改动摘要、浏览器证据、是否触发新增 behavior gate、全部门禁结果、仍存在的观感限制。不要自行合并 PR，交给主审审核。
```
