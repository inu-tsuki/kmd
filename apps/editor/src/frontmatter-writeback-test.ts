// @ts-nocheck
//
// Frontmatter 写回回归 —— 规范 docs/knowledge/language/frontmatter-schema.md §5 W1–W4。
// 不依赖 Pinia store 实例(避免 DOM/FS),直接复用 core parser 共享逻辑,复刻
// editorStore.syncConfigFromText / updateFrontMatter 的纯逻辑做断言。
//
// 运行:node --import tsx src/frontmatter-writeback-test.ts
//
// 覆盖:
//  a) 含 title/speed/var: 块/未知字段/注释的 frontmatter,UI 改 mode 后其余逐字节保留;
//  b) 无 frontmatter 的文档,UI 修改后正确插入新块;
//  c) syncConfigFromText 等价解析与 core parseMetadata 结果一致。

import {
  extractFrontMatterBlock,
  serializeFrontMatter,
  setField,
  getField,
  serializeUIValue,
  UI_FRONTMATTER_KEYS,
} from "./core/parser/frontmatter";
import { parser } from "./core/parser/Parser";

console.log("=== Frontmatter 写回回归 (规范 §5 W1–W4) ===");

let pass = 0;
let fail = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) {
    fail++;
    throw new Error(`Assertion Failed: ${msg}`);
  }
  pass++;
  console.log(`  ✅ ${msg}`);
}

// ---- 复刻 editorStore 的纯逻辑(无 Pinia/watch 副作用) ----

interface CanvasConfig {
  mode: string;
  width: number;
  height: number;
  bgColor: string;
  fontColor: string;
  fontFamily: string;
}

// 等价于 syncConfigFromText:从文本读 6 个 UI 字段进 canvasConfig(取 autoConvert 解析值)。
function syncConfigFromText(text: string, cfg: CanvasConfig): CanvasConfig {
  const next = { ...cfg };
  const block = extractFrontMatterBlock(text);
  if (!block) return next;
  const lines = block.lines;
  const mode = getField(lines, "mode");
  if (mode !== undefined) next.mode = mode;
  const designWidth = getField(lines, "designWidth");
  if (designWidth !== undefined) next.width = designWidth;
  const designHeight = getField(lines, "designHeight");
  if (designHeight !== undefined) next.height = designHeight;
  const bgColor = getField(lines, "bgColor");
  if (bgColor !== undefined) next.bgColor = bgColor;
  const fontColor = getField(lines, "fontColor");
  if (fontColor !== undefined) next.fontColor = fontColor;
  const fontFamily = getField(lines, "fontFamily");
  if (fontFamily !== undefined) next.fontFamily = fontFamily;
  return next;
}

// 等价于 updateFrontMatter:合并式写回 6 个 UI 键,未动行原样保留。
function updateFrontMatter(text: string, cfg: CanvasConfig): string {
  const block = extractFrontMatterBlock(text);
  const uiValues: Record<string, any> = {
    mode: cfg.mode,
    designWidth: cfg.width,
    designHeight: cfg.height,
    bgColor: cfg.bgColor,
    fontColor: cfg.fontColor,
    fontFamily: cfg.fontFamily,
  };

  if (block) {
    let lines = block.lines;
    for (const key of UI_FRONTMATTER_KEYS) {
      if (getField(lines, key) !== uiValues[key]) {
        lines = setField(lines, key, uiValues[key]);
      }
    }
    const fmText = serializeFrontMatter(lines);
    return block.body.length > 0
      ? `---\n${fmText}\n---\n${block.body}`
      : `---\n${fmText}\n---`;
  }
  const fmText = UI_FRONTMATTER_KEYS
    .map((key) => `${key}: ${serializeUIValue(key, uiValues[key])}`)
    .join("\n");
  return `---\n${fmText}\n---\n\n${text}`;
}

const DEFAULT_CFG: CanvasConfig = {
  mode: "stage",
  width: 1920,
  height: 1080,
  bgColor: "#000000",
  fontColor: "#ffffff",
  fontFamily: "Sasara Regular",
};

// ============ a) UI 改 mode,其余逐字节保留 ============
try {
  console.log("\n[a] UI 改 mode,frontmatter 其余内容逐字节保留 (W1/W3)");
  const original =
    "---\n" +
    "title: 演示脚本\n" +
    "mode: scroll\n" +
    "speed: 1.5\n" +
    "designWidth: 1920\n" +
    "designHeight: 1080\n" +
    "bgColor: \"#0a0a1a\"\n" +
    "fontColor: \"#ffffff\"\n" +
    "fontFamily: Noto Sans\n" +
    "// 这是作者注释,不能丢\n" +
    "kmdVersion: 0.1\n" +
    "var:\n" +
    "  hue: 200\n" +
    "  name: \"demo\"\n" +
    "---\n" +
    "\n" +
    "正文第一行\n" +
    "正文第二行\n";

  const cfg = syncConfigFromText(original, DEFAULT_CFG);
  assert(cfg.mode === "scroll", "sync 读出 mode=scroll");
  assert(cfg.width === 1920, "sync 读出 designWidth=1920");
  assert(cfg.height === 1080, "sync 读出 designHeight=1080");
  assert(cfg.bgColor === "#0a0a1a", "sync 读出 bgColor 去引号");
  assert(cfg.speed === undefined, "canvasConfig 不持有 speed(非 UI 字段)");

  // UI 把 mode 改成 stage(其余不变)
  const changedCfg = { ...cfg, mode: "stage" };
  const rewritten = updateFrontMatter(original, changedCfg);

  // 除 mode 行外,frontmatter 其余逐字节保留;整段正文不动。
  const origBlock = extractFrontMatterBlock(original)!;
  const newBlock = extractFrontMatterBlock(rewritten)!;
  assert(origBlock.lines.length === newBlock.lines.length, "frontmatter 行数不变");
  let modeLineChanged = false;
  for (let i = 0; i < origBlock.lines.length; i++) {
    const a = origBlock.lines[i].raw;
    const b = newBlock.lines[i].raw;
    if (a === b) continue;
    // 仅允许 mode 行变化
    assert(a.startsWith("mode: ") && b.startsWith("mode: "),
      `只有 mode 行允许变化,第 ${i + 1} 行: "${a}" → "${b}"`);
    assert(b === "mode: stage", "mode 行改写为 stage");
    modeLineChanged = true;
  }
  assert(modeLineChanged, "mode 行确实被改写");

  // 正文逐字节保留
  assert(origBlock.body === newBlock.body, "正文逐字节保留");

  // var: 块、注释、未知字段、title/speed 全在
  const fmText = serializeFrontMatter(newBlock.lines);
  assert(fmText.includes("// 这是作者注释,不能丢"), "注释保留 (W1)");
  assert(fmText.includes("kmdVersion: 0.1"), "未知字段 kmdVersion 保留 (W1)");
  assert(fmText.includes("title: 演示脚本"), "title 保留 (W1)");
  assert(fmText.includes("speed: 1.5"), "speed 保留 (W1)");
  assert(fmText.includes("var:"), "var: 块标记保留");
  assert(fmText.includes("  hue: 200"), "var 块条目(2 空格缩进)保留");
  assert(fmText.includes('  name: "demo"'), "var 块带引号写法保留 (W3)");

  // 再次 sync 应得到 stage(幂等,写回不改变非 mode 字段)
  const reSynced = syncConfigFromText(rewritten, DEFAULT_CFG);
  assert(reSynced.mode === "stage", "二次 sync 读回 mode=stage");
  assert(reSynced.bgColor === "#0a0a1a", "二次 sync bgColor 未变(W3 写法不变)");
  console.log("  🎊 [a] 通过");
} catch (e: any) {
  console.error(`\n❌ [a] 失败: ${e.message}`);
  process.exit(1);
}

// ============ b) 无 frontmatter,UI 修改后正确插入新块 ============
try {
  console.log("\n[b] 无 frontmatter 文档,UI 修改后插入新块 (W2)");
  const noFm = "正文第一行\n\n正文第二行\n";
  const cfg = { ...DEFAULT_CFG, mode: "page", width: 1080, height: 1920 };
  const rewritten = updateFrontMatter(noFm, cfg);

  assert(rewritten.startsWith("---\n"), "插入起始分隔符");
  const parts = rewritten.split("\n---\n", 2);
  assert(parts.length === 2, "存在闭合分隔符");
  const fmText = parts[0].replace(/^---\n/, "");
  const fmLines = fmText.split("\n");
  assert(fmLines.length === 6, "新块含 6 个 UI 字段");
  assert(fmLines.some((l) => l === "mode: page"), "新块 mode=page");
  assert(fmLines.some((l) => l === "designWidth: 1080"), "新块 designWidth=1080");
  assert(fmLines.some((l) => l === "designHeight: 1920"), "新块 designHeight=1920");
  assert(fmLines.some((l) => l === 'bgColor: "#000000"'), "新块 bgColor 带引号");
  assert(fmLines.some((l) => l === 'fontColor: "#ffffff"'), "新块 fontColor 带引号");
  assert(fmLines.some((l) => l === "fontFamily: Sasara Regular"), "新块 fontFamily 无引号");
  // 正文保留,块后有空行分隔
  assert(parts[1] === "\n正文第一行\n\n正文第二行\n", "正文在新块后逐字节保留,含分隔空行");

  // 二次 sync 应读到插入的值
  const reSynced = syncConfigFromText(rewritten, DEFAULT_CFG);
  assert(reSynced.mode === "page", "二次 sync 读回 mode=page");
  assert(reSynced.width === 1080, "二次 sync 读回 width=1080");
  assert(reSynced.height === 1920, "二次 sync 读回 height=1920");
  console.log("  🎊 [b] 通过");
} catch (e: any) {
  console.error(`\n❌ [b] 失败: ${e.message}`);
  process.exit(1);
}

// ============ c) syncConfigFromText 与 core parseMetadata 一致 ============
try {
  console.log("\n[c] store 侧解析与 core parseMetadata 结果一致");
  const src =
    "---\n" +
    "title: 一致性测试\n" +
    "mode: stage\n" +
    "designWidth: 1280\n" +
    "designHeight: 720\n" +
    "speed: 2\n" +
    "bgColor: \"#112233\"\n" +
    "fontColor: '#fff'\n" +
    "fontFamily: Noto Sans\n" +
    "maxWidth: 800\n" +
    "kmdVersion: 0.2\n" +
    "// 注释行\n" +
    "var:\n" +
    "  hue: 180\n" +
    "  scale: 1.5\n" +
    "---\n" +
    "正文\n";

  const coreMeta = parser.parse(src).metadata;
  const storeCfg = syncConfigFromText(src, DEFAULT_CFG);

  // 6 个 UI 字段一致
  assert(storeCfg.mode === coreMeta.mode, "mode 一致");
  assert(storeCfg.width === coreMeta.designWidth, "designWidth 一致");
  assert(storeCfg.height === coreMeta.designHeight, "designHeight 一致");
  assert(storeCfg.bgColor === coreMeta.bgColor, "bgColor 一致(autoConvert 去引号)");
  assert(storeCfg.fontColor === coreMeta.fontColor, "fontColor 一致(单引号去引号)");
  assert(storeCfg.fontFamily === coreMeta.fontFamily, "fontFamily 一致");

  // 非 UI 字段:store 不持有,但 core 应读入(未知字段保留)
  assert(coreMeta.title === "一致性测试", "core 读入 title");
  assert(coreMeta.speed === 2, "core 读入 speed=2(autoConvert 数字)");
  assert(coreMeta.maxWidth === 800, "core 读入 maxWidth(未知字段保留)");
  assert(coreMeta.kmdVersion === 0.2, "core 读入 kmdVersion(autoConvert 把 0.2 转数字,未知字段保留)");

  // var 块:variables 对象形状一致
  assert(coreMeta.variables && typeof coreMeta.variables === "object", "core 产出 variables 对象");
  assert(coreMeta.variables?.hue === 180, "core variables.hue=180");
  assert(coreMeta.variables?.scale === 1.5, "core variables.scale=1.5");

  // 空 frontmatter 文档:两端都不产出 UI 字段(core metadata 仍含初始 variables:{})
  const emptySrc = "仅正文\n";
  const emptyCore = parser.parse(emptySrc).metadata;
  const emptyStore = syncConfigFromText(emptySrc, DEFAULT_CFG);
  assert(emptyStore.mode === DEFAULT_CFG.mode, "无 frontmatter:store 保留默认值");
  assert(emptyCore.mode === undefined, "无 frontmatter:core 不设 mode");
  console.log("  🎊 [c] 通过");
} catch (e: any) {
  console.error(`\n❌ [c] 失败: ${e.message}`);
  process.exit(1);
}

console.log(`\n🎊 Frontmatter 写回回归: ${pass} passed, ${fail} failed`);
if (fail > 0) {
  console.error("❌ 写回归失败——frontmatter 往返保真被破坏。");
  process.exit(1);
}
console.log("✅ 写回回归通过:W1(未知字段/顺序/注释保留) + W2(合并式) + W3(写法不变) 锁定。");