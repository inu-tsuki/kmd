# 主题三：撒糖 —— 规划（2026-08，重整版 v4）

> 状态：PLANNING（待用户批准开工）。Phase B 等待期的体验层糖。
> 基线：main `0cb0c08`；PR #29 `codex/extract-core-package` head `78fe0f7`——**复审 APPROVED，待合入**。
> 体例对齐：`theme-2-yard-sweep-2026-08.md`。
> v2（08-11）：PR 审查账目 + 三裁决 + page 设计附录。
> v3（08-12）：用户 review 八问落点。
> v4（08-12）：78fe0f7 复审闭环——作者修复 F1–F6/F8/F9 并超范围回应八问；
> 切片相应缩减（S1/S2/S8 销账；附录 B/C/D 降为指向作者文档的指针）。

## 0. PR #29 审查账目

方法：三路 reviewer 并行 + 亲手核实关键论断 + worktree 实测（两轮：8cc938c 与 78fe0f7）。

### 0.1 分片判定（8cc938c 轮）

| 片 | 判定 | 证据 |
|---|---|---|
| @kmd/core 拆分 | ✅ | 字节纯移动（blob 哈希）；ADR 链一致；边界守卫有效；reader 独立工具链；lockfile 零新第三方 |
| 主题系统 | ⚠️→✅（78fe0f7 修 F8/F9） | 架构正确；F8 冒号名 / F9 死选择器已修并配机械引信 |
| LSP V1.1/V1.2 | ✅ | 纯适配不碰 parser；stdio+IPC；门禁+测试 |
| playback/effects | ✅ | 有意变更标注齐全；Gap A 修正诚实；golden 排除有原则 |

### 0.2 发现清单（闭环状态）

| # | 内容 | 闭环 |
|---|---|---|
| F8 | 项目主题名含 `:` 被 Monaco 拒 | ✅ 78fe0f7：全名 sanitize；测试 mock 钉命名规则 + 断言定义名 |
| F9 | 默认主题中间路径选择器死规则 | ✅ 78fe0f7：改前缀选择器；新增 grammar-scope 前缀对齐测试 |
| F1 | CLAUDE.md 命令注释不符 | ✅ 78fe0f7 注释对齐 |
| F2 | tripwire 未纳新三套件 | ✅ 78fe0f7：63 playback 声明 + 2 editor = 65；it.each 展开口径记账入头注 |
| F3 | description 宣称 auto-completion | ✅ 78fe0f7 |
| F4 | vsce 打包坑 | ✅ 78fe0f7：dependencies {} + esbuild 自包含 + .vscodeignore + check-package.mjs 机械自检 + VSIX smoke 527 KB |
| F5 | reader bundle 账目缺 | ✅ 作者零影响（主 chunk hash 不变）；账目入我侧台账（+9.22 kB vs main） |
| F6 | --tab-height 死声明 | ✅ 78fe0f7 |
| F7 | LSP Range 靠解析消息文本 | 记录不修（预期）→ Phase B |

### 0.3 账目表（实测，78fe0f7）

| 项 | 值 | 备注 |
|---|---|---|
| reader bundle | 892.14 kB（= 8cc938c，主 chunk hash 不变） | vs main +9.22 kB（+1.0%） |
| editor 测试 | 328/328（29 files）+ LSP 5 | 两轮亲手跑 |
| e2e | 11/11 | 78fe0f7 轮亲手跑 |
| build | 绿 | 78fe0f7 轮亲手跑 |
| tripwire | 65 静态声明（63+2），it.each 展开 70 | 作者记账 |
| 语言资产 | 零改动 | 硬边界守住 |

### 0.4 八问超范围回应（作者文档，优于我的附录草稿）

- Q1 → 物理移 `public/examples/cyberpunk/`（目录所有权替代名单；golden 收集器自然跳过；e2e 改 `loadExample`；editor/reader 无运行时消费者，移动安全——已核实）。
- Q2 → `docs/planning/apps/editor-project-model.md`：三层模型（.kmd 文档 / editor workspace / .kmdwork Work）+ workspace.json 草案 + 实施顺序；引用既有权威（frontmatter-schema / work-kmd-content-model / work-bundle-format）。
- Q3 → shader gate 卫生改进（mkdtemp + afterAll 清理），形态保留（INV-8 钉不动）。
- Q4/Q5/Q6/Q7/Q8 → `docs/planning/runtime/portable-language-runtime-boundaries.md`：
  §3 源码导航≠控制流（line→node/path/local time）；§2 Effect Graph（`clock: 'work'|'wall'|'event'` = Q7 类型化答案；声明式插件 IR，cyberpunk 为内建原型）；§4 AnchorIndex（typed 统一三类锚点）；§1 IR 桥梁（typed 分阶段 IR，物理拆包等第二后端）。
  `packages/core/README.md` 同步指北。

## 1. 菜单重整（PR 合入后现状）

| 原菜单 | 状态 | 主题三剩余 |
|---|---|---|
| 1 主题系统 | ✅（F8/F9 已修） | UI 换肤入口 + Dracula/One Dark 开箱即用验收 |
| 2 Hot Replay | ✅ | 手测冒烟并入门禁 |
| 3 capabilities 消费 | ❌ | S3 |
| 4 LSP | ✅ V1.1/V1.2 | S4 = V1.4 enabler（裁决 3） |
| 5 DIP-FX M3 | 部分 | S5 审计 + 双示样例 + 整理报告 |
| 6 page 模式 | ❌ | S6 设计页（附录 A），不动工 |

## 2. 切片（PR 合入后从 main 切 `feat/theme-3-sugar`；每片一提交）

- **S1 · capabilities 消费 MVP**：adapter 接 `onRuntimeReady` 存 capabilities 入 store；TimeLordBar inspection 开关依 `supportsInspection` 显隐；protocol/session 测试同步。契约零变更优先。
- **S2 · 主题残件**：设置区主题选择器（默认/项目/内置 Dracula+One Dark，走同一 load 路径）；两主题开箱即用验收（含 F9 引信覆盖不到的第三方主题手测）。
- **S3 · V1.4 enabler**：`EffectMetadata.description?: string`；presets 补描述（先 cyberpunk + visual 高频子集）；LSP hover 骨架；hover 测试。
- **S4 · DIP-FX M3 审计**：spec §0.3 双示样例（色调/邻域类 `:block` 连续级）；Chromium 探针跑 surface profile 表（§0.6）；整理报告入 `docs/planning/apps/editor-dip-effect-library.md`。不加新 behavior。
- **S5 · page 模式设计页**：附录 A 成文，交用户过目；不实现。
- **S6 · 台账收口**：本文件转台账 + roadmap「当前规划上下文」更新。

（原 v3 S1/S2/S8——CLAUDE.md 注释、tripwire 纳新、showcase 子目录——作者已于 78fe0f7 完成，销账。）

## 3. 门禁与纪律

- 每片按 CLAUDE.md 表（含 language-server:check / vscode-kmd:typecheck）；收口全量 + e2e（触渲染）。
- tripwire 增删 it 必须记账（新口径：静态声明数 65）。
- 新依赖进 reader bundle 前探针实测（预期零新依赖）。
- Known Gaps A/B/C 记录不修不变；撞见执行层 bug 报告不修。
- 不碰 parser/scanner/语言面/TM grammar；F7 归 Phase B。

## 4. 刻意不做

| 项 | 去向 |
|---|---|
| F7 LSP Range 富形状 | Phase B |
| P5.3 GrammarService | 冻结 |
| page 模式实现 | 设计过目后另议 |
| V1.3 completion | 后续主题 |
| Q3 shader gate 形态灵活化 | 作者已卫生改进；形态保留（INV-8） |
| Q4/Q6 seek/anchor 图化升级 | 作者文档已定边界（portable §3/§4）；实现归 B4/Phase B |
| Q5 脚本侧组合高级特效 | Effect Graph（portable §2）归 Phase B 后；cyberpunk 为内建原型 |
| Q7/Q8 speed 定义与 IR 切分 | 作者文档已给方向（clock 三值 / typed IR）；定义页用户执笔 gate #6 |

## 附录 A · page 模式一页设计（S5 交付物草稿，待用户过目）

**现状事实**（亲手核实）：
- 类型三处：frontmatter `mode`（parser/types.ts:27）、`ScriptPlayer.currentMode`（:34）、契约 `ReaderRuntimePresentationMode`（ReaderRuntimeContract:5）。
- `setMode` 把 page 折叠进 scroll（ScriptPlayer:456）。
- SegmentBuilder 已给 page 语义特殊处理：每段隐式 clear 前活动段（:108-112）；段间无 2s 间隔（:313-315）。
- scroll/page 共享 fontScale 重算 + rebuild 门（ReaderRuntimeSession:222-225, 359-362）。
- 即：**page = scroll 布局 + 逐段隐式清场**；缺的是呈现层（分页/视口裁切/翻页导航）。
- 与作者 portable 文档对齐：page 呈现属 runtime host/session 层（时钟/资源/输入另层管理），不进 SegmentBuilder。

**语义提案**：page = 「一屏一页」——按 designHeight 分页，视口只显示当前页，翻页 = 视口迁移（带过渡）。reflow 触发：fontScale 变更、host resize（与 scroll 同门）。

**呈现层落点**：AS2 PresentationManager/ReaderHost 缝。分页数据源：layout 行盒 Y 坐标 → 页边界；每页 = 行盒区间 + timeline 区间（checkpoint 已有）。

**runtime vs host 所有权**：
- runtime：分页计算、视口裁切/迁移、页↔timeline 映射、reflow。
- host：翻页 UI/手势、页码、阅读进度持久化。
- 契约面：可选增 `pageIndex`（需同步协议测试）。

**测试增量**：page 分页单测（行盒→页边界确定性）+ e2e（翻页 seek 往返、reflow 后页边界稳定）。

**开放问题（过目时裁）**：
1. 页边界切在行盒间还是允许段内切页（长段超一屏时）？
2. 翻页过渡是 runtime 内置（timeline cue）还是 host 驱动（视口 API）？
3. page 与 `---` scene.clear 的交互：显式 `---` 是否 = 强制换页？
