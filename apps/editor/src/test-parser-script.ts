
import { parser } from "../src/core/parser/Parser";

const testCases = [
  "{红字} {蓝字} @ f.red f.blue(alpha=0.5)",

  // 2. 混合布局指令与格式化指令
  "{跳} {走} @ cam.move(100) f.jump(h=20) f.wave",

  // 3. 多组 Token，但指令数量不足 (检查自动降级/跳过)
  "{A} {B} {C} @ f.red",

  // 4. 复杂参数与点链
  "{复杂} @ f.shake(strength=10).red.blur(s=5)",

  // 5. subline 模式：无括号，末尾 f. 链 (应应用于全行或首个 Token)
  "这一行都是红色的 @ f.red"
];

testCases.forEach((input, i) => {
  console.log(`
=== Test Case ${i + 1}: ${input} ===`);
  // 使用新的全量解析，并获取第一个段落
  const result = parser.parse(input);
  const p = result.paragraphs[0]!;

  p.tokens.forEach((t, j) => {
    if (t.content.trim()) {
      console.log(`Token ${j} [${t.content}]:`);
      if (t.effects.length) console.log("  Effects:", JSON.stringify(t.effects));
      if (t.layoutInstructions.length) console.log("  Layout:", JSON.stringify(t.layoutInstructions));
    }
  });
});
