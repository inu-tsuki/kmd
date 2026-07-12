# KMD Frontmatter Schema（文档级选项）

> 最近更新：2026-07-12
> 状态：规范草案 —— runtime 字段与写回规则 v1 收敛；作者字段词汇表与 `mode` 继任字段显式悬置
> 上游决议：`design.md` D22（frontmatter = 文档级选项，引擎启动键文档级专属）
> 背景调研：Android reader 仓库 `docs/planning/r3-d-local-import-research.md`（三端 drift 矩阵、2026-06-25 问题清账、2026-07-07 决策补充）

本文定义 `.kmd` frontmatter 的功能边界、字段效力分层、v1 字段表、解析规则与 editor 写回规则。
它是 `.kmdwork` 打包格式（`../architecture/work-bundle-format.md`）的前置规范：不先收敛 frontmatter，打包格式会把三端 drift 固化进文件。

## 1. 定位与效力原则

- frontmatter 是 `.kmd` 的**文档级选项**（D22），与段级选项 `[key=value]` 构成选项级联，就近取值；引擎启动键（`mode` 等）文档级专属。
- KMD 不只用来做"作品"：它也可以是提词器、快速动效字幕、视频特效字素材。因此 frontmatter 不被单一作品用途锁死——**必填字段只决定这份脚本如何渲染和播放**（2026-07-07 原则）。事实上 v1 没有必填字段：一份合法 `.kmd` 可以完全没有 frontmatter，所有字段有缺省值。
- 不涉及播放行为的元信息（平台状态、发布信息、工作区偏好、版本历史）一律外置，去向见效力分层的 X 层。

### 效力分层

| 层 | 名称 | 语义 | 覆盖关系 |
| --- | --- | --- | --- |
| **R** | runtime 启动键 | 决定渲染/播放行为的最低事实 | parser/runtime 消费；文档级专属，段级选项不得覆盖引擎启动键 |
| **A** | 随身作者事实 | 作者自述的可选标识（`title` / `author`） | host 可用作展示 fallback；**不是**平台权威（平台身份归 `Work`） |
| **T** | 主题建议 | 默认视觉主题（`bgColor` 等） | 作为 runtime 缺省值生效；host settings（`ReaderRuntimeSettings.typography` / `viewport.backgroundColor`）优先级更高 |
| **X** | 不属于 frontmatter | `Work.presentation` 派生、社区状态、editor 工作区偏好、revision/bundle 信息 | 分别归属：Work/bundle manifest、云端、editor/project 配置、`.kmdwork` manifest |

T 层的“host settings 优先”只适用于作者未锁定的主题建议与对应 mode 开放的 projection
维度，不允许越过 R 层或 presentation mode 合同改写作者构图。例如 Scroll/Page 可用宿主
字号重排阅读投影；Stage 的设计坐标和显式字号属于作者作品语义，host `fontScale` 不生效。
完整权威顺序与 mode matrix 见
[`lifecycle-invariants.md` INV-9](../runtime/core/lifecycle-invariants.md#inv-9-host-preference-must-not-rewrite-author-composition)。

## 2. 字段表（v1）

| 字段 | 类型 | 层 | 现状消费方 | 规范结论 |
| --- | --- | --- | --- | --- |
| `title` | string | A | editor parser 读入；Web runtime 用作 fallback workId | 保留 |
| `author` | string | A | 仅类型声明，无消费点 | 保留（词汇表扩展悬置，见 §7） |
| `mode` | `stage` \| `scroll` \| `page` | R | 三端消费，枚举 drift（见 §4） | canonical 枚举 = `stage/scroll/page`；别名与非法值处理见 §4 |
| `designWidth` / `designHeight` | number | R | stage-like 的 design viewport | 保留；缺省 1920×1080 |
| `speed` | number | R | `SegmentBuilder.ts:440`（reveal speed） | 保留 |
| `var:` | 缩进块 | R | 写入 `layout.globalMarkers`，供 `var.*` 引用 | 保留；与 D19（`var` = 文档级作用域）衔接 |
| `maxWidth` | number | R | `SegmentBuilder.ts:659` | 保留 |
| `fontSize` / `lineHeight` | number | R? | **类型已声明（`parser/types.ts:30-31`），未发现 core 消费点** | 待核：接线或从类型中移除，不得停留在"声明但无效"状态 |
| `bgColor` / `fontColor` / `fontFamily` | string | T | editor UI 读写（`editorStore.ts:88-93`）；**`KMDMetadata` 类型未声明**；reader 不读 | 纳入类型声明，定性为主题建议：runtime 作缺省值消费，host settings 可覆盖，覆盖时不回写 |
| `kmdVersion` | string | 保留字 | 无消费（仅文档示例出现） | 保留字段名；语义随 bundle/revision 规范定义，v1 不赋义 |

## 3. 解析规则（现状即规范 v1）

来源事实：`core/parser/Parser.ts:49-61`（frontmatter 定界）、`Parser.ts:112-139`（`parseMetadata`）。

1. 文档**首行**为 `---` 时，至下一个独占行 `---` 之间为 frontmatter；否则整篇无 frontmatter。
2. 行级 `key: value` 解析。**这不是完整 YAML**：注释符是 `//`（不是 `#`）；值经 `autoConvert` 得到数字/布尔/字符串；不支持任意嵌套。
3. `var:` 独占一行开启变量块，其下 ≥2 空格缩进的 `key: value` 进入 `metadata.variables`。
4. **未知字段必须读入并保留**（现状 `parseMetadata` 已如此：未知 key 直接落到 metadata 上），不得报错——这是 KMD 多形态与未来字段的扩展缓冲。
5. 格式非法的行当前静默跳过；v2 应升级为 parser 诊断（`DiagnosticEvent`），不改变"不阻断播放"的容错性。

## 4. `mode` 的边界

runtime presentation mode 的权威枚举是 `stage / scroll / page`（`ReaderRuntimeContract.ts:5`）。两类偏离值的处理：

- **`paged`**：导入兼容别名，读入时归一化为 `page`。Android reader 已兼容双写；community-api 当前以 `paged` 为 canonical，需向本规范对齐（或在平台层维持 `paged` 但源文件校验按本表）。"canonical 是否翻转为 `paged`"作为开放项记录，不阻塞 v1。
- **`interactive`**：**不是合法的 runtime mode**。现状证据：Android `ReaderViewportPolicy` 把 `Interactive` 当 stage-like 处理，最终传给 Web runtime 的仍是 `"stage"`——它实际是 Work/能力层的形态标签，不是播放行为。v1 起 `.kmd` frontmatter 的 `mode: interactive` 视为未知值：降级为 `stage` + 诊断警告。承接它的 capability 声明设计悬置（见 `../../planning/ecosystem/presentation-modes-and-capability-layering-draft.md`）。

`mode` 的继任字段（`profile` / `capabilities` / `playback` 等）显式悬置：`mode` 越来越像过渡字段，但在多形态创作实践出现之前不引入新字段，v1 只钉住枚举与别名规则，保证未来可平滑迁移（未知字段保留规则即迁移缓冲）。

## 5. 写回规则（规范性，约束 editor 及一切改写 frontmatter 的宿主）

原则：**往返保真（round-trip fidelity）**——任何 UI 驱动的 frontmatter 改写，对未涉及的内容必须是恒等变换。

- **W1** 未知字段、字段顺序、注释必须保留。
- **W2** UI 控件只允许写回它声明负责的字段，采用合并式更新；**禁止整块替换 frontmatter**。
- **W3** 未被修改的字段不得被重新序列化成不同写法（引号风格、缩进、大小写）。
- **W4** T 层字段被 host settings 覆盖时，覆盖值不回写进源文件。

**违规现状（已修复）**：`editorStore.updateFrontMatter` 原用固定 6 字段整体替换 frontmatter——作者在 Inspector 改一次 mode/尺寸/字体，就会丢失 `title`、`speed`、`var:` 块及一切未知字段。已修复：改为"解析现有 frontmatter → 合并已变更键 → 按 W1/W3 序列化"（合并式写回，`editorStore.ts` + `core/parser/frontmatter.ts` 共享 core parser 解析逻辑，淘汰 store 内第二套正则）。另修复打开文件间接触发写回的链路（`syncConfigFromText` 修改 `canvasConfig` 触发 `canvasConfig` watcher → `updateFrontMatter`，W4 违规）——加 `isSyncingFromText` guard 阻断文本→UI 同步→写回；`designWidth`/`designHeight` 加字段级 number coercion（autoConvert 对带引号数字只去引号不转数字 → string 漏进 `canvasConfig`）。

## 6. 三端对齐清单

| 端 | 最小修正 |
| --- | --- |
| editor core | `KMDMetadata` 补声明 `bgColor` / `fontColor` / `fontFamily` / `kmdVersion`；核实 `fontSize` / `lineHeight`（接线或移除） |
| editor UI | 写回改合并式（§5 W1–W3）**已落地**；store 内独立 frontmatter 正则解析**已淘汰**（改用 `core/parser/frontmatter.ts` 共享解析）；打开文件→写回 W4 违规**已修复**（`isSyncingFromText` guard）；`designWidth`/`designHeight` number coercion **已修复** |
| Android reader | `paged → page` 归一化保留；`interactive` 按 Work 层标签处理（现状已是，补诊断） |
| community-api | `PresentationMode` 与 runtime 枚举解耦：平台层可保有 `interactive` 形态标签，但校验/生成源文件 frontmatter 时按本规范枚举 |

## 7. 悬置项（显式不在 v1 决策）

- **作者字段词汇表**：还没有有规模的 KMD 作品实践，作者字段需要边创作边验证；v1 只保留 `title` / `author` 两个最小项。
- **frontmatter 分区**（`runtime:` / `canvas:` / `authoring:`）：v1 保持扁平；若未来字段增多再评估，未知字段保留规则保证兼容。
- **`mode` 继任字段**：见 §4。
- **完整 YAML 兼容**：`//` vs `#` 注释、嵌套深度、多行值——若引入共享 parser/serializer（§5 修复方向）时一并评估。

## 8. 边界

- 不定义 `.kmdwork` / `work.json` manifest 字段 → `../architecture/work-bundle-format.md`。
- 不定义 `Work.presentation` 的派生算法与字段 → `../architecture/work-kmd-content-model.md`。
- 不定义多脚本场景下 entry/子脚本的 frontmatter 分工——多脚本语义未定稿，留待其设计文档。
