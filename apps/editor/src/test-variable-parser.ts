
import { parser } from "../src/core/parser/Parser";

const kmdWithVars = `---
title: 变量测试脚本
mode: stage
var:
  my_speed: 100
  base-scale: 1.5
  intro_x: -200
---

[cam.move(var.intro_x, 0)]
{文字} @ up(var.my_speed) cam.zoom(var.base-scale)!
`;

console.log("=== Testing KMD with Metadata & Variables ===");
const result = parser.parse(kmdWithVars);

console.log("\n1. Metadata & Variables Check:");
console.log("Metadata:", JSON.stringify(result.metadata, null, 2));

console.log("\n2. Paragraph Instruction Check:");
const p = result.paragraphs[0]!;

console.log("Block Options Stage Instructions:");
// 检查 [cam.move(var.intro_x, 0)] 是否保留了原始变量名
console.log(JSON.stringify(p.blockOptions));
// 注意：目前解析器将 blockOptions 中的 cam.move 存在了 globalEffects 里
console.log("Global Effects:", JSON.stringify(p.globalEffects));

console.log("\n3. Token Instruction Check:");
p.tokens.forEach((t) => {
  if (t.content.trim()) {
    console.log(`Token [${t.content}]:`);
    console.log("  Effects (Expect var.base-scale):", JSON.stringify(t.effects));
    console.log("  Layout (Expect var.my_speed):", JSON.stringify(t.layoutInstructions));
  }
});
