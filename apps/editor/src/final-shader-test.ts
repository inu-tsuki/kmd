// @ts-nocheck
// Shader 编译门禁：从每个 *Filter.ts 提取 fragment shader 模板字符串，
// 用 glslangValidator 编译验证 GLSL ES 3.00 语法。
//
// 捕获 vue-tsc 无法触及的 GLSL 语法/作用域错（如函数嵌套定义、
// 未声明的 uniform、类型不匹配），防止"pnpm build 绿灯但 shader 不编译"。
//
// 运行: pnpm test:shaders
// 依赖: glslangValidator（系统安装）

import { readFileSync, readdirSync, writeFileSync, unlinkSync, existsSync } from "fs";
import { join } from "path";
import { execSync } from "child_process";

// preflight: glslangValidator 必须存在，否则所有 shader 会因"命令找不到"
// 被报成 fail，信息误导。提前检测并给出安装指引。
// 缺失时非零退出（门禁模式下不假绿），但允许 SKIP_SHADER_GATE=1 显式 opt-out
// （如 CI 无 glslang 但需跑其他门禁时）。
try {
  execSync("glslangValidator --version", { stdio: ["pipe", "pipe", "pipe"] });
} catch {
  if (process.env.SKIP_SHADER_GATE === "1") {
    console.warn("[shaders] SKIP_SHADER_GATE=1，跳过 shader 编译门禁。");
    process.exit(0);
  }
  console.error("[shaders] 未找到 glslangValidator，shader 编译门禁无法运行。");
  console.error("[shaders] 安装 glslang：brew install glslang / pacman -S glslang");
  console.error("[shaders] 或设 SKIP_SHADER_GATE=1 显式跳过（不推荐用于 PR 门禁）。");
  process.exit(1);
}

const filtersDir = join(import.meta.dirname, "core/filters");
const files = readdirSync(filtersDir).filter((f: string) => f.endsWith("Filter.ts"));

if (files.length === 0) {
  console.error("[shaders] 没有 *Filter.ts 文件，检查路径:", filtersDir);
  process.exit(1);
}

// glslangValidator 的 es profile 版本字符串
// --stdin -S frag 指定 stage；--es 使用 ES profile，--version 300 匹配 #version 300 es
// 但 glslangValidator 对 #version 300 es 需用 -G 或 --target-env 指定 ES。
// 实际：glslangValidator --stdin -S frag --es --version 300 < shader
// 各版本 CLI 略有差异，这里用最兼容的写法。

let passed = 0;
let failed = 0;
const failures: { file: string; error: string }[] = [];

for (const file of files) {
  const filePath = join(filtersDir, file);
  const source = readFileSync(filePath, "utf-8");

  // 提取 /* glsl */ `...` 模板字符串内的 fragment shader
  // 匹配 /* glsl */ 后跟反引号包围的内容（支持多行）
  const matches = source.matchAll(/\/\*\s*glsl\s*\*\/\s*`([\s\S]*?)`/g);
  let shaderIdx = 0;

  for (const match of matches) {
    shaderIdx++;
    let shader = match[1].trim();

    if (!shader.startsWith("#version")) {
      // 跳过非 GLSL 模板（如 CSS 字符串）
      continue;
    }

    // glslangValidator --stdin 需要文件扩展名推断 stage，
    // 但 --stdin 不支持指定 stage；用临时文件 + .frag 扩展名
    const tmpFile = `/tmp/kmd-shader-${file.replace(".ts", "")}-${shaderIdx}.frag`;
    writeFileSync(tmpFile, shader);

    try {
      // #version 300 es 在 shader 源码内声明 profile，glslangValidator 自动检测
      execSync(`glslangValidator "${tmpFile}"`, {
        stdio: ["pipe", "pipe", "pipe"],
        timeout: 10000,
      });
      passed++;
      console.log(`  ✓ ${file} shader #${shaderIdx}`);
    } catch (err: any) {
      failed++;
      const stderr = err.stderr?.toString() || err.message;
      failures.push({ file: `${file} #${shaderIdx}`, error: stderr });
      console.error(`  ✗ ${file} shader #${shaderIdx} — COMPILE FAILED`);
      console.error(`    ${stderr.split("\n").slice(0, 5).join("\n    ")}`);
    } finally {
      if (existsSync(tmpFile)) unlinkSync(tmpFile);
    }
  }
}

console.log("");
console.log(`[shaders] ${passed} passed, ${failed} failed (${files.length} files)`);

if (failed > 0) {
  console.error("\n=== 失败详情 ===");
  for (const f of failures) {
    console.error(`\n--- ${f.file} ---`);
    console.error(f.error);
  }
  process.exit(1);
}