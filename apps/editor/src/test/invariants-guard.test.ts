// INV-7 / INV-8 守卫套件（支柱 3 / 收编 test-invariants.ts）。
//
// 收编自 src/test-invariants.ts，行为保持——只把断言搬进 vitest runner。
// - INV-7：stage modifier / effect 分流逻辑必须过已注册 helper（buildStageModifierRecord /
//   getTrack / classifyByTrack / isCharLevelEffect），禁止 inline 写 meta.modifierBased /
//   meta.track === "instant" / name === "cam.reset" 等分流特判。
// - INV-8：声称 GSAP/Pixi 边界行为的注释必须引 §B-bis 或附验证脚本路径，不准裸声称。
//
// 当前已知豁免：注释里标 INV-7-allow / INV-8-allow 可跳过（须附理由）。

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = join(import.meta.dirname, '..', '..');
const CORE = join(ROOT, 'src', 'core');

const INV7_STAGE_PATTERNS: { re: RegExp; label: string }[] = [
  { re: /if\s*\([^)]*meta(?:\.type|\?\.type)\s*===\s*["']filter["']\s*&&\s*meta(?:\.track|\?\.track)\s*===\s*["']instant["']/, label: 'block track 分流 inline（应过 EffectProcessor.getTrack/classifyByTrack，SA-17）' },
  { re: /if\s*\(\s*(?:stageManager\.getCommandMetadata\([^)]+\)\?\.modifierBased|isModifierBasedStageCommand)/, label: 'stage modifier 分流 inline（应过 buildStageModifierRecord，SA-14）' },
];

const INV8_BEHAVIOR_RE =
  /(GSAP|gsap|Pixi|pixi)\b[^*\n]{0,80}(零时长|同步触发.*onComplete|onComplete.*同步|不触发.*onComplete|onComplete.*不触发|抑制.*onComplete|onComplete.*抑制|immediateRender|overwrite.*语义|不递归.*destroy|destroy.*不递归|不自动.*destroy|destroy.*不自动|splice.*抛|configurable.*false|预乘|premultipl|vec3.*uniform|不.*驱动|不被.*驱动)/;
const INV8_OK_RE = /(§B-bis|已验证|INV-8|B-bis|已确认真相)/;

function listTs(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) out.push(...listTs(full));
    else if (name.endsWith('.ts')) out.push(full);
  }
  return out;
}

interface Violation {
  file: string;
  line: number;
  code: string;
  rule: string;
}

function collectViolations(): Violation[] {
  const violations: Violation[] = [];
  const allowRe = /(INV-7-allow|INV-8-allow)/;
  for (const file of listTs(CORE)) {
    const text = readFileSync(file, 'utf8');
    const lines = text.split('\n');
    lines.forEach((line, idx) => {
      if (allowRe.test(line)) return;
      for (const { re, label } of INV7_STAGE_PATTERNS) {
        if (re.test(line)) {
          violations.push({ file: relative(ROOT, file), line: idx + 1, code: line.trim(), rule: `INV-7: ${label}` });
        }
      }
      if (/\s(\/\/|\*)/.test(line) && INV8_BEHAVIOR_RE.test(line) && !INV8_OK_RE.test(line)) {
        violations.push({ file: relative(ROOT, file), line: idx + 1, code: line.trim().slice(0, 100), rule: 'INV-8: 边界行为注释未引 §B-bis / 已验证' });
      }
    });
  }
  return violations;
}

describe('runtime invariant guards (INV-7 / INV-8)', () => {
  it('no inline stage-modifier/effect-track dispatch (INV-7) and no unverified boundary-behavior comments (INV-8)', () => {
    const violations = collectViolations();
    if (violations.length > 0) {
      const report = violations.map((v) =>
        `  ${v.file}:${v.line} [${v.rule}]\n    ${v.code}`).join('\n');
      expect.fail(
        `[invariants] 发现 ${violations.length} 处违反：\n${report}\n\n` +
          `豁免：在该行加 INV-7-allow / INV-8-allow（须附理由）。`,
      );
    }
    expect(violations).toEqual([]);
  });
});