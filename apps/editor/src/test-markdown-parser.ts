// @ts-nocheck
import { parser } from "./core/parser/Parser";

console.log("=== KMD Markdown Syntax Integration Test ===");

function assert(condition: boolean, message: string) {
    if (!condition) {
        throw new Error(`Assertion Failed: ${message}`);
    }
    console.log(`  ✅ ${message}`);
}

const kmdSource = `
# 这是标题

这是**重音**文字。
这是*轻声*文字。

---

这是转场后的文字。
`;

try {
    const result = parser.parse(kmdSource);

    // 1. 验证标题 (#)
    const p1 = result.paragraphs[0];
    assert(p1.tokens.some(t => t.effects.some(e => e.name === "special")), "Heading (#) should apply 'special' effect");

    // 2. 验证加粗 (**)
    const p2 = result.paragraphs[1];
    console.log("Tokens in p2:", p2.tokens.map(t => t.content));
    const boldToken = p2.tokens.find(t => t.content === "重音");
    assert(!!boldToken, "Should find '重音' token");
    assert(boldToken.effects.some(e => e.name === "bold"), "'重音' should have 'bold' effect");
    assert(boldToken.sugar.some(s => s.name === "slow"), "'重音' should have 'slow' sugar");

    // 3. 验证斜体 (*)
    const italicToken = p2.tokens.find(t => t.content === "轻声");
    assert(!!italicToken, "Should find '轻声' token");
    assert(italicToken.effects.some(e => e.name === "thin"), "'轻声' should have 'thin' effect");
    assert(italicToken.effects.some(e => e.name === "dim"), "'轻声' should have 'dim' effect");
    assert(italicToken.sugar.some(s => s.name === "fast"), "'轻声' should have 'fast' sugar");

    // 4. 验证分割线 (---)
    const pClear = result.paragraphs.find(p => p.tokens.some(t => t.isSceneClear));
    assert(!!pClear, "Should find paragraph with isSceneClear");
    assert(pClear.tokens.some(t => t.layoutInstructions.some(i => i.type === "pause")), "--- should have pause instruction");

    console.log("\n🎊 Markdown syntax parsing validated successfully.");
} catch (e: any) {
    console.error("\n❌ Test Failed!");
    console.error(e.message);
    process.exit(1);
}
