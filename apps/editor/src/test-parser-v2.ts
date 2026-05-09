
import { parser } from "../src/core/parser/Parser";

const testCases = [
  // 1. 管道符带参数
  "停顿测试|(2s)结束",

  // 2. 无括号行末指令补位
  "这一行没有括号但有指令 @ cam.move(100, 100)! cam.zoom(2)",

  // 3. 混合语法糖：管道符 + 变量 + 感叹号
  "{变量测试} @ f.red.hold(var.delay)!.blue",

  // 4. 纯指令行
  "@ cam.reset(1s)!",

  // 5. 段落级复杂指令
  "[cam.zoom(0.5)! align=center] 内容"
];

testCases.forEach((input, i) => {
  console.log(`
=== Test Case ${i + 1}: ${input} ===`);
  const result = parser.parse(input);

  // 如果有元数据或全局效果，打印出来
  if (result.metadata && Object.keys(result.metadata.variables || {}).length) {
    console.log("Metadata Variables:", JSON.stringify(result.metadata.variables));
  }
  const firstParagraph = result.paragraphs[0];
  if (!firstParagraph) return;

  if (firstParagraph.globalEffects.length) {
    console.log("Global/Block Effects:", JSON.stringify(firstParagraph.globalEffects));
  }

  firstParagraph.tokens.forEach((t, j) => {
    // 过滤掉换行符 Token
    if (t.content === "\n") return;

    console.log(`Token ${j} [${t.content}]:`);
    if (t.effects.length) console.log("  Effects:", JSON.stringify(t.effects));
    if (t.layoutInstructions.length) console.log("  Layout:", JSON.stringify(t.layoutInstructions));
  });
});
