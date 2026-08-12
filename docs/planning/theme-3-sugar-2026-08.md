# 主题三：撒糖 —— 规划（2026-08，重整版 v2）

> 状态：PLANNING（待用户批准）。Phase B 等待期的体验层糖。
> 基线：main `0cb0c08`；开放 PR #29 `codex/extract-core-package`（head `8cc938c`，作者 @Aflocathought，12 提交，220 files +13.7k）。
> 体例对齐：`theme-2-yard-sweep-2026-08.md`。
> 重整原因：PR #29 已实现原菜单六项中的四项（主题系统、Hot Replay、LSP 骨架、DIP-FX 部分），
> 并做了两件菜单外大事（@kmd/core 物理拆分、赛博朋克特效库）。本规划 = PR 审查账目 + 剩余糖的切片。
> v2（2026-08-11）：写入用户三裁决 + 审查新发现 F8/F9 + page 模式设计附录。

## 0. PR #29 审查账目

方法：三路 reviewer 并行（core 拆分 / 主题+LSP / playback+effects）+ 我亲手核实关键论断 +
临时 worktree 实测（`/tmp/kmd-pr29` vs `/tmp/kmd-main`）。以下为已亲手验证的事实。

### 0.1 分片判定

| 片 | 判定 | 证据 |
|---|---|---|
| @kmd/core 拆分 | ✅ 正确 | 拆分提交 78eea1e 下 core 全文件与旧路径字节一致（blob 哈希核对，parser/scanner 全 R100）；外部依赖仅 gsap/pixi.js/zod；ADR `2026-08-10-extract-private-core-package` 取代 07-20 ADR，文档链一致；`check-core-boundary.mjs` 守 Vue/Pinia/Monaco/TextMate/相对逃逸；reader 获独立 tsc/vite 工具链；lockfile 零新第三方版本 |
| 主题系统 | ⚠️ 架构正确，两 bug（F8/F9） | 默认主题迁 VS Code JSON；`scopeToToken` 保留最具体 TM scope，Monaco 点分前缀 trie 匹配亲手验证；22 键 workbench→CSS 映射 + 逐键回退；严格验证 + 回退链 + 穿越防御；App.vue hex 全变量化；11 测试。但 F8 使项目主题在浏览器永远落回默认；F9 使默认主题部分选择器死规则 |
| LSP V1.1/V1.2 | ✅ 正确 | `packages/kmd-language-server`：vscode-languageserver 9，stdio+IPC，`toLspDiagnostics` 纯适配（不碰 parser）；vscode-kmd client；`language-server:check` 门禁；5 测试 |
| playback/effects | ✅ 正确且有纪律 | 组特效首字对齐 = 有意变更（D12 + 新测试）；Gap A 修正诚实（截断 timing track，倍率缺口保留重标，无 typeof-destroy 绷带）；cyberpunk 无新 shader、seek 生命周期测试；PlaybackController 字节纯移动 |
| golden 排除（8cc938c） | ✅ 有原则 | 显式名单非宽泛模式；test-net 同步；44 unchanged |

### 0.2 发现清单（已发 PR #29 issue comment；待作者修订）

| # | 严重度 | 内容 | 处置 |
|---|---|---|---|
| F8 | blocker | `themeNameFromPath` 产出含 `:` 名字，Monaco `defineTheme` 拒（`/^[a-z0-9\-]+$/i`，standaloneThemeService.js:257 实测）→ 项目主题浏览器静默回退；mock 测试不执行名字规则故绿；restoreProject 竞态下 `attachMonaco` 无 try/catch 可中断编辑器创建 | 作者修（裁决 1=a）；不修则主题三 S4 接管 |
| F9 | major | 默认主题中间路径选择器（`string.quoted.kmd` 等）与 grammar 实际输出（`string.quoted.double.kmd` 等）不构成前缀 → 死规则，引号串高亮回归（丢 #CE9178） | 同上 |
| F1 | major | CLAUDE.md 命令注释与实际脚本不符（build/test 实含 language-server/vscode-kmd 步骤） | 同上；不修则 S1 |
| F2 | major | tripwire 未纳新三套件（16 it 账外） | **裁决 2 = 纳新 49→65**；作者修则记账入其 commit，不修则 S2 接管 |
| F3 | minor | vscode-kmd description 仍宣称 auto-completion | 作者修；不修则 S4 |
| F4 | minor | vsce 打包坑（workspace:* 无 .vscodeignore） | 同上 |
| F5 | minor | reader bundle +9.22 kB PR 正文无账目（我已实测补记，0.3） | 提请作者补正文；台账记账 |
| F6 | nit | `--tab-height` 死声明 | S4 |
| F7 | 记录不修 | LSP Range 靠解析消息文本（耦合）；正解 validate() 富形状属 parser 面 | Phase B（台账刻意不做） |

### 0.3 账目表（实测）

| 项 | main 0cb0c08 | PR29 8cc938c | 备注 |
|---|---|---|---|
| reader bundle JS 总计 | 882.92 kB | 892.14 kB | **+9.22 kB（+1.0%）**，gzip +3.06 kB；main 实测与主题二台账 882,884 B 吻合 |
| editor 测试 | — | 328/328（29 files） | 亲手跑过 |
| core:check / language-server:check | — | 绿 | 亲手跑过 |
| tripwire 锚点 | 49 | 49（裁决：纳新后 65） | F2 |
| parser golden | 44+4 展示快照 | 44（显式排除） | 8cc938c |
| 语言资产 | — | 零改动 | 硬边界守住 |

## 1. 用户裁决（2026-08-11）

1. **PR #29**：提审查意见，作者修订后合入。（已发 issue comment；作者活跃。）
2. **F2 tripwire**：纳新三套件，49→65，commit message 记账。
3. **LSP 残件**：V1.4 enabler——`EffectMetadata.description?` + presets 补描述 + LSP hover 骨架。

## 2. 菜单重整（六项 → 现状）

| 原菜单 | PR#29 后状态 | 主题三剩余 |
|---|---|---|
| 1 主题系统 | ⚠️ 已实现带 F8/F9 | UI 换肤入口 + Dracula/One Dark 验收 + F3/F4/F6（作者不修时接管 F8/F9） |
| 2 Hot Replay | ✅ 已实现 | 手测冒烟并入门禁 |
| 3 capabilities 消费 | ❌ 未做 | S3 |
| 4 LSP | ✅ V1.1/V1.2 | S5 = V1.4 enabler（裁决 3） |
| 5 DIP-FX M3 | 部分 | S6 审计 + 双示样例 + 整理报告 |
| 6 page 模式 | ❌ 未做 | S7 设计页（附录 A），不动工 |

## 3. 切片（PR 合入后从 main 切 `feat/theme-3-sugar`；每片一提交）

- **S1 · CLAUDE.md 命令注释订正**（F1，仅当作者未修）。
- **S2 · tripwire 纳新**（F2，仅当作者未修）：三套件入 SUITES，49→65，记账。
- **S3 · capabilities 消费 MVP**：`readerRuntimeEditorAdapter` 接 `onRuntimeReady` 存 capabilities 入 store；TimeLordBar inspection 开关依 `supportsInspection` 显隐（首个真实消费者）；protocol/session 测试同步。契约零变更优先。
- **S4 · 主题残件**：设置区主题选择器（默认/项目/内置 Dracula+One Dark，走同一 load 路径）；两主题开箱即用验收；F3/F4/F6；**F8/F9 仅当作者未修时接管**（F8 sanitize 全名；F9 改前缀选择器或精确 scope）。
- **S5 · V1.4 enabler**：`EffectMetadata.description?: string`（可选，不破坏现有 meta）；presets 逐文件补描述（先 cyberpunk + visual 高频子集）；LSP hover provider 骨架（`onHover` 读 registry meta）；hover 测试。
- **S6 · DIP-FX M3 审计**：按 spec §0.3 补 `:block` 连续级双示样例（色调/邻域类）；Chromium 探针跑 surface profile 表（§0.6）；整理报告入 `docs/planning/apps/editor-dip-effect-library.md`。不加新 behavior。
- **S7 · page 模式设计页**：附录 A 成文，交用户过目；不实现。
- **S8 · 台账收口**：本文件转台账 + roadmap「当前规划上下文」更新。

## 4. 门禁与纪律

- 每片按 CLAUDE.md 表（PR 后含 language-server:check / vscode-kmd:typecheck）；收口全量 + e2e（触渲染）。
- tripwire 增删 it 必须记账（S2 即执行）。
- 新依赖进 reader bundle 前探针实测（预期零新依赖）。
- Known Gaps A/B/C 记录不修不变；撞见执行层 bug 报告不修。
- 不碰 parser/scanner/语言面/TM grammar；F7 归 Phase B。

## 5. 刻意不做（初始）

| 项 | 去向 |
|---|---|
| F7 LSP Range 富形状 | Phase B |
| P5.3 GrammarService | 冻结 |
| page 模式实现 | 设计过目后另议 |
| V1.3 completion | 后续主题 |

## 附录 A · page 模式一页设计（S7 交付物草稿，待用户过目）

**现状事实**（亲手核实）：
- 类型三处：frontmatter `mode`（parser/types.ts:27）、`ScriptPlayer.currentMode`（:34）、契约 `ReaderRuntimePresentationMode`（ReaderRuntimeContract:5）。
- `setMode` 把 page 折叠进 scroll（ScriptPlayer:456 `stageManager.setMode(mode === "stage" ? "stage" : "scroll")`）。
- SegmentBuilder 已给 page 语义特殊处理：每段隐式 clear 前活动段（:108-112，复用 scene.clear 运行时钩）；段间无 2s 间隔（:313-315）。
- scroll/page 共享 fontScale 重算 + rebuild 门（ReaderRuntimeSession:222-225, 359-362）；测试：playback-typography [R3-I]、frontmatter-writeback、session 门。e2e 无 page 专属 spec。
- 即：**page = scroll 布局 + 逐段隐式清场**；缺的是呈现层（分页/视口裁切/翻页导航）。

**语义提案**：page = 「一屏一页」——内容按 designHeight 分页，视口只显示当前页，翻页 = 视口迁移（带过渡），而非 scroll 的连续流。reflow 触发：fontScale 变更、host resize（与 scroll 同门，已有 rebuild 基建）。

**呈现层落点**：AS2 的 PresentationManager/ReaderHost 缝（stage/host 分层），**不**进 SegmentBuilder（构建期语义已定：隐式清场 + 无间隔）。分页数据源：layout 的行盒 Y 坐标（LayoutEngine 已产 line plan）→ 页边界 = 累积高度超 designHeight 处切页；每页 = 行盒区间 + 对应 timeline 区间（checkpoint 已有）。

**runtime vs host 所有权**：
- runtime 拥有：分页计算、视口裁切/迁移、页↔timeline 映射、reflow。
- host 拥有：翻页 UI/手势、页码显示、阅读进度持久化（Android reader 后续工作）。
- 契约面：`progressChanged` 已带 line/paragraphIndex；可选增 `pageIndex`（契约变更需同步协议测试——主题一钉死惯例）。

**fixtures/测试现状与增量**：frontmatter 往返已有；需新增 page 分页单测（行盒→页边界确定性）+ e2e（翻页 seek 往返、reflow 后页边界稳定）。

**开放问题（过目时裁）**：
1. 页边界切在行盒间还是允许段内切页（长段超一屏时）？
2. 翻页过渡是 runtime 内置（timeline cue）还是 host 驱动（视口 API）？
3. page 与 `---` scene.clear 的交互：隐式清场已存在，显式 `---` 在 page 模式是否 = 强制换页？
