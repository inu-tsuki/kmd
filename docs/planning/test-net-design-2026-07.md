# 编辑器测试网设计（架构体检处方 5）

> 状态：已实施（2026-07-20，PR feat/test-net）/ 设计仍为权威
> 最近更新：2026-07-20
> 出处：架构体检处方 5（`architecture-health-check-2026-07.md`）
> 目标读者：实施编码者 + 未来维护者
> 相关：`architecture-health-check-2026-07.md`、`roadmap/phase-b/1.6-phase-b-plan.md`（B0.1 重写 parser，本网的直接消费者）、`../knowledge/runtime/core/lifecycle-invariants.md`

## 0. 为什么织这张网

Phase B 的 B0.1 将重写 parser 核心（正则成员解析 → 递归下降、量词类型化），并声称“行为中性、经 `CompatProjector` 投影零变化”。但当前编辑器的测试家底是：

- 无测试 runner，9 个散件脚本靠 `node --import tsx` 手动跑；
- 只有 4 个接进 npm scripts，5 个是孤儿（手动跑、不进 CI）；
- 核心 runtime 自动化覆盖 <5%；`test:shaders` 未进 CI 且有 `SKIP_SHADER_GATE=1` 逃生门。

在这个安全网厚度下，“行为中性”只是一句无人担保的承诺。处方 5 要求：**把散件收编为 Vitest 套件；重点补 layout 坐标稳定性与 effects 四轨分类测试；CI 装 glslang 并硬化 shader 门禁。** 本网即其实现方案。

本网是“**功能验证 vs 叙事验证**”双轨纪律中的**功能验证基础设施**：每个用户可见的 Phase B 特性都要附功能验证 fixture（进本网，自动）+ 叙事验证 kmd（表达性样例）。基础设施/行为中性包（如 B0.1）只需功能验证——而这正是本网的核心消费者。

## 1. 测试模式速览（为什么这么做）

> 本节让接手者理解每个选择的依据，而非照抄步骤。

### 1.1 测试金字塔与我们的重心

```text
        ┌─────────────┐
        │  端到端 E2E  │  少/慢/贵：用户视角跑整个系统（Playwright 浏览器 e2e）
        ├─────────────┤
        │   集成测试    │  中：多模块协作（playback、layout 坐标）← 本网重心
        ├─────────────┤
        │   单元测试    │  多/快：单函数孤立测（本网暂少，见下）
        └─────────────┘
```

**本网刻意把重心放在集成/特征层，而非大量孤立单元测试。** 理由：KMD 的价值在**管线行为**（parse → layout → play 一条龙），不在一堆孤立小函数；且代码现状是上帝对象 + 共享可变状态，孤立单元测试既难写又测不到要害。这是对该代码库形状务实的选择，不是偷懒。

### 1.2 工具分层（别混为一谈）

| 层 | 职责 | 我们的选型 |
| --- | --- | --- |
| 测试运行器 runner | 找出并跑测试、报告红绿 | **Vitest**（当前缺的正是它）|
| 断言 assertion | 真正的检查 `expect(x).toBe(y)` | Vitest 内置 |
| 夹具 fixture | 固定输入数据 | `apps/editor/public/tests/*.kmd` 语料 |
| 替身 stub/mock | 把外部依赖换成可控假件 | gsap 互操作 / document / DOMAdapter 合成度量 shim |
| CI 门禁 | 每个 PR 自动跑、红了挡合并 | `.github/workflows/ci.yml` |

### 1.3 关键模式

- **黄金 / 特征测试（golden / characterization）**——本网主角。比喻：**装修前给每个房间拍照**。B0.1 重写电路（parser）前，把现状冻结成黄金文件；改完对比，照片一样 ⟺ 没挪承重墙，照片不一样 ⟺ 停下人工审查。用于无法凭空知道“正确答案”、规格即“现状行为”的历史代码。**parser 黄金 fixture + 布局坐标快照**即此模式。它**只抓“变化”，不抓“对错”**（现状有 bug 也会被冻结）——对重构安全网是对的，但不是正确性裁判。
- **回归测试（regression）**——`final-playback-test.ts` 的 260 用例，每个都是 R3–R7 真实 bug 固化，防“修好的病复发”。
- **不变量 / 架构守卫（invariant guard）**——`test-invariants.ts` 是**静态**守卫，grep 源码查禁止写法（绕过分流 helper 的 inline 特判），自动化代码纪律检查。
- **表驱动分类（table-driven）**——effects 四轨：列一张“每个特效归哪轨”的表，断言代码与表一致，改分类必须显式改表。

### 1.4 诚实的盲区

- 黄金测试只抓变化、不抓对错；现状 bug 会被一并冻结（发现时单独记录，不在本任务顺手改）。
- 合成字体度量（`width = 字符数 × fontSize × 0.5`）意味着布局测试测的是**布局逻辑**，非真实渲染几何——真实渲染靠浏览器 e2e 补。
- 不追“覆盖率 %”虚荣指标，只盯 Phase B 风险面（parser / layout / effects 分类）。

## 2. 现状盘点

| 脚本 | 行数 | 接 npm script | 性质 |
| --- | --- | --- | --- |
| `final-playback-test.ts` | 3895 | `test:playback` | 播放状态机回归，带 headless shim，260+ 用例 |
| `frontmatter-writeback-test.ts` | 275 | ✗ 孤儿 | frontmatter 写回 |
| `final-shader-test.ts` | 110 | `test:shaders` | GLSL 编译门禁（glslang），有 SKIP 逃生门 |
| `test-invariants.ts` | 95 | `test:invariants` | INV-7/INV-8 静态守卫 |
| `final-parser-test.ts` | 89 | `test:parser` | parser 集成，已 dump `parser-output.json`（原型黄金）|
| `test-markdown-parser.ts` | 56 | ✗ 孤儿 | 旧迭代 |
| `test-parser-v2.ts` | 45 | ✗ 孤儿 | 旧迭代 |
| `test-variable-parser.ts` | 39 | ✗ 孤儿 | 变量解析 |
| `test-parser-script.ts` | 34 | ✗ 孤儿 | 旧迭代 |

关键事实：

- **编辑器无 vitest**；`apps/community-api` 用 `vitest ^2.1.8`——版本对齐它。
- `final-parser-test.ts` 已在 dump 全量 parse 结果（`parser-output.json`）——黄金网的雏形，但只覆盖 `final-test.kmd` 一个文件。
- `final-playback-test.ts` 的 headless shim（gsap 互操作 / document stub / DOMAdapter 合成度量）**确定性**，可提取为共享 setup，作为布局坐标测试的稳定基准。
- 语料：`apps/editor/public/tests/` 32 个 `.kmd`（01–12 行为/时序 + 18 fx-* + fx-bg/cyberpunk）+ 顶层 7 个。
- CI 现跑：language:check → build → parser → playback → invariants → reader typecheck/build → playwright e2e → community-api build/test。无 vitest 步骤，无 shaders。

## 3. 设计：四根支柱

### 支柱 1 · 引入 Vitest 作为 runner（不重写）

- `apps/editor` 加 `vitest ^2.1.8`（对齐 community-api）+ `vitest.config.ts` + `pnpm --filter @kmd/editor test`（根加 `pnpm test`）。
- 抽 **`setup.ts` 统一 headless 环境**：把 `final-playback-test.ts` 里的 gsap 互操作补丁、document stub、DOMAdapter 合成度量提取为**单一真相源**，所有测试共享同一确定性环境——这是布局坐标测试成立的地基。
- Vitest 提供 runner + 断言 + 快照 + 选跑 + 报告 + watch，均为 tsx 脚本所无。

### 支柱 2 · 新增定向测试（Phase B 安全网的心脏，先做）

**(a) Parser 黄金 fixture（全语料）——最高优先**

- 解析全语料（`public/tests/*.kmd` + 顶层 `*.kmd` + `final-test.kmd`）→ **稳定规范化序列化**（`ParagraphAst` + `ParagraphIR` + tokens/effects/layoutInstructions，键序稳定；位置 range 一并保留，因 B0.1 也应保持）→ 对比**提交的黄金文件**。
- **B0.1 行为中性 ⟺ 黄金零变化**。任何 diff 必须人工审查，**禁止无脑 `--update`**。
- **语料覆盖审计**：确认覆盖 B0.1 触及表面——成员解析、量词（`1s`/`0.5line`/相对值）、`cam.*`、`hold`/`ease` 词形、`:bg`、括号组。缺则补 fixture，否则黄金网罩不住重写面。

**(b) 布局坐标稳定性——次优先**

- 用 setup.ts 的确定性合成度量，解析语料 → 跑 layout（LayoutPlanner/TextLayoutEngine）→ **快照每字符 x/y/baseline**。
- 测**布局数学**：垂直堆叠、align、断行、`goto`/`flow`/`up`/`down` 偏移、marker 同步——给定度量模型即确定。

**(c) Effects 四轨分类——第三优先**

- 遍历 `effectManager.getRegisteredNames()`（处方 4 已加此 API）+ `styleManager`，断言每个 preset 的 `track`/`type`/`targetType`/`mutexGroup`/`stackable` 对一张**提交的分类表**。
- 新增/改 preset 必须显式改表，逼出有意识变更。钉死 Phase B `EffectMiddleware` 要消费的分类。

### 支柱 3 · 收编散件（绿了再切 CI、退役旧脚本）

| 脚本 | 去向 |
| --- | --- |
| `final-parser-test.ts` | parser 集成套件 |
| `final-playback-test.ts` | playback 套件（**先整体包成一个 test 断言 `fail===0`，再渐拆**，勿大爆炸重写）|
| `test-invariants.ts` | 守卫套件（断言零违规）|
| `final-shader-test.ts` | shader 门禁套件（去 SKIP 逃生门）|
| 5 个孤儿 | 并有用的断言进 parser/frontmatter 套件；明显旧迭代者退役 |

迁移期旧脚本与 vitest 包装并存，包装绿后切 CI、退役旧脚本。

### 支柱 4 · CI 硬化

- CI 装 `glslang-tools`，`test:shaders` 提为**必跑**（删 `ci.yml` 末尾“暂未纳入”注释、不再依赖 `SKIP_SHADER_GATE`）。
- 加 vitest 步骤（`pnpm test`）。
- 既有门禁全保留。结果：PR 必过 **parser 黄金 + 布局稳定 + effects 分类 + playback + invariants + shaders + e2e**。

## 4. 落地顺序（不打断 CI）

1. 加 vitest + config + `setup.ts`（shim），落一个 trivial 绿测试。CI 不动。
2. **先建支柱 2 三类定向测试**（纯新增，不动旧脚本），立刻抬高 B0.1 安全网。
3. 迁移支柱 3 的 4 个已接线脚本到 vitest 包装；绿了切 CI、退役旧脚本。
4. 三角化 5 个孤儿：并有用的、退过时的。
5. 支柱 4 CI 硬化：glslang + shader 门禁 + vitest 步骤。

## 5. 验收（处方 5 完成条件）

- `pnpm test` 跑完整 vitest 套件全绿。
- Parser 黄金网覆盖全语料 + B0.1 触及语法的 fixture。
- CI 跑 vitest + `test:shaders`（装 glslang、无 SKIP 逃生门）。
- 9 个散件全部收编或退役，无孤儿手动测试。
- 更新 `CLAUDE.md` 的 “There is no full unit-test suite yet”（处方 5 复核条件）。

## 6. 风险与盲区

- **playback 3895 行 + 娇贵 shim 是最大迁移成本** → 先整体包、再渐拆，勿大爆炸重写。
- **布局坐标测试依赖确定性度量 stub** → 务必从 playback 干净提取到 `setup.ts`，两边同源。
- **黄金测试易脆、易橡皮图章** → 规范化序列化要稳；黄金更新必须人工审。
- **黄金/分类表是“现状特征”不是“正确性裁判”** → 发现现状 bug 单独记录，不顺手改行为。

## 7. 给代码编写者的提示词

```text
你将在 KMD 仓库实施架构体检处方 5：为编辑器织 Vitest 测试网。请先阅读根目录 AGENTS.md，以及：

- docs/planning/test-net-design-2026-07.md（本设计文档，权威，先通读 §1 理解为什么这么做）
- docs/planning/architecture-health-check-2026-07.md（处方 5 出处）
- apps/editor/src/final-parser-test.ts、final-playback-test.ts、test-invariants.ts、final-shader-test.ts（待收编散件）
- apps/editor/src/core/parser/Parser.ts、core/layout/（LayoutPlanner / TextLayoutEngine）、core/effects/EffectManager.ts、core/effects/StyleManager.ts（被测对象）
- .github/workflows/ci.yml、playwright.config.ts（现有门禁）
- apps/community-api/package.json（vitest ^2.1.8 版本参照）

目标与四根支柱（详见设计文档 §3）：

1. 引入 Vitest（^2.1.8 对齐 community-api）+ vitest.config.ts + setup.ts（把 final-playback-test.ts 里的 gsap 互操作 / document stub / DOMAdapter 合成度量 shim 提取为单一真相源）+ pnpm --filter @kmd/editor test 与根 pnpm test。

2. 新增三类定向测试（先做，纯新增不动旧脚本）：
   (a) parser 黄金 fixture：解析全语料（apps/editor/public/tests/*.kmd + 顶层 *.kmd + final-test.kmd）→ 稳定规范化序列化（ParagraphAst + ParagraphIR + tokens/effects/layoutInstructions，键序稳定，位置 range 保留）→ 对比提交的黄金文件。B0.1 行为中性 ⟺ 黄金零变化。审计语料是否覆盖 B0.1 触及语法（成员解析 / 量词 / cam.* / hold-ease 词形 / :bg / 括号组），缺则补 fixture。黄金更新必须人工审，禁止无脑 --update。
   (b) 布局坐标稳定性：用 setup.ts 的确定性合成度量，解析语料 → 跑 layout → 快照每字符 x/y/baseline，测布局数学（堆叠 / align / 断行 / goto-flow-up-down 偏移 / marker 同步）。
   (c) effects 四轨分类：遍历 effectManager.getRegisteredNames() + styleManager，断言每个 preset 的 track/type/targetType/mutexGroup/stackable 对一张提交的分类表；改分类须显式改表。

3. 收编散件（绿了再切 CI、退役旧脚本）：final-parser-test → parser 集成套件；final-playback-test → playback 套件（先整体包成一个 test 断言 fail===0，再渐拆，勿大爆炸重写）；test-invariants → 守卫套件（断言零违规）；final-shader-test → shader 门禁套件。5 个孤儿（test-markdown-parser / test-parser-script / test-parser-v2 / test-variable-parser / frontmatter-writeback）：并有用的断言、退过时者。

4. CI 硬化：装 glslang-tools，test:shaders 提为必跑（删 ci.yml 末尾“暂未纳入”注释、不再依赖 SKIP_SHADER_GATE）；加 vitest 步骤；既有门禁全保留。

关键约束：
- 行为保持：收编不改被测代码语义，只是把断言搬进 runner。
- 确定性：黄金序列化键序稳定、字段保留规则明确；布局测试与 playback 共用 setup.ts 同一度量 stub。
- 不动 reader-runtime-web 边界；不引入新执行语义。
- 黄金/分类表是“现状特征”不是“正确性裁判”：发现现状 bug 单独记录，不在本任务顺手改行为。

分支与提交：从最新 main 创建 feat/test-net。建议小提交：
1. test(infra): adopt vitest + setup shims
2. test(parser): corpus golden fixtures
3. test(layout): coordinate stability snapshots
4. test(effects): four-track classification table
5. test: migrate scattered scripts into suites
6. ci: shader gate + vitest step
不重写无关历史。

验收门禁（全绿）：pnpm build、pnpm test（新 vitest 套件）、pnpm test:parser、test:playback、test:invariants、test:e2e、test:shaders（装 glslang）。

完成后提交 PR 前给出：改动摘要（新增哪些套件、收编/退役哪些脚本）；黄金网覆盖了哪些语料与 B0.1 语法；布局/分类测试的快照规模；CI 变更；全部门禁结果；发现的现状 bug 清单（若有，单独列不顺手改）；仍存在的盲区。不要自行合并 PR，交给主审审核。
```
