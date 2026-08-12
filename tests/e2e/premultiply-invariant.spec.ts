import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import {
  attachRuntimeEventRecorder,
  repoRoot,
  sendRuntimeCommand,
  waitForEvent,
} from './helpers';

// 预乘 alpha 库边界裁决探针（主题一：织网 S6 / §B-bis 唯一 ⚠️ 行）。
//
// 待裁决事实：Pixi v8 的 filter 输入纹理**是否预乘 alpha**。约 15 个点运算滤镜
//（GrayFilter 模板，core/filters/*Filter.ts）的「c.rgb / c.a → 运算 → result * c.a」包络
// 承重于此假设。两条证据链：
//   (a) 源码引用：pixi FilterSystem.js 的 filter 链输出面显式
//       `outputTexture.source.alphaMode = "premultiplied-alpha"`（v8.15，行号见
//       premultiply-source-gate.test.ts——该 vitest 门禁在 CI 钉死此行，pixi 升级若移除即红）。
//   (b) 经验像素裁决（本 spec）：真实 WebGL 渲染半透明像素 + 真实 GrayFilter 着色器，
//       读回数值判别。源码与像素两证一致 → CONFIRMED。
//
// 判别设计（白底上半透明红矩形，经真实 GrayFilter 着色器后像素读回）：
//   - 半透明红（straight (1,0,0) @α0.5 → 预乘存储 (0.5,0,0,0.5)）画在白底上。
//   - GrayFilter 着色器读 c.rgb/c.a：
//     输入**预乘**：除回 (1,0,0) → luma 0.299 → 输出预乘 0.1495@α0.5 → 白底合成
//     0.1495+0.5 = 0.6495 → **灰度 ≈166**。
//     输入**直输**（(1,0,0,0.5)）：c.rgb/c.a = (2,0,0) → luma 0.598 → 0.299@0.5 →
//     0.299+0.5 = 0.799 → **灰度 ≈204**。
//   两假设数值分离（166 vs 204，容差带不重叠）→ 单次读回即裁决。
//
// 探针构造（bundle 不导出 PIXI 类 → 从现场 filter 实例拾取类身份）：
//   - Filter / GlProgram 类：从场景中任一滤镜实例（donor，由 `{B} @ f.pixelate` 产生）的
//     原型链与 .glProgram.constructor 取得。**不按名字识别**：生产 bundle 经 vite minify，
//     constructor.name 不稳定（实测 PixelateFilter → "P_"）——donor 只需要是个 Filter 实例。
//   - vertex 源：node 侧读 pixi 安装的 defaultFilter.vert.js（与运行时同源，零手抄）。
//   - fragment 源：node 侧用 shader-gate 同款正则从 core/filters/GrayFilter.ts 提取
//     （探针永远测**当前生产着色器**，源文件演进自动跟随）。
//   - gray 滤镜不能走 KMD 路由：gray 双重身份（styleManager + effectManager），char/block 级
//     经 classifyCommand 落 style lane 不产生滤镜实例（仅 :bg 走 effect lane，但 bg 精灵不透明
//     α=1 无判别力）——故探针手动把构造的 GrayFilter 挂到 box Graphics 层（测量手段，非产品面）。
//
// 裁决即交付（verify-then-write）：
//   - ≈166 → CONFIRMED → GrayFilter.ts:22 等 15 处注释转「已验证于 Pixi v8.15」引用
//     （过 INV-8/INV8_OK_RE），§B-bis 行 ⚠️→✅，结果记 commit + planning note。
//   - ≈204 → 有意失败（FALSIFIED：~15 滤镜除法步骤需返工，S6b）。沉默通过两种结果是探针大忌。
//   - 第三态 → 诊断失败，人工调查。
//
// 本 spec 永久保留：防 pixi 升级静默改变 filter 面格式（与 premultiply-source-gate 双保险）。

const SOURCE = [
  '---',
  'mode: stage',
  'designWidth: 1920',
  'designHeight: 1080',
  '---',
  '',
  '@ bg(color="#ffffff")',
  '[.box:block(color="#ff0000", alpha=0.5, padding=40)]',
  '{A}',
  '',
  '[.box:block(color="#ff0000", alpha=0.5, padding=40)]',
  '{B} @ f.pixelate',
].join('\n');

/** 从安装的 pixi 提取 defaultFilterVert 源（与运行时同源，零手抄）。 */
function loadDefaultVertexSource(): string {
  const file = fs.readFileSync(
    path.join(repoRoot, 'apps/editor/node_modules/pixi.js/lib/filters/defaults/defaultFilter.vert.js'),
    'utf8',
  );
  const match = file.match(/var vertex = "((?:[^"\\]|\\.)*)";/);
  if (!match) throw new Error('defaultFilter.vert.js 形状变化——探针需更新');
  return JSON.parse(`"${match[1]}"`) as string;
}

/** 从生产源提取 GrayFilter fragment（shader-gate 同款正则，永远测当前着色器）。 */
function loadGrayFragmentSource(): string {
  const file = fs.readFileSync(path.join(repoRoot, 'packages/core/src/filters/GrayFilter.ts'), 'utf8');
  const match = file.match(/\/\*\s*glsl\s*\*\/\s*`([\s\S]*?)`/);
  if (!match) throw new Error('GrayFilter.ts 未找到 /* glsl */ 块——探针需更新');
  return match[1];
}

type ProbeResult = {
  pixelateFound: boolean;
  boxFound: boolean;
  sanity: number[] | null;   // 段 1 无滤镜矩形像素（预期 ≈ [255,127,127]）
  verdict: number[] | null;  // 段 2 GrayFilter 后矩形像素（≈166 预乘 / ≈204 直输）
  debug: string;
};

test('pixi v8 filter input texture premultiplication verdict (§B-bis)', async ({ page }) => {
  const vertexSrc = loadDefaultVertexSource();
  const fragmentSrc = loadGrayFragmentSource();

  await attachRuntimeEventRecorder(page);
  await page.goto('/');
  await waitForEvent(page, 'runtimeReady');

  await sendRuntimeCommand(page, 'loadScript', {
    source: SOURCE,
    work: { id: 'premultiply-probe', title: 'premultiply probe' },
  });
  const ready = await waitForEvent(page, 'ready');
  const durationMs = ready.payload?.durationMs ?? 2000;

  // seek 到结尾附近：第二段 char 揭示时间可能超过中段，近结尾确保 pixelate instant
  // 已经 registerInstantEffects 应用（滤镜实例入场）。
  await sendRuntimeCommand(page, 'seek', { timeMs: Math.max(500, durationMs - 50) });
  await page.waitForTimeout(300);

  const result = await page.evaluate(async ({ vertex, fragment }): Promise<ProbeResult> => {
    const app = (globalThis as any).__PIXI_APP__;
    if (!app) throw new Error('Pixi app unavailable');
    const world = app.stage?.children?.[0];
    const contentLayer = world?.children?.[1];

    // 拾取：box 层们 + 任一滤镜实例（donor——仅作 Filter/GlProgram 类身份来源）。
    // ⚠️ 生产 bundle 经 vite minify，constructor.name 不稳定（实测 PixelateFilter → "P_"）——
    // 故不按名字识别滤镜，任何实例皆可作 donor（类身份经原型链取得，与名字无关）。
    const boxLayers: any[] = [];
    const graphicNodes: any[] = [];
    const graphicsDrawers: any[] = []; // 任何带绘制指令的 Graphics（含无 getGraphicsLayer 的层）
    let donorFilter: any = null;
    const allFilterNames: string[] = [];
    const visit = (node: any) => {
      if (!node) return;
      if (typeof node.getGraphicsLayer === 'function') {
        graphicNodes.push(node);
        const layer = node.getGraphicsLayer('box');
        if (layer && !boxLayers.includes(layer)) boxLayers.push(layer);
      }
      if (node.context && Array.isArray(node.context.instructions) && node.context.instructions.length > 0) {
        graphicsDrawers.push(node);
      }
      for (const filter of node?.filters ?? []) {
        allFilterNames.push(filter?.constructor?.name ?? 'unknown');
        if (!donorFilter && filter?.glProgram) donorFilter = filter;
      }
      for (const child of node?.children ?? []) visit(child);
    };
    visit(contentLayer ?? world);

    if (!donorFilter || graphicNodes.length < 2) {
      return {
        pixelateFound: Boolean(donorFilter),
        boxFound: boxLayers.length > 0,
        sanity: null,
        verdict: null,
        debug: `donor=${Boolean(donorFilter)} graphicNodes=${graphicNodes.length} boxLayers=${boxLayers.length} filters=[${allFilterNames.join(',')}]`,
      };
    }

    // 从 donor 拾取类身份：Filter（原型链上溯两级）+ GlProgram（.glProgram.constructor）。
    const FilterClass = Object.getPrototypeOf(Object.getPrototypeOf(donorFilter)).constructor;
    const GlProgramClass = donorFilter.glProgram.constructor;
    const probeGray = new FilterClass({
      glProgram: new GlProgramClass({ vertex, fragment, name: 'probe-gray' }),
      resources: { filterUniforms: { uMix: { value: 1, type: 'f32' } } },
    });

    // 读矩形指令（firstRectCoords 与单测同源）；按全局 y 区分段落：
    // 最上 = 段 1（sanity 对照，无滤镜），最下 = 段 2（verdict，挂探针 gray）。
    const rectOf = (layer: any): { x: number; y: number; w: number; h: number } | null => {
      const insts = layer?.context?.instructions;
      const pathInsts = insts?.[0]?.data?.path?.instructions;
      const d = pathInsts?.[0]?.data;
      if (!Array.isArray(d) || d.length < 4) return null;
      return { x: d[0], y: d[1], w: d[2], h: d[3] };
    };
    const withGeometry = boxLayers
      .map((layer) => ({ layer, rect: rectOf(layer) }))
      .filter((entry): entry is { layer: any; rect: { x: number; y: number; w: number; h: number } } =>
        Boolean(entry.rect))
      .map((entry) => ({
        ...entry,
        globalCorner: entry.layer.toGlobal({ x: entry.rect.x + 6, y: entry.rect.y + 6 }),
        globalCenterY: entry.layer.toGlobal({ x: entry.rect.x, y: entry.rect.y + entry.rect.h / 2 }).y,
      }))
      .sort((a, b) => a.globalCenterY - b.globalCenterY);

    if (withGeometry.length < 2) {
      return { pixelateFound: true, boxFound: true, sanity: null, verdict: null, debug: 'no rect instruction' };
    }
    const sanityEntry = withGeometry[0];
    const verdictEntry = withGeometry[withGeometry.length - 1];
    // 样本点选择：box 矩形带 40 设计 px padding，相邻段矩形会重叠（实测段 1 矩形下缘越过段 2 顶缘）。
    // sanity 取段 1 矩形**上**内角（远离段 2），verdict 取段 2 矩形**下**内角（远离段 1），
    // 保证各自只穿过一个半透明红层（首版两点都取上内角 → verdict 点叠在段 1 红上，
    // 读出「灰 over 未滤红」(166,102,102)——不是滤镜错，是采样点串层）。
    // 两段 y 间距应可区分（全局坐标 >15px；本 fixture 单行段落约 43px）——防取到同段两个宿主层。
    if (verdictEntry.globalCenterY - sanityEntry.globalCenterY < 15) {
      return {
        pixelateFound: true, boxFound: true, sanity: null, verdict: null,
        debug: `段落间距不足（${(verdictEntry.globalCenterY - sanityEntry.globalCenterY).toFixed(0)}px）`,
      };
    }
    // 下半区（段 2）全部渲染节点挂探针 gray：容器级（子树整体滤）+ 每个有绘制指令的 Graphics
    //（实测只滤容器或只滤 box 层都会读到「灰 over 未滤红」叠色 (166,102,102)——红色来自多个
    // 承载体，逐一覆盖才能保证样本点下方全灰）。
    // ⚠️ 段归属按**绘制位置**判定（矩形全局中心 y），不能用容器原点——图层原点可在 (0,0)
    //  而指令画在段落位置（首版按原点归属漏层，叠色未消）。
    const midY = (sanityEntry.globalCenterY + verdictEntry.globalCenterY) / 2;
    const centerYOf = (node: any): number => {
      const rect = rectOf(node); // Graphics：直接读自身指令
      if (rect) return node.toGlobal({ x: rect.x, y: rect.y + rect.h / 2 }).y;
      if (typeof node.getGraphicsLayer === 'function') {
        const lr = rectOf(node.getGraphicsLayer('box')); // 容器：读其 box 层指令
        if (lr) return node.getGraphicsLayer('box').toGlobal({ x: lr.x, y: lr.y + lr.h / 2 }).y;
      }
      return node.toGlobal({ x: 0, y: 0 }).y; // 无指令：回退原点
    };
    let filteredCount = 0;
    for (const node of [...new Set([...graphicNodes, ...graphicsDrawers])]) {
      if (centerYOf(node) > midY) {
        node.filters = [probeGray];
        filteredCount++;
      }
    }
    const sanityPoint = sanityEntry.globalCorner; // 上内角（+6,+6）
    const verdictPoint = verdictEntry.layer.toGlobal({
      x: verdictEntry.rect.x + 6,
      y: verdictEntry.rect.y + verdictEntry.rect.h - 6,
    });

    // 直接读默认帧缓冲（renderer.gl.readPixels）——绕开 extract/generateTexture
    //（无 target 的 extract.pixels 走 generateTexture 遍历，对手挂滤镜的层会崩；
    //  传 target=stage 则按包围盒裁子纹理，坐标与 toGlobal 错位）。
    // readPixels 在 render() 同一任务内同步读有效（合成发生在事件循环让出后）。
    // 画布是 opaque（白底清屏）→ 预乘/直输在最终像素上无歧义。
    await app.renderer.render(app.stage);
    const gl = app.renderer.gl;
    const bufferH = gl.drawingBufferHeight;
    const pixelAt = (point: { x: number; y: number }): number[] => {
      const buf = new Uint8Array(4);
      gl.readPixels(Math.round(point.x), bufferH - Math.round(point.y) - 1, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, buf);
      return [buf[0], buf[1], buf[2], buf[3]];
    };

    return {
      pixelateFound: true,
      boxFound: true,
      sanity: pixelAt(sanityPoint),
      verdict: pixelAt(verdictPoint),
      debug: `buffer=${gl.drawingBufferWidth}x${bufferH} filtered=${filteredCount} sanity@(${sanityPoint.x.toFixed(0)},${sanityPoint.y.toFixed(0)}) verdict@(${verdictPoint.x.toFixed(0)},${verdictPoint.y.toFixed(0)})`,
    };
  }, { vertex: vertexSrc, fragment: fragmentSrc });

  expect(result.pixelateFound, `pixelate 实例应存在（${result.debug}）`).toBe(true);
  expect(result.boxFound, `两个 box 层应存在（${result.debug}）`).toBe(true);

  expect(result.sanity, `sanity 像素应取得（${result.debug}）`).not.toBeNull();
  expect(result.verdict, `verdict 像素应取得（${result.debug}）`).not.toBeNull();

  // sanity：半透明红 over 白 → 粉红 (≈255, 255×(1−α), …)，验证合成假设成立；
  // 有效 α 从绿通道反推（自适应段内单层/多层叠放——多层叠放时 α>0.5，预期带随之移动）。
  const sanity = result.sanity!;
  expect(sanity[0], `sanity 红通道 ≈255（${result.debug}）实际 ${sanity}`).toBeGreaterThan(235);
  const alpha = 1 - sanity[1]! / 255;
  expect(alpha, `有效 alpha 应落 (0.3, 0.9)（sanity=${sanity}；${result.debug}）`).toBeGreaterThan(0.3);
  expect(alpha, `有效 alpha 应落 (0.3, 0.9)（sanity=${sanity}；${result.debug}）`).toBeLessThan(0.9);

  // 两假设的灰度预测（由 α 参数化）：
  //   CONFIRMED（输入预乘）：c.rgb/c.a 还原 straight → luma 0.299 → 输出 0.299α over 白
  //     → 255×(1 − 0.701α)（α=0.5 → 166；α=0.75 → 121）。
  //   FALSIFIED（输入直输）：c.rgb/c.a = straight/α 虚高 → luma 0.299/α → 0.299 + (1−α)
  //     → 255×(1 − α + 0.299)（α=0.5 → 204；α=0.75 → 140）。
  const confirmedExpected = 255 * (1 - 0.701 * alpha);
  const falsifiedExpected = 255 * (1 - alpha + 0.299);

  const verdict = result.verdict!;
  const grayValue = (verdict[0]! + verdict[1]! + verdict[2]!) / 3;
  const channelSpread = Math.max(verdict[0]!, verdict[1]!, verdict[2]!) - Math.min(verdict[0]!, verdict[1]!, verdict[2]!);
  expect(channelSpread, `gray 后应为灰（通道差 ≤12），实际 ${verdict}（α=${alpha.toFixed(2)}；${result.debug}）`).toBeLessThanOrEqual(12);

  if (Math.abs(grayValue - falsifiedExpected) <= 8) {
    // 有意失败：证伪 = 滤镜家族除法步骤需返工（S6b），不能沉默通过。
    expect(
      grayValue,
      `§B-bis 证伪：filter 输入为直输（灰度 ${grayValue.toFixed(1)} ≈ FALSIFIED 预测 ${falsifiedExpected.toFixed(1)}；α=${alpha.toFixed(2)}；${result.debug}）——S6b 返工 ~15 个滤镜的预乘包络`,
    ).toBe(-1);
  }
  expect(
    Math.abs(grayValue - confirmedExpected),
    `§B-bis 裁决：期望 CONFIRMED ≈${confirmedExpected.toFixed(0)} 或 FALSIFIED ≈${falsifiedExpected.toFixed(0)}，实际灰度 ${grayValue.toFixed(1)}（α=${alpha.toFixed(2)}，${verdict}；${result.debug}）——第三态需人工调查`,
  ).toBeLessThanOrEqual(8);
});
