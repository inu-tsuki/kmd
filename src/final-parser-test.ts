// @ts-nocheck
import { parser } from "./core/parser/Parser";
import * as fs from "fs";
import * as path from "path";

console.log("=== KMD Final Parser Integration Test (Revised for Report 5.x) ===");

function assert(condition: boolean, message: string) {
    if (!condition) {
        throw new Error(`Assertion Failed: ${message}`);
    }
    console.log(`  ✅ ${message}`);
}

try {
    const kmdPath = path.resolve(process.cwd(), "public/final-test.kmd");
    const kmdSource = fs.readFileSync(kmdPath, "utf-8");
    
    const result = parser.parse(kmdSource);
    
    // 5.0 验证 BlockOptions 中的 align=center
    const p1 = result.paragraphs[0];
    assert(p1.blockOptions.align === "center", "Line 15: BlockOptions should contain align=center");
    assert(p1.globalEffects.some(e => e.name === "cam.zoom"), "Line 15: BlockOptions should contain 'cam.zoom'");

    // 5.1 验证时序链与糖衣并存
    const p2 = result.paragraphs.find(p => p.tokens.some(t => t.content.includes("准备")));
    const tokenReady = p2?.tokens.find(t => t.content.includes("准备"));
    assert(tokenReady?.effects.some(e => e.name === "red"), "Line 19: '准备' should have red effect");
    assert(tokenReady?.effects.some(e => e.name === "hold"), "Line 19: '准备' should have hold effect");

    // 5.2 验证排版指令
    const pLayout = result.paragraphs.find(p => p.tokens.some(t => t.content.includes("屏幕中间")));
    assert(!!pLayout, "Line 33: Should find layout paragraph");
    const firstTextToken = pLayout.tokens.find(t => t.content.trim());
    assert(firstTextToken?.layoutInstructions.some(i => i.type === "up"), "Line 33: 'up' instruction missing on first text token");

    // 验证空行镜头指令
    const pCam = result.paragraphs.find(p => p.globalEffects.some(e => e.name === "cam.move"));
    assert(!!pCam, "Line 38: Empty line with @ cam.move should produce globalEffect");

    // 验证速度语法糖 (~, ^) 与 braceGroupId
    const pSugar = result.paragraphs.find(p => p.tokens.some(t => t.content.includes("语速")));
    assert(pSugar?.tokens.some(t => t.sugar && t.sugar.length > 0 && t.sugar[0].name === "slow"), "Line 59: Standalone slow sugar (~) missing or name incorrect");
    
    const waveToken = pSugar?.tokens.find(t => t.content.includes("语速"));
    assert(waveToken?.isBraced === true, "Line 59: '语速' should be marked as isBraced");
    assert(waveToken?.braceGroupId !== undefined, "Line 59: '语速' should have a braceGroupId");
    
    // 验证组内映射：'变' 应该也有 wave 效果
    const slowToken = pSugar?.tokens.find(t => t.content.includes("变"));
    assert(slowToken?.effects.some(e => e.name === "wave"), "Line 59: '变' should inherit wave effect via group mapping");

    // 验证多 Token 对应 (Line 43)
    const pMulti = result.paragraphs.find(p => p.tokens.some(t => t.content.includes("多个")));
    assert(!!pMulti, "Line 43: Should find multi-token paragraph");
    assert(pMulti.tokens.find(t => t.content.includes("多个"))?.effects.some(e => e.name === "red"), "Multi-mapping: '多个' should be red");

    const paragraphBroadcast = parser.parse("[.wave]\n{AB}\nCD").paragraphs[0];
    assert(paragraphBroadcast.globalEffects.every(e => e.name !== "wave"), "Paragraph [.wave] should not stay in globalEffects");
    const visualTokens = paragraphBroadcast.tokens.filter(t => t.content.trim());
    assert(visualTokens.length === 2, "Paragraph [.wave] should preserve both text tokens");
    assert(visualTokens.every(t => t.effects.some(e => e.name === "wave")), "Paragraph [.wave] should broadcast wave to all text tokens");

    assert(!!paragraphBroadcast.ast, "Paragraph parse should expose AST");
    assert(!!paragraphBroadcast.ir, "Paragraph parse should expose IR");

    const quotedParagraph = parser.parse("// quote\ntext1 >>> text1\n\ntext2").paragraphs[0];
    assert(quotedParagraph.tokens[0]?.content !== "\n", "Pure comment line should not emit a leading newline token");
    assert(quotedParagraph.tokens.every(t => t.line !== 0), "Pure comment line should not shift visible tokens onto a synthetic line");

    const singleAtResult = parser.parse("@");
    assert(singleAtResult.paragraphs.length === 0, "Standalone '@' line should be ignored as empty command-only input");

    fs.writeFileSync("parser-output.json", JSON.stringify(result, null, 2), "utf-8");
    console.log("\n🎊 Parser state validated against Report 5.x specifications.");
} catch (e: any) {
    console.error("\n❌ Test Failed!");
    console.error(e.message);
    process.exit(1);
}
