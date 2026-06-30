// @ts-nocheck
/**
 * INV-7 / INV-8 守卫脚本（F-4）。
 *
 * 把两条人肉 checklist 升级为可执行检查：
 * - INV-7：stage modifier / effect 分流逻辑必须过已注册 helper（buildStageModifierRecord /
 *   getTrack / classifyByTrack / isCharLevelEffect），禁止在 global/inline/token-chain 路径里
 *   inline 写 `meta.modifierBased` / `meta.track === "instant"` / `name === "cam.reset"` 等分流特判。
 * - INV-8：声称 GSAP/Pixi 边界行为的注释必须引 §B-bis（"已验证外部依赖行为"清单）或附验证脚本路径，
 *   不准裸声称（如 "GSAP ... 会 ..." / "Pixi ... 不 ..." 无 §B-bis 引用）。
 *
 * 跑法：`pnpm test:invariants`（node --import tsx src/test-invariants.ts）。
 * 退出码：0 = 通过，1 = 有违反。
 *
 * 当前已知豁免（注释里标 `INV-7-allow` / `INV-8-allow` 可跳过，需附理由）。
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = join(import.meta.dirname ?? ".", "..");
const CORE = join(ROOT, "src", "core");

// ── INV-7：禁止 inline 分流特判（必须过 helper）─────────────────────────
// stage modifier 分流：cam.reset / modifierBased 必须经 buildStageModifierRecord。
// 只标记**分流条件**（if/else if 里读 metadata 做 modifier-based / cam.reset 判定），
// 不标记 propertyKey 查询器（getStagePropertyKey 是集中 helper，非 inline 分流）。
const INV7_STAGE_PATTERNS: { re: RegExp; label: string }[] = [
  // block track 分流里直接读 metadata 做 if（应过 EffectProcessor.getTrack/classifyByTrack，SA-17）
  { re: /if\s*\([^)]*meta(?:\.type|\?\.type)\s*===\s*["']filter["']\s*&&\s*meta(?:\.track|\?\.track)\s*===\s*["']instant["']/, label: "block track 分流 inline（应过 EffectProcessor.getTrack/classifyByTrack，SA-17）" },
  // stage modifier 分流：if 里读 modifierBased（应过 buildStageModifierRecord，SA-14）。
  // 限定 `if (` 开头避免误标 getStagePropertyKey 这类 propertyKey 查询器。
  { re: /if\s*\(\s*(?:stageManager\.getCommandMetadata\([^)]+\)\?\.modifierBased|isModifierBasedStageCommand)/, label: "stage modifier 分流 inline（应过 buildStageModifierRecord，SA-14）" },
];

// ── INV-8：边界行为注释须引 §B-bis ────────────────────────────────────────
// 声称 GSAP/Pixi 的**边界行为**（非一般 API 用法），但没引 §B-bis / 已验证 / INV-8。
// 须命中边界行为关键词（零时长/onComplete 时机/kill 抑制/destroy 递归/splice/configurable/预乘/vec3），
// 避免误标记一般架构说明（如"用 GSAP ticker 而非 Pixi shared ticker"是设计选择非边界行为）。
const INV8_BEHAVIOR_RE =
  /(GSAP|gsap|Pixi|pixi)\b[^*\n]{0,80}(零时长|同步触发.*onComplete|onComplete.*同步|不触发.*onComplete|onComplete.*不触发|抑制.*onComplete|onComplete.*抑制|immediateRender|overwrite.*语义|不递归.*destroy|destroy.*不递归|不自动.*destroy|destroy.*不自动|splice.*抛|configurable.*false|预乘|premultipl|vec3.*uniform|不.*驱动|不被.*驱动)/;
const INV8_OK_RE = /(§B-bis|已验证|INV-8|B-bis|已确认真相)/;

interface Violation {
  file: string;
  line: number;
  code: string;
  rule: string;
}

function listTs(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) out.push(...listTs(full));
    else if (name.endsWith(".ts")) out.push(full);
  }
  return out;
}

const violations: Violation[] = [];
const allowRe = /(INV-7-allow|INV-8-allow)/;

for (const file of listTs(CORE)) {
  const text = readFileSync(file, "utf8");
  const lines = text.split("\n");
  lines.forEach((line, idx) => {
    if (allowRe.test(line)) return; // 显式豁免

    // INV-7
    for (const { re, label } of INV7_STAGE_PATTERNS) {
      if (re.test(line)) {
        violations.push({ file: relative(ROOT, file), line: idx + 1, code: line.trim(), rule: `INV-7: ${label}` });
      }
    }

    // INV-8：只检注释行（含 // 或 *）
    if (/\s(\/\/|\*)/.test(line) && INV8_BEHAVIOR_RE.test(line) && !INV8_OK_RE.test(line)) {
      violations.push({ file: relative(ROOT, file), line: idx + 1, code: line.trim().slice(0, 100), rule: "INV-8: 边界行为注释未引 §B-bis / 已验证" });
    }
  });
}

if (violations.length === 0) {
  console.log("[invariants] INV-7 + INV-8 守卫通过：无 inline 分流特判、无未验证边界行为注释。");
  process.exit(0);
} else {
  console.error(`[invariants] 发现 ${violations.length} 处违反：`);
  for (const v of violations) {
    console.error(`  ${v.file}:${v.line} [${v.rule}]`);
    console.error(`    ${v.code}`);
  }
  console.error("\n豁免：在该行加 `INV-7-allow` / `INV-8-allow`（须附理由）。");
  process.exit(1);
}