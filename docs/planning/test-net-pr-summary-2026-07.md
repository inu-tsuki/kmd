# PR: feat/test-net — 编辑器 Vitest 测试网（架构体检处方 5）

> 分支：`feat/test-net`（10 commits，不自行合并，交主审审核）
> 设计文档：`docs/planning/test-net-design-2026-07.md`（§3 四根支柱）
> 处方出处：`docs/planning/architecture-health-check-2026-07.md` 处方 5

## 主审 review 修正（2026-07-20）

回应主审 two changes requested：

1. **布局测试缺段间状态面**（中等）——layout-coords.test.ts 对每段独立调用无状态 TextLayoutEngine.calculate()，没经过负责段间状态的 LayoutEngine（addLine 累加 currentY + 持久化 globalMarkers）。设计要求的段间垂直堆叠、marker 同步没被测。
   - 修正：新增 `layout-stacking.test.ts`（5 tests）——模拟 LayoutEngine.addLine 的段间状态传递（共享 markers Map 跨段持久 + currentY 累加），断言段首字符 y 严格递增、delta 符合 ascent+descent+spacing 模型、point_a marker 跨段存活。
   - 修正：layout-coords.test.ts 的 goto 断言从松散的 `x>100 && y>200` 改为精确的设计坐标语义（goto(x,y) 以设计中心 960,540 为原点 → goto(100,200) 落 x≈1066, y≈740, inFlow=false）；新增 mark+goto(mark) 段内同步断言（mark 写 point_a={0,0}，goto 读它跳回行首 out-of-flow）。
2. **headless shim "单一真相源" 出现两份不同实现**（中等）——setup.ts 声称统一，但 playback-regression.test.ts 子进程跑旧 runner，后者在 final-playback-test.ts 内仍维护完整 shim。两份已漂移（setup 的 measureText 有 actualBoundingBoxLeft/Right，旧 runner 没有）。
   - 修正：final-playback-test.ts 删除内联 shim（原 L42–98），改为 `import { G } from './test/setup'`——单一真相源。旧 runner 现与 vitest 套件同源，playback 331 用例复跑绿。§B-bis 注释保留在 setup.ts。

附带：commit 数从 7 更正为 10（含 review 修正提交）。

## 改动摘要

### 新增套件（apps/editor/src/test/，vitest ^2.1.8 对齐 community-api）

| 套件 | 文件 | 测试数 | 性质 |
|---|---|---|---|
| smoke | smoke.test.ts | 3 | runner + setup shim + parser 加载确认 |
| parser golden | parser-golden.test.ts | 50 | 全语料规范化序列化黄金（39 文件）+ B0.1 覆盖审计（9 断言）+ 语料非空（1）+ 黄金比对（39）+1 |
| layout 坐标 | layout-coords.test.ts | 9 | 合成度量下每字符 x/y/inFlow/offset 快照 + 断行/up-down/left-right/align/goto（设计坐标原点 960,540）/mark+goto(mark) 段内同步 不变量 |
| layout 段间状态 | layout-stacking.test.ts | 5 | 有状态段间堆叠（currentY 累加，首字符 y 严格递增 + delta 模型）+ 段间 marker 持久（globalMarkers 跨段存活）|
| effects 分类 | effects-classification.test.ts | 6 | 47 effects + 22 styles 双向匹配分类表 + 四轨覆盖 + timing 无 mutex + filter mutex 族 + gray 重叠 |
| parser 集成 | parser-integration.test.ts | 13 | Report 5.x 语义断言（收编 final-parser-test.ts） |
| playback 回归 | playback-regression.test.ts | 1 | 331 用例整体包成 1 test（子进程跑 final-playback-test.ts，断言 fail===0） |
| invariants 守卫 | invariants-guard.test.ts | 1 | INV-7/INV-8 静态守卫（收编 test-invariants.ts） |
| shader 门禁 | shader-gate.test.ts | 23 | 21 文件 23 shader glslangValidator 编译（收编 final-shader-test.ts，去 SKIP_SHADER_GATE 逃生门） |
| frontmatter 写回 | frontmatter-writeback.test.ts | 13 | W1–W4 写回往返（收编 frontmatter-writeback-test.ts） |

**vitest 合计：124 tests / 10 files 全绿。**

### 收编 / 退役脚本

| 脚本 | 去向 |
|---|---|
| final-parser-test.ts | 收编进 parser-integration.test.ts，退役 |
| final-playback-test.ts | 保留（vitest 子进程包装调用它）；**shim 已改为从 src/test/setup.ts 导入（单一真相源，不再维护内联副本）**；npm script 切指 vitest 套件 |
| test-invariants.ts | 收编进 invariants-guard.test.ts，退役 |
| final-shader-test.ts | 收编进 shader-gate.test.ts，退役 |
| frontmatter-writeback-test.ts | 收编进 frontmatter-writeback.test.ts，退役 |
| test-markdown-parser.ts | 退役（stale：pre-B0.1 效果名 special/thin、~^ 糖衣语义已改） |
| test-parser-script.ts | 退役（stale：无断言 smoke printer） |
| test-parser-v2.ts | 退役（stale：无断言 smoke printer） |
| test-variable-parser.ts | 退役（stale：无断言 smoke printer） |

**9 个散件全部收编或退役，无孤儿手动测试。**

### 基础设施

- `vitest.config.ts`：单 fork、禁并发、node 环境（隔离全局 DOMAdapter shim）。
- `src/test/setup.ts`：把 final-playback-test.ts L18–98 的 gsap 互操作 / document stub / DOMAdapter 合成度量 shim 提取为**单一真相源**；修合成度量补 `actualBoundingBoxLeft/Right`（pixi CanvasTextMetrics._measureText 算 boundsWidth 需要，缺则 NaN 传染——原 shim 只影响 playback 非坐标断言故未暴露，layout 坐标测试触发后修复）。
- `src/test/golden-serializer.ts`：递归键序稳定化（对象键字母序、数组顺序保留、undefined 剔除、range/ast/ir 全保留）。
- `scripts/generate-parser-goldens.ts` + `pnpm test:golden:write`：统一黄金生成器（parser + layout），与测试共用同一计算逻辑。**黄金更新必须人工审 git diff，vitest --update 不触碰黄金（普通 JSON 非 snapshot）。**

### CI 变更（.github/workflows/ci.yml）

- 装 `glslang-tools`（apt），`test:shaders` 提为必跑（去末尾"暂未纳入"注释、shader-gate 套件无 SKIP 逃生门）。
- 加 vitest 步骤（`pnpm test`）。
- 既有门禁全保留：language:check → build → **test** → test:parser → test:playback → test:invariants → **test:shaders** → reader typecheck/build → playwright e2e → community-api build/test。

## 黄金网覆盖

### 语料覆盖（39 文件 + 1 layout fixture = 40 黄金文件，1.5M）

- `apps/editor/public/tests/*.kmd`：34 文件（含新增 b0-1-coverage.kmd + layout-coords.kmd）。
- 顶层 `apps/editor/public/*.kmd`：6 文件（排除 `final-test copy.kmd` 字节重复）。
- 布局黄金：`layout-coords.kmd` 1 文件。

### B0.1 触及语法覆盖（b0-1-coverage.kmd + 9 条显式断言）

| B0.1 语法 | 覆盖 | 现状特征（冻结） |
|---|---|---|
| 3+ 元素成员链（f.red.bold.blur） | ✓ | 当前 parser 接受，B0.1 递归下降应保持形状 |
| line 量词（0.5line） | ✓ | 退化为字符串 "0.5line"（D24 债务） |
| ms 量词（500ms） | ✓ | 静默转秒 0.5，单位丢失（D24 债务） |
| self 量词（1self） | ✓ | 退化为字符串，AST commandChain.params[0] |
| deg 量词（15deg） | ✓ | 退化为字符串 |
| ease 词形（ease(1s) / ease=out） | ✓ | unknown-command 诊断；ease=out 当普通 named param |
| :bg 作用域（gray:bg） | ✓ | char-only 命令强转 :bg 警告（处方 11/12） |
| 括号组（braceGroupId） | ✓ | 解析器赋 braceGroupId |
| hold level 后缀（:char / :group） | ✓ | 裸行 f.:char 未解析为命令，降为纯文本（现状退化） |

### 布局 / 分类测试快照规模

- 布局快照：1 fixture（layout-coords.kmd），9 段 × 每段 N 字符坐标（{text,x,y,inFlow,stepDistance,displayOffsetX,displayOffsetY}），8 条不变量断言。
- effects 分类表：47 effects + 22 styles = 69 行表，双向匹配（表有 registry 无 = 过期；registry 有表无 = 新 preset 未登记）。

## 全部门禁结果（本地，glslang 11/16.3.0）

| 门禁 | 结果 |
|---|---|
| pnpm language:check | ✅ in sync |
| pnpm build（vue-tsc -b + vite build） | ✅ 34.3s |
| pnpm test（vitest） | ✅ 124 tests / 10 files / 6.5s |
| pnpm test:parser | ✅ 63 tests |
| pnpm test:playback | ✅ 331 cases fail===0 |
| pnpm test:invariants | ✅ 1 test（零违规） |
| pnpm test:shaders | ✅ 23 shaders |
| pnpm test:e2e | ✅ 2 Playwright Chromium |

## 发现的现状 bug 清单（单独列，不顺手改）

织网过程中发现的、需独立修复或 Phase B 处理的问题。区分"真实 bug"与"已知 Phase B 范围"。

### 真实 bug（需独立修复）

1. **裸行 `f.:char` / `f.:group` 未解析、缺诊断**（parser bug）——`f.hold:char(1s).red` / `f.wave.hold:group(2s)` 这类无 `{...}` 主语 token 的裸行被当纯文本，零 effect、零诊断、静默降级。这是错误写法，parser 应解析报错（发 unknown / syntax 诊断），而非静默吞掉。b0-1-coverage.kmd 黄金已冻结现状（token.content 保留原始文本、effects 空），B0.1 递归下降重写时应明确报错路径。非本任务顺手改。
2. **`AstParser.braceIdCounter` 单例累加，破坏连续 `parse()` 的确定性**（生产侧潜在风险）——parser 单例的 `AstParser.braceIdCounter` 跨 `parse()` 调用累加从不重置，同输入不同次 parse 的 `braceGroupId` 递增、序列化非确定。测试侧用 fresh `KMDParser()` 规避（不改被测代码）。当前生产未暴露（`braceGroupId` 只在 `ScopeRouter` 按 id 分组，不依赖具体数值），但是"恰好没踩"非"安全"。**已作为 R-P1 正式记录在 `docs/knowledge/runtime/core/parser-pipeline.md` "已知风险"节**，含修复方向。

### 已知 Phase B 范围（非新发现，黄金冻结现状供 B0.1 diff）

3. **量词类型化缺失（D24）**——`autoConvert` 仅处理 s/ms，line/self/deg 退化为字符串，ms 静默转秒丢单位。B0.1 D24 量词类型化重写覆盖，黄金 diff 将暴露语义变化。非新发现。
4. **ease 从未实现**——spec 规划 ease 为 `~time~>` 语法糖（`docs/knowledge/language/chain-model.md:52`），当前 parser 从未实现 ease 词形，`ease(1s)` 发 unknown-command 诊断。Phase B 将以 `~time~>` 语法糖引入。非"已废弃"（前版描述有误，已更正）。

### 非 bug（已澄清）

- **KMDMetadata 灵活字段**——`bgColor`/`fontColor`/`fontFamily`/`kmdVersion` 等未在 `KMDMetadata` 接口显式声明是**有意设计**（frontmatter 为灵活字段，作者可加任意键，core 读入保留）。frontmatter-writeback 套件侧 cast 为 any 访问是正确做法，非类型债。前版误记为 bug，已移除。

## 仍存在的盲区

- **黄金只抓变化、不抓对错**——上述现状 bug 被一并冻结为"现状特征"，不是正确性裁判。
- **合成字体度量**（width = 字符数 × fontSize × 0.5）——布局测试测的是布局逻辑，非真实渲染几何；段间堆叠测试模拟 LayoutEngine 的 currentY 累加 + globalMarkers 持久，但不构造真实 Pixi Container/KineticText（那是 e2e 面）。真实渲染靠 Playwright e2e 补（当前 e2e 仅 2 用例覆盖 fx-bg）。
- **playback 渐拆未做**——331 用例整体包成 1 test，子进程跑 tsx 脚本。后续应逐个 testXxx 拆成独立 it() 块搬进 vitest，最后退役子进程包装（设计文档 §3 支柱 3 明确"先整体包、再渐拆，勿大爆炸重写"）。shim 已统一从 setup.ts 导入，渐拆时 testXxx 可直接在 vitest 进程内跑（无需子进程）。
- **覆盖率不追虚荣指标**——只盯 Phase B 风险面（parser / layout / effects 分类），单元测试层暂少（设计文档 §1.1 刻意把重心放集成/特征层）。
- **CI 首跑未实测**——glslang-tools apt 安装与 vitest 步骤在本地用 glslang 11/16.3.0 验证，CI ubuntu-latest 的 glslang-tools 版本可能有差异，首次 CI 跑需观察。

## 复核条件

- ✅ CLAUDE.md / AGENTS.md "There is no full unit-test suite yet" 表述已更新为 test net 描述。
- ✅ architecture-health-check-2026-07.md 处方 5 标记完成。
- ✅ test-net-design-2026-07.md 状态改为"已实施"。