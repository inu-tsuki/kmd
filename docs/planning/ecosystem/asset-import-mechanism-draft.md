# Asset Import Mechanism Draft

> 文档状态：草案 / 初步想法（未立项）
> 最近更新：2026-06-25
> 触发来源：DIP 滤镜库需要 `bg(image)` 作为色调族滤镜的连续色调验证表面 / demo 背景，牵出「KMD 怎么引入外部图像资产」此前无规划
> 相关：`special-commands-vocabulary-draft.md`（`bg` 命令）、`reading-experience-vision-draft.md`（背景图表面）、`../apps/editor-dip-effect-library.md` §8.2、`packages/reader-runtime-web.md`（reader 资产策略）、`../../knowledge/architecture/work-kmd-content-model.md`（.kmd 与 Work 事实边界）

## 0. 这份文档要回答什么

KMD 内容要引用外部资产——字体（已做）、**图像**（背景图、displace 位移贴图、lut 调色纹理）、未来音频/视频。本文件回答：**KMD 怎么声明、解析、加载、并安全地引入这些资产**，以及当前地基到哪一步、还缺什么。

核心结论先行：**资产地基是资产无关的、且合同层已为图片备好——缺的是图片的「加载器 + KMD 声明入口 + 把安全闸用到图片 URL」这三件有界工作，不是架构难题。**

> 本文是机制规划，不是近期实施计划。`bg(image)` 的「编辑器-dev 级」最小验证路径不必等本文件完成（见 §4）。立项触发见 §8。

## 1. 为什么单独放这里

资产引入横跨三方，埋进任一处都会失焦：

- **editor（作者侧）**：作者从哪拿到图？本地上传、URL 引用、还是随作品资源库管理。
- **reader-runtime（运行/安全侧）**：`.kmd` 在 reader/WebView 里是**不可信内容**，让它加载任意 URL 是注入面，须经资产策略闸。
- **Work / community（发布侧）**：发布的作品资产从哪托管、`assetManifest` 怎么生成（与 `work-presentation-generation-draft` 的派生链同源问题）。

故抽到 ecosystem 生态目录。

## 2. 现状盘点（已核对代码）

### 2.1 资产无关的地基（`core/runtime/RuntimeAssetPolicy.ts`）
- `resolveRuntimeAssetUrl(url, ctx)`：把相对路径解析到 `assetBaseUrl`——**非字体专用**，任何资产可用。
- `resolveControlledSourceUrl(url, ctx)`：**安全闸**——只放行 `assetBaseUrl` 白名单内、或 https、或同源 http/https，否则 `throw Blocked uncontrolled sourceUrl`。目前用于 `.kmd` source URL，模型对图片同样适用。
- `RuntimeAssetContext` = `{ assetBaseUrl, fontManifest, assetManifest }`。

### 2.2 合同层已为图片备好（`core/runtime/ReaderRuntimeContract.ts`）
- `ReaderRuntimeAssetRef = { url, type?: "font"|"image"|"shader"|"audio"|"video"|"data", integrity?, metadata? }`——**`image`/`shader`/`audio`/`video` 枚举已在**，`integrity` 为 SRI 校验预留。
- `ReaderRuntimeAssetManifest = { baseUrl?, fonts?, assets?: Record<string, ReaderRuntimeAssetRef> }`——**已有通用 `assets` 映射**，不止 fonts。
- `assets` 映射**已被消费**：`ReaderRuntimeSession.resolveManifestSourceUrl`（`:363`）用它按 key 解析 source 脚本 URL——证明该通道已接进 runtime。

### 2.3 已落地的资产范式：字体（`core/App.ts`）
完整链路可抄：`collectRuntimeFonts(manifest)` 声明 → `resolveRuntimeAssetUrl` 解析 → FontFace API（首选）+ `Assets.load` 回退加载 → `loadedFontFamilies` Set 去重。

### 2.4 缺什么（图片）
- **图片加载器**：core 里 `Assets.load` 仅字体用（grep 确认）；无「读 `type:"image"` 条目 → `Assets.load` → `Texture` → `Sprite`」路径。
- **KMD 声明入口**：`.kmd` 怎么引用一张图？无 frontmatter 图字段、无 `bg(src)` 命令（special-commands 草案 §3）。
- **安全闸应用到图片**：`resolveControlledSourceUrl` 模型在，但未对图片 URL 调用。
- **作者图来源**：本地上传 / URL / 随 Work 发布，未定（§5.2）。

## 3. 资产类型矩阵

| 类型 | 现状 | 用途 | 加载方式 |
|---|---|---|---|
| 字体 font | ✅ 已落地 | 文本渲染 | FontFace + `Assets.load`（App.ts） |
| 图像 image | 🟡 合同备好，加载器缺 | `bg(image)`、displace 贴图、lut 纹理 | Pixi `Assets.load` → `Texture` → `Sprite`/uniform |
| 着色器 shader | 🔵 枚举在，未用 | 自定义滤镜外部 shader？（通常内联，未必需要） | — |
| 音频 audio | 🔵 枚举在，未用 | `bgm`/`sfx`（special-commands §4.5） | 须单独论证（资源/许可面大） |
| 视频 video | 🔵 枚举在，未用 | 动态背景？ | 远期 |
| 数据 data | 🔵 枚举在，未用 | lut 数据、配置 | — |

近期焦点只有 **image**。

## 4. 两段成熟度（决定怎么即刻解锁验证）

| 级别 | 做什么 | 解锁 | 是否依赖本机制完整落地 |
|---|---|---|---|
| **编辑器-dev 级** | 从 `public/` 直接 `Assets.load(path)` → `Sprite` 挂 `StageManager.backgroundLayer`，**不走 manifest/安全闸** | 即刻验证（DIP 色调族放真实画面、文字叠图读感） | 否——可先行（见 special-commands §10 交接） |
| **阅读器-硬化级** | manifest `assets` 声明 image 条目 → 解析 → `resolveControlledSourceUrl` 闸 → 加载器 → 去重缓存 | 产品级、可发布、reader 安全 | 是——本机制 epic |

**原则**：编辑器-dev 级是「让它在编辑器里能用」，阅读器-硬化级是「让它在 reader 里安全可移植」——与仓库一贯的 editor-only vs reader-gated 分层一致（CLAUDE.md 运行时边界）。

## 5. 设计决策点（阅读器-硬化级）

### 5.1 KMD 怎么声明图片
三个候选，可并存：
- **命令引用**：`bg(src="scene.jpg")`，路径经 `resolveRuntimeAssetUrl` 解析到 `assetBaseUrl`（最贴近 `bg` 用例）。
- **frontmatter 字段**：类似 `fontFamily`，全篇默认背景。
- **manifest key 引用**：`.kmd` 写逻辑名 `bg(asset="hero")`，由 `assetManifest.assets["hero"]` 解析真实 URL（最安全——作者只能引用已声明资产，对齐 source URL 现有做法）。

倾向 **manifest key 引用为安全主路径**，直接 URL 仅在 dev/同源放行（复用 `resolveControlledSourceUrl` 逻辑）。

### 5.2 作者图从哪来
- editor 本地上传 → 存哪、怎么进 `assetManifest`。
- 直接 URL（同源/https）。
- 随 Work revision 发布（与 `work-presentation-generation-draft` 的 `.kmd→Work.presentation` 派生链同源——资产清单应是派生事实，不手写两份）。

### 5.3 安全
- `.kmd` 不可信 → 默认只放行 manifest 声明过的资产 + https/同源，沿用 `resolveControlledSourceUrl`。
- `integrity` 字段已在合同里 → 可选 SRI 校验。
- reader/WebView 的 CSP 与此对齐（`android-webview-runtime-protocol` 须核对）。

### 5.4 加载 / 缓存 / 生命周期
- Pixi `Assets.load` + alias 去重（抄 `loadedFontFamilies` 范式）。
- 何时加载：preflight 预载（避免播放中闪烁）vs 懒加载。
- 释放：`scene.clear` / 切背景 / dispose 时 `Texture.destroy`，避免 GPU 泄漏（与 DIP filter 的 `destroy()` 纪律一致）。

## 6. 与现有文档/事实的关系

| 关注点 | 文档 |
|---|---|
| `bg` 命令词汇表（声明入口三身份） | `special-commands-vocabulary-draft.md` §3 |
| 背景图作可读性表面（bg.* 处理） | `reading-experience-vision-draft.md` §3 |
| DIP 色调族验证依赖、两段成熟度 | `../apps/editor-dip-effect-library.md` §6.1 / §8.2 |
| 资产清单作派生事实（不手写） | `work-presentation-generation-draft.md` |
| .kmd 与 Work 事实边界 | `../../knowledge/architecture/work-kmd-content-model.md` |
| reader 资产策略 / WebView 安全 | `packages/reader-runtime-web.md`、`../../knowledge/integration/android-webview-runtime-protocol.md` |

## 7. 开放项

- 声明通道定哪条主路径（§5.1，倾向 manifest key）。
- 作者图来源与 Work 发布的派生关系（§5.2）。
- preflight 预载 vs 懒加载、加载失败的占位/降级。
- 图片之外，displace 位移贴图 / lut 纹理是否复用同一图片通道（很可能是——都是 `type:"image"`，只是消费方不同）。
- 音频（special-commands §4.5）是否纳入本机制还是单列——倾向单列，资源/许可面差异大。

## 8. 立项触发条件

满足任意两条可升正式规划：

- M2 demo 实际需要背景图（underwater / 叙事成片很可能最先触发）。
- reading-experience 的背景可读性处理（bg.brightness/blur）要落地。
- community/Work 发布链需要作品携带图像资产。

## 9. 相关文档

- `special-commands-vocabulary-draft.md` —— `bg` 命令与声明入口。
- `reading-experience-vision-draft.md` —— 背景图作阅读基底表面。
- `../apps/editor-dip-effect-library.md` §6.1 / §8.2 —— DIP 验证表面依赖。
- `work-presentation-generation-draft.md` —— 资产清单作派生事实。
- `repository-strategy.md` —— 重资产（音频）拆包/插件化门槛。
