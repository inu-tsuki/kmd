import type { ScriptIssue, Work } from '../domain/types.js';

export const seedWorks: Work[] = [
  {
    id: 'rain-city',
    title: 'Rain City Slow Motion',
    authorName: 'Mira',
    description: 'A vertical stage poem about rain, traffic lights, and a city learning to breathe.',
    tags: ['poetry', 'rain', 'portrait'],
    presentationMode: 'stage',
    orientationHint: 'portrait',
    aspectRatio: '9:16',
    lifecycleStatus: 'published',
    interactionLevel: 'read_only',
    previewMode: 'clip',
    estimatedDurationSec: 42,
    coverUrl: '/assets/covers/rain-city.jpg',
    script: {
      activeRevisionId: 'rev-1',
      revisions: [{
        id: 'rev-1',
        label: 'Polished portrait stage script',
        sourcePath: 'content/works/rain-city/rev-1.kmd',
        sourceUrl: '/works/rain-city/source',
        mimeType: 'text/x-kmd',
        kmdVersion: '0.1',
        runtimeVersion: '0.2-preview',
        createdAt: '2026-05-20T00:00:00.000Z'
      }]
    },
    stats: {
      scenes: 6,
      lines: 22,
      effects: 13
    },
    commentSummary: {
      count: 18,
      preview: ['The pacing feels made for phone reading.', 'The rain transitions are gentle.']
    }
  },
  {
    id: 'glass-rail',
    title: 'Glass Rail',
    authorName: 'Noah',
    description: 'A landscape cinematic script about a train crossing a frozen bridge at dusk.',
    tags: ['cinematic', 'landscape', 'review'],
    presentationMode: 'stage',
    orientationHint: 'landscape',
    aspectRatio: '16:9',
    lifecycleStatus: 'submitted',
    interactionLevel: 'light_interactive',
    previewMode: 'clip',
    estimatedDurationSec: 50,
    coverUrl: '/assets/covers/glass-rail.jpg',
    script: {
      activeRevisionId: 'rev-1',
      revisions: [{
        id: 'rev-1',
        label: 'Polished landscape stage preview',
        sourcePath: 'content/works/glass-rail/rev-1.kmd',
        sourceUrl: '/works/glass-rail/source',
        mimeType: 'text/x-kmd',
        kmdVersion: '0.1',
        runtimeVersion: '0.2-preview',
        createdAt: '2026-05-20T00:00:00.000Z'
      }]
    },
    stats: {
      scenes: 7,
      lines: 24,
      effects: 12
    },
    commentSummary: {
      count: 6,
      preview: ['The wide-screen mood is strong.', 'Needs a smoother mobile preview.']
    }
  },
  {
    id: 'after-school-orbit',
    title: 'After School Orbit',
    authorName: 'Lio',
    description: 'A draft interactive-style story that teases choices from a quiet classroom scene.',
    tags: ['visual-novel', 'interactive', 'draft'],
    presentationMode: 'interactive',
    orientationHint: 'adaptive',
    aspectRatio: '16:10',
    lifecycleStatus: 'draft',
    interactionLevel: 'interactive',
    previewMode: 'cover',
    estimatedDurationSec: 48,
    coverUrl: '/assets/covers/after-school-orbit.jpg',
    script: {
      activeRevisionId: 'rev-1',
      revisions: [{
        id: 'rev-1',
        label: 'Polished choice-teaser script',
        sourcePath: 'content/works/after-school-orbit/rev-1.kmd',
        sourceUrl: '/works/after-school-orbit/source',
        mimeType: 'text/x-kmd',
        kmdVersion: '0.1',
        runtimeVersion: '0.2-preview',
        createdAt: '2026-05-20T00:00:00.000Z'
      }]
    },
    stats: {
      scenes: 7,
      lines: 25,
      effects: 12
    },
    commentSummary: {
      count: 0,
      preview: []
    }
  },
  {
    id: 'final-test',
    title: 'Final Runtime Integration Test',
    authorName: 'KMD Lab',
    description: 'A stage-mode integration script that exercises timing, layout, camera, token effects, and pauses.',
    tags: ['runtime-test', 'stage', 'integration'],
    presentationMode: 'stage',
    orientationHint: 'landscape',
    aspectRatio: '16:9',
    lifecycleStatus: 'submitted',
    interactionLevel: 'read_only',
    previewMode: 'none',
    estimatedDurationSec: 60,
    coverUrl: '/assets/covers/final-test.jpg',
    script: {
      activeRevisionId: 'rev-1',
      revisions: [{
        id: 'rev-1',
        label: 'Editor final integration sample',
        sourcePath: 'content/works/final-test/rev-1.kmd',
        sourceUrl: '/works/final-test/source',
        mimeType: 'text/x-kmd',
        kmdVersion: '0.1',
        runtimeVersion: '0.2-preview',
        createdAt: '2026-05-21T00:00:00.000Z'
      }]
    },
    stats: {
      scenes: 12,
      lines: 64,
      effects: 36
    },
    commentSummary: {
      count: 2,
      preview: ['Useful for checking mobile runtime behavior.', 'Dense enough to reveal timing and layout regressions.']
    }
  },
  {
    id: 'reader-font-scroll', title: '阅读字号验收：长雨', authorName: 'KMD Lab',
    description: '用于 Android Reader Scroll 字号热更新和断点恢复的稳定长文本。',
    tags: ['reader-test', 'scroll', 'font-scale', 'r3-i'], presentationMode: 'scroll',
    orientationHint: 'portrait', aspectRatio: '9:16', lifecycleStatus: 'published',
    interactionLevel: 'read_only', previewMode: 'cover', estimatedDurationSec: 90, coverUrl: '',
    script: { activeRevisionId: 'rev-1', revisions: [{ id: 'rev-1', label: 'R3-I scroll typography fixture',
      sourcePath: 'content/works/reader-font-scroll/rev-1.kmd', sourceUrl: '/works/reader-font-scroll/source',
      mimeType: 'text/x-kmd', kmdVersion: '0.1', runtimeVersion: '0.2-preview', createdAt: '2026-07-12T00:00:00.000Z' }] },
    stats: { scenes: 1, lines: 18, effects: 0 }, commentSummary: { count: 0, preview: [] }
  },
  {
    id: 'reader-font-paged', title: '阅读字号验收：页间灯火', authorName: 'KMD Lab',
    description: '用于 Android Reader Paged 字号热更新和断点恢复的稳定短文本。',
    tags: ['reader-test', 'paged', 'font-scale', 'r3-i'], presentationMode: 'paged',
    orientationHint: 'portrait', aspectRatio: '9:16', lifecycleStatus: 'published',
    interactionLevel: 'read_only', previewMode: 'cover', estimatedDurationSec: 70, coverUrl: '',
    script: { activeRevisionId: 'rev-1', revisions: [{ id: 'rev-1', label: 'R3-I paged typography fixture',
      sourcePath: 'content/works/reader-font-paged/rev-1.kmd', sourceUrl: '/works/reader-font-paged/source',
      mimeType: 'text/x-kmd', kmdVersion: '0.1', runtimeVersion: '0.2-preview', createdAt: '2026-07-12T00:00:00.000Z' }] },
    stats: { scenes: 1, lines: 14, effects: 0 }, commentSummary: { count: 0, preview: [] }
  },

  // ━━ 通用示例（从 apps/editor/public/ 打包） ━━

  {
    id: 'inquisition',
    title: '审讯室',
    authorName: 'KMD Lab',
    description: '一段审讯室对话，演示 shake behavior、mark 定位、dim 与字符级时序链的交互。',
    tags: ['dialogue', 'shake', 'portrait', 'demo'],
    presentationMode: 'stage',
    orientationHint: 'landscape',
    aspectRatio: '16:9',
    lifecycleStatus: 'published',
    interactionLevel: 'read_only',
    previewMode: 'clip',
    estimatedDurationSec: 20,
    coverUrl: '/assets/covers/inquisition.jpg',
    script: {
      activeRevisionId: 'rev-1',
      revisions: [{
        id: 'rev-1',
        label: 'Editor public sample — 审讯室',
        sourcePath: 'content/works/inquisition/rev-1.kmd',
        sourceUrl: '/works/inquisition/source',
        mimeType: 'text/x-kmd',
        kmdVersion: '0.1',
        runtimeVersion: '0.2-preview',
        createdAt: '2026-02-04T00:00:00.000Z'
      }]
    },
    stats: {
      scenes: 1,
      lines: 5,
      effects: 4
    },
    commentSummary: {
      count: 0,
      preview: []
    }
  },

  {
    id: 'timing-demo',
    title: 'KMD 全功能集成演示',
    authorName: 'KMD Lab',
    description: '涵盖时序语法糖、红转蓝时序链、变量插值、cam.zoom/move/reset 异步阻塞、语速变化与 mark 定位的综合演示。',
    tags: ['timing', 'camera', 'variables', 'demo'],
    presentationMode: 'stage',
    orientationHint: 'landscape',
    aspectRatio: '16:9',
    lifecycleStatus: 'published',
    interactionLevel: 'read_only',
    previewMode: 'clip',
    estimatedDurationSec: 45,
    coverUrl: '/assets/covers/timing-demo.jpg',
    script: {
      activeRevisionId: 'rev-1',
      revisions: [{
        id: 'rev-1',
        label: 'Editor public sample — 全功能集成演示',
        sourcePath: 'content/works/timing-demo/rev-1.kmd',
        sourceUrl: '/works/timing-demo/source',
        mimeType: 'text/x-kmd',
        kmdVersion: '0.1',
        runtimeVersion: '0.2-preview',
        createdAt: '2026-04-02T00:00:00.000Z'
      }]
    },
    stats: {
      scenes: 6,
      lines: 17,
      effects: 8
    },
    commentSummary: {
      count: 0,
      preview: []
    }
  },

  {
    id: 'coord-stress',
    title: '坐标稳定性压力测试',
    authorName: 'KMD Lab',
    description: '压力测试 cam.move/reset/offset 的非阻塞与阻塞语义、坐标叠加独立性和跨段落 seek 回归。',
    tags: ['camera', 'stress-test', 'seek', 'demo'],
    presentationMode: 'stage',
    orientationHint: 'landscape',
    aspectRatio: '16:9',
    lifecycleStatus: 'published',
    interactionLevel: 'read_only',
    previewMode: 'clip',
    estimatedDurationSec: 35,
    coverUrl: '/assets/covers/coord-stress.jpg',
    script: {
      activeRevisionId: 'rev-1',
      revisions: [{
        id: 'rev-1',
        label: 'Editor public sample — 坐标稳定性压力测试',
        sourcePath: 'content/works/coord-stress/rev-1.kmd',
        sourceUrl: '/works/coord-stress/source',
        mimeType: 'text/x-kmd',
        kmdVersion: '0.1',
        runtimeVersion: '0.2-preview',
        createdAt: '2026-04-02T00:00:00.000Z'
      }]
    },
    stats: {
      scenes: 3,
      lines: 12,
      effects: 6
    },
    commentSummary: {
      count: 0,
      preview: []
    }
  },

  {
    id: 'font-test',
    title: 'Font Test',
    authorName: 'KMD Lab',
    description: '验证 Fira Code、Smiley Sans、霞鹜文楷等字体切换、粗体斜体在默认与 special 预设下的渲染。',
    tags: ['font', 'typography', 'demo'],
    presentationMode: 'stage',
    orientationHint: 'landscape',
    aspectRatio: '16:9',
    lifecycleStatus: 'published',
    interactionLevel: 'read_only',
    previewMode: 'clip',
    estimatedDurationSec: 18,
    coverUrl: '/assets/covers/font-test.jpg',
    script: {
      activeRevisionId: 'rev-1',
      revisions: [{
        id: 'rev-1',
        label: 'Editor public sample — Font Test',
        sourcePath: 'content/works/font-test/rev-1.kmd',
        sourceUrl: '/works/font-test/source',
        mimeType: 'text/x-kmd',
        kmdVersion: '0.1',
        runtimeVersion: '0.2-preview',
        createdAt: '2026-04-02T00:00:00.000Z'
      }]
    },
    stats: {
      scenes: 1,
      lines: 7,
      effects: 2
    },
    commentSummary: {
      count: 0,
      preview: []
    }
  },

  // ━━ DIP-FX 滤镜展示（从 apps/editor/public/tests/fx-*.kmd 打包） ━━
  // work-id = 文件名去掉 fx- 前缀；全部 stage 模式，landscape 16:9。

  {
    id: 'bloom',
    title: 'fx — bloom 辉光滤镜',
    authorName: 'KMD Lab',
    description: '演示 bloom 辉光滤镜在 char 与 block 作用域下的发光效果与参数调优。',
    tags: ['fx', 'bloom', 'glow', 'dip-fx'],
    presentationMode: 'stage',
    orientationHint: 'landscape',
    aspectRatio: '16:9',
    lifecycleStatus: 'published',
    interactionLevel: 'read_only',
    previewMode: 'clip',
    estimatedDurationSec: 20,
    coverUrl: '/assets/covers/bloom.jpg',
    script: {
      activeRevisionId: 'rev-1',
      revisions: [{
        id: 'rev-1',
        label: 'DIP-FX bloom filter showcase',
        sourcePath: 'content/works/bloom/rev-1.kmd',
        sourceUrl: '/works/bloom/source',
        mimeType: 'text/x-kmd',
        kmdVersion: '0.1',
        runtimeVersion: '0.2-preview',
        createdAt: '2026-06-28T00:00:00.000Z'
      }]
    },
    stats: { scenes: 5, lines: 8, effects: 5 },
    commentSummary: { count: 0, preview: [] }
  },

  {
    id: 'duotone',
    title: 'fx — duotone 双色滤镜',
    authorName: 'KMD Lab',
    description: '演示 duotone 双色调映射的 shadow/highlight 参数控制与 char/block 作用域差异。',
    tags: ['fx', 'duotone', 'color', 'dip-fx'],
    presentationMode: 'stage',
    orientationHint: 'landscape',
    aspectRatio: '16:9',
    lifecycleStatus: 'published',
    interactionLevel: 'read_only',
    previewMode: 'clip',
    estimatedDurationSec: 20,
    coverUrl: '/assets/covers/duotone.jpg',
    script: {
      activeRevisionId: 'rev-1',
      revisions: [{
        id: 'rev-1',
        label: 'DIP-FX duotone filter showcase',
        sourcePath: 'content/works/duotone/rev-1.kmd',
        sourceUrl: '/works/duotone/source',
        mimeType: 'text/x-kmd',
        kmdVersion: '0.1',
        runtimeVersion: '0.2-preview',
        createdAt: '2026-06-28T00:00:00.000Z'
      }]
    },
    stats: { scenes: 5, lines: 7, effects: 5 },
    commentSummary: { count: 0, preview: [] }
  },

  {
    id: 'edge',
    title: 'fx — edge 描边滤镜',
    authorName: 'KMD Lab',
    description: '演示 edge 描边滤镜的字符级与块级描边效果。',
    tags: ['fx', 'edge', 'outline', 'dip-fx'],
    presentationMode: 'stage',
    orientationHint: 'landscape',
    aspectRatio: '16:9',
    lifecycleStatus: 'published',
    interactionLevel: 'read_only',
    previewMode: 'clip',
    estimatedDurationSec: 18,
    coverUrl: '/assets/covers/edge.jpg',
    script: {
      activeRevisionId: 'rev-1',
      revisions: [{
        id: 'rev-1',
        label: 'DIP-FX edge filter showcase',
        sourcePath: 'content/works/edge/rev-1.kmd',
        sourceUrl: '/works/edge/source',
        mimeType: 'text/x-kmd',
        kmdVersion: '0.1',
        runtimeVersion: '0.2-preview',
        createdAt: '2026-06-28T00:00:00.000Z'
      }]
    },
    stats: { scenes: 4, lines: 7, effects: 4 },
    commentSummary: { count: 0, preview: [] }
  },

  {
    id: 'emboss',
    title: 'fx — emboss 浮雕滤镜',
    authorName: 'KMD Lab',
    description: '演示 emboss 浮雕滤镜在笔画级风格化与连续色调表面上的凹凸效果。',
    tags: ['fx', 'emboss', 'relief', 'dip-fx'],
    presentationMode: 'stage',
    orientationHint: 'landscape',
    aspectRatio: '16:9',
    lifecycleStatus: 'published',
    interactionLevel: 'read_only',
    previewMode: 'clip',
    estimatedDurationSec: 22,
    coverUrl: '/assets/covers/emboss.jpg',
    script: {
      activeRevisionId: 'rev-1',
      revisions: [{
        id: 'rev-1',
        label: 'DIP-FX emboss filter showcase',
        sourcePath: 'content/works/emboss/rev-1.kmd',
        sourceUrl: '/works/emboss/source',
        mimeType: 'text/x-kmd',
        kmdVersion: '0.1',
        runtimeVersion: '0.2-preview',
        createdAt: '2026-06-28T00:00:00.000Z'
      }]
    },
    stats: { scenes: 5, lines: 8, effects: 5 },
    commentSummary: { count: 0, preview: [] }
  },

  {
    id: 'gray',
    title: 'fx — gray 灰度滤镜',
    authorName: 'KMD Lab',
    description: '演示 gray 灰度滤镜的三作用域（char / block / bg）转换效果。',
    tags: ['fx', 'gray', 'grayscale', 'dip-fx'],
    presentationMode: 'stage',
    orientationHint: 'landscape',
    aspectRatio: '16:9',
    lifecycleStatus: 'published',
    interactionLevel: 'read_only',
    previewMode: 'clip',
    estimatedDurationSec: 16,
    coverUrl: '/assets/covers/gray.jpg',
    script: {
      activeRevisionId: 'rev-1',
      revisions: [{
        id: 'rev-1',
        label: 'DIP-FX gray filter showcase',
        sourcePath: 'content/works/gray/rev-1.kmd',
        sourceUrl: '/works/gray/source',
        mimeType: 'text/x-kmd',
        kmdVersion: '0.1',
        runtimeVersion: '0.2-preview',
        createdAt: '2026-06-28T00:00:00.000Z'
      }]
    },
    stats: { scenes: 3, lines: 6, effects: 3 },
    commentSummary: { count: 0, preview: [] }
  },

  {
    id: 'halftone',
    title: 'fx — halftone 半调滤镜',
    authorName: 'KMD Lab',
    description: '演示 halftone 半调网点滤镜的密度与色彩参数控制。',
    tags: ['fx', 'halftone', 'dots', 'dip-fx'],
    presentationMode: 'stage',
    orientationHint: 'landscape',
    aspectRatio: '16:9',
    lifecycleStatus: 'published',
    interactionLevel: 'read_only',
    previewMode: 'clip',
    estimatedDurationSec: 22,
    coverUrl: '/assets/covers/halftone.jpg',
    script: {
      activeRevisionId: 'rev-1',
      revisions: [{
        id: 'rev-1',
        label: 'DIP-FX halftone filter showcase',
        sourcePath: 'content/works/halftone/rev-1.kmd',
        sourceUrl: '/works/halftone/source',
        mimeType: 'text/x-kmd',
        kmdVersion: '0.1',
        runtimeVersion: '0.2-preview',
        createdAt: '2026-06-28T00:00:00.000Z'
      }]
    },
    stats: { scenes: 5, lines: 11, effects: 5 },
    commentSummary: { count: 0, preview: [] }
  },

  {
    id: 'noise',
    title: 'fx — noise 噪声滤镜',
    authorName: 'KMD Lab',
    description: '演示 noise 数字噪声滤镜的 amount、mono、scale 参数与 block 作用域。',
    tags: ['fx', 'noise', 'dip-fx', 'm2'],
    presentationMode: 'stage',
    orientationHint: 'landscape',
    aspectRatio: '16:9',
    lifecycleStatus: 'published',
    interactionLevel: 'read_only',
    previewMode: 'clip',
    estimatedDurationSec: 20,
    coverUrl: '/assets/covers/noise.jpg',
    script: {
      activeRevisionId: 'rev-1',
      revisions: [{
        id: 'rev-1',
        label: 'DIP-FX noise filter showcase',
        sourcePath: 'content/works/noise/rev-1.kmd',
        sourceUrl: '/works/noise/source',
        mimeType: 'text/x-kmd',
        kmdVersion: '0.1',
        runtimeVersion: '0.2-preview',
        createdAt: '2026-07-09T00:00:00.000Z'
      }]
    },
    stats: { scenes: 4, lines: 10, effects: 4 },
    commentSummary: { count: 0, preview: [] }
  },

  {
    id: 'outline',
    title: 'fx — outline 描边滤镜',
    authorName: 'KMD Lab',
    description: '演示 outline 描边滤镜的宽度与颜色参数，在字符级与块级的边缘描画效果。',
    tags: ['fx', 'outline', 'stroke', 'dip-fx'],
    presentationMode: 'stage',
    orientationHint: 'landscape',
    aspectRatio: '16:9',
    lifecycleStatus: 'published',
    interactionLevel: 'read_only',
    previewMode: 'clip',
    estimatedDurationSec: 18,
    coverUrl: '/assets/covers/outline.jpg',
    script: {
      activeRevisionId: 'rev-1',
      revisions: [{
        id: 'rev-1',
        label: 'DIP-FX outline filter showcase',
        sourcePath: 'content/works/outline/rev-1.kmd',
        sourceUrl: '/works/outline/source',
        mimeType: 'text/x-kmd',
        kmdVersion: '0.1',
        runtimeVersion: '0.2-preview',
        createdAt: '2026-06-28T00:00:00.000Z'
      }]
    },
    stats: { scenes: 4, lines: 7, effects: 4 },
    commentSummary: { count: 0, preview: [] }
  },

  {
    id: 'pixelate',
    title: 'fx — pixelate 滤镜三作用域',
    authorName: 'KMD Lab',
    description: '演示 pixelate 像素化滤镜在 char / block / bg 三个作用域下的马赛克效果。',
    tags: ['fx', 'pixelate', 'mosaic', 'dip-fx'],
    presentationMode: 'stage',
    orientationHint: 'landscape',
    aspectRatio: '16:9',
    lifecycleStatus: 'published',
    interactionLevel: 'read_only',
    previewMode: 'clip',
    estimatedDurationSec: 16,
    coverUrl: '/assets/covers/pixelate.jpg',
    script: {
      activeRevisionId: 'rev-1',
      revisions: [{
        id: 'rev-1',
        label: 'DIP-FX pixelate filter showcase',
        sourcePath: 'content/works/pixelate/rev-1.kmd',
        sourceUrl: '/works/pixelate/source',
        mimeType: 'text/x-kmd',
        kmdVersion: '0.1',
        runtimeVersion: '0.2-preview',
        createdAt: '2026-06-24T00:00:00.000Z'
      }]
    },
    stats: { scenes: 3, lines: 5, effects: 3 },
    commentSummary: { count: 0, preview: [] }
  },

  {
    id: 'posterize',
    title: 'fx — posterize 色调分离滤镜',
    authorName: 'KMD Lab',
    description: '演示 posterize 色调分离滤镜的色阶量化与参数控制。',
    tags: ['fx', 'posterize', 'quantize', 'dip-fx'],
    presentationMode: 'stage',
    orientationHint: 'landscape',
    aspectRatio: '16:9',
    lifecycleStatus: 'published',
    interactionLevel: 'read_only',
    previewMode: 'clip',
    estimatedDurationSec: 18,
    coverUrl: '/assets/covers/posterize.jpg',
    script: {
      activeRevisionId: 'rev-1',
      revisions: [{
        id: 'rev-1',
        label: 'DIP-FX posterize filter showcase',
        sourcePath: 'content/works/posterize/rev-1.kmd',
        sourceUrl: '/works/posterize/source',
        mimeType: 'text/x-kmd',
        kmdVersion: '0.1',
        runtimeVersion: '0.2-preview',
        createdAt: '2026-06-28T00:00:00.000Z'
      }]
    },
    stats: { scenes: 4, lines: 7, effects: 4 },
    commentSummary: { count: 0, preview: [] }
  },

  {
    id: 'scanline',
    title: 'fx — scanline 扫描线滤镜',
    authorName: 'KMD Lab',
    description: '演示 scanline CRT 扫描线滤镜的密度、曲率、闪烁参数与 block 作用域。',
    tags: ['fx', 'scanline', 'crt', 'dip-fx', 'm2'],
    presentationMode: 'stage',
    orientationHint: 'landscape',
    aspectRatio: '16:9',
    lifecycleStatus: 'published',
    interactionLevel: 'read_only',
    previewMode: 'clip',
    estimatedDurationSec: 20,
    coverUrl: '/assets/covers/scanline.jpg',
    script: {
      activeRevisionId: 'rev-1',
      revisions: [{
        id: 'rev-1',
        label: 'DIP-FX scanline filter showcase',
        sourcePath: 'content/works/scanline/rev-1.kmd',
        sourceUrl: '/works/scanline/source',
        mimeType: 'text/x-kmd',
        kmdVersion: '0.1',
        runtimeVersion: '0.2-preview',
        createdAt: '2026-07-09T00:00:00.000Z'
      }]
    },
    stats: { scenes: 4, lines: 8, effects: 4 },
    commentSummary: { count: 0, preview: [] }
  },

  {
    id: 'sharpen',
    title: 'fx — sharpen 锐化滤镜',
    authorName: 'KMD Lab',
    description: '演示 sharpen 卷积锐化滤镜的强度参数与字符/块级效果差异。',
    tags: ['fx', 'sharpen', 'convolution', 'dip-fx'],
    presentationMode: 'stage',
    orientationHint: 'landscape',
    aspectRatio: '16:9',
    lifecycleStatus: 'published',
    interactionLevel: 'read_only',
    previewMode: 'clip',
    estimatedDurationSec: 16,
    coverUrl: '/assets/covers/sharpen.jpg',
    script: {
      activeRevisionId: 'rev-1',
      revisions: [{
        id: 'rev-1',
        label: 'DIP-FX sharpen filter showcase',
        sourcePath: 'content/works/sharpen/rev-1.kmd',
        sourceUrl: '/works/sharpen/source',
        mimeType: 'text/x-kmd',
        kmdVersion: '0.1',
        runtimeVersion: '0.2-preview',
        createdAt: '2026-06-28T00:00:00.000Z'
      }]
    },
    stats: { scenes: 3, lines: 6, effects: 3 },
    commentSummary: { count: 0, preview: [] }
  },

  {
    id: 'threshold',
    title: 'fx — threshold 阈值滤镜',
    authorName: 'KMD Lab',
    description: '演示 threshold 二值化阈值滤镜的截断点参数与黑白量化效果。',
    tags: ['fx', 'threshold', 'binary', 'dip-fx'],
    presentationMode: 'stage',
    orientationHint: 'landscape',
    aspectRatio: '16:9',
    lifecycleStatus: 'published',
    interactionLevel: 'read_only',
    previewMode: 'clip',
    estimatedDurationSec: 18,
    coverUrl: '/assets/covers/threshold.jpg',
    script: {
      activeRevisionId: 'rev-1',
      revisions: [{
        id: 'rev-1',
        label: 'DIP-FX threshold filter showcase',
        sourcePath: 'content/works/threshold/rev-1.kmd',
        sourceUrl: '/works/threshold/source',
        mimeType: 'text/x-kmd',
        kmdVersion: '0.1',
        runtimeVersion: '0.2-preview',
        createdAt: '2026-06-30T00:00:00.000Z'
      }]
    },
    stats: { scenes: 4, lines: 7, effects: 4 },
    commentSummary: { count: 0, preview: [] }
  },

  {
    id: 'vignette',
    title: 'fx — vignette 暗角滤镜',
    authorName: 'KMD Lab',
    description: '演示 vignette 径向暗角滤镜的边缘衰减与 block 作用域。',
    tags: ['fx', 'vignette', 'atmosphere', 'dip-fx', 'm2'],
    presentationMode: 'stage',
    orientationHint: 'landscape',
    aspectRatio: '16:9',
    lifecycleStatus: 'published',
    interactionLevel: 'read_only',
    previewMode: 'clip',
    estimatedDurationSec: 18,
    coverUrl: '/assets/covers/vignette.jpg',
    script: {
      activeRevisionId: 'rev-1',
      revisions: [{
        id: 'rev-1',
        label: 'DIP-FX vignette filter showcase',
        sourcePath: 'content/works/vignette/rev-1.kmd',
        sourceUrl: '/works/vignette/source',
        mimeType: 'text/x-kmd',
        kmdVersion: '0.1',
        runtimeVersion: '0.2-preview',
        createdAt: '2026-07-09T00:00:00.000Z'
      }]
    },
    stats: { scenes: 4, lines: 8, effects: 4 },
    commentSummary: { count: 0, preview: [] }
  },

  {
    id: 'displace',
    title: 'fx — displace 位移贴图滤镜',
    authorName: 'KMD Lab',
    description: '演示 displace 波纹位移滤镜的 uTime 驱动动画、amount/scale 参数与 ticker 生命周期。',
    tags: ['fx', 'displace', 'wave', 'dip-fx', 'm2'],
    presentationMode: 'stage',
    orientationHint: 'landscape',
    aspectRatio: '16:9',
    lifecycleStatus: 'published',
    interactionLevel: 'read_only',
    previewMode: 'clip',
    estimatedDurationSec: 20,
    coverUrl: '/assets/covers/displace.jpg',
    script: {
      activeRevisionId: 'rev-1',
      revisions: [{
        id: 'rev-1',
        label: 'DIP-FX displace filter showcase',
        sourcePath: 'content/works/displace/rev-1.kmd',
        sourceUrl: '/works/displace/source',
        mimeType: 'text/x-kmd',
        kmdVersion: '0.1',
        runtimeVersion: '0.2-preview',
        createdAt: '2026-07-10T00:00:00.000Z'
      }]
    },
    stats: { scenes: 5, lines: 8, effects: 5 },
    commentSummary: { count: 0, preview: [] }
  },

  {
    id: 'underwater',
    title: 'fx — underwater 水下组合滤镜',
    authorName: 'KMD Lab',
    description: 'M2 旗舰组合：displace 波纹 + duotone 蓝移 + blur 轻模糊，演示 preset 返回 filters 数组与 seek filter 不堆积回归。',
    tags: ['fx', 'underwater', 'composite', 'dip-fx', 'm2'],
    presentationMode: 'stage',
    orientationHint: 'landscape',
    aspectRatio: '16:9',
    lifecycleStatus: 'published',
    interactionLevel: 'read_only',
    previewMode: 'clip',
    estimatedDurationSec: 22,
    coverUrl: '/assets/covers/underwater.jpg',
    script: {
      activeRevisionId: 'rev-1',
      revisions: [{
        id: 'rev-1',
        label: 'DIP-FX underwater composite showcase',
        sourcePath: 'content/works/underwater/rev-1.kmd',
        sourceUrl: '/works/underwater/source',
        mimeType: 'text/x-kmd',
        kmdVersion: '0.1',
        runtimeVersion: '0.2-preview',
        createdAt: '2026-07-10T00:00:00.000Z'
      }]
    },
    stats: { scenes: 5, lines: 8, effects: 5 },
    commentSummary: { count: 0, preview: [] }
  },

  {
    id: 'dissolve',
    title: 'fx — dissolve 溶解滤镜',
    authorName: 'KMD Lab',
    description: '演示 dissolve 溶解转场的静态 progress 锁定、block 自动 0→1 动画与逐字消散，含 behavior 组合。',
    tags: ['fx', 'dissolve', 'transition', 'dip-fx', 'm2'],
    presentationMode: 'stage',
    orientationHint: 'landscape',
    aspectRatio: '16:9',
    lifecycleStatus: 'published',
    interactionLevel: 'read_only',
    previewMode: 'clip',
    estimatedDurationSec: 22,
    coverUrl: '/assets/covers/dissolve.jpg',
    script: {
      activeRevisionId: 'rev-1',
      revisions: [{
        id: 'rev-1',
        label: 'DIP-FX dissolve filter showcase',
        sourcePath: 'content/works/dissolve/rev-1.kmd',
        sourceUrl: '/works/dissolve/source',
        mimeType: 'text/x-kmd',
        kmdVersion: '0.1',
        runtimeVersion: '0.2-preview',
        createdAt: '2026-07-09T00:00:00.000Z'
      }]
    },
    stats: { scenes: 6, lines: 8, effects: 6 },
    commentSummary: { count: 0, preview: [] }
  },

  {
    id: 'cyberpunk-title',
    title: 'fx — 赛博朋克标题序列 (DIP-FX M2 demo)',
    authorName: 'KMD Lab',
    description: '7 镜头赛博朋克标题序列：bg 背景图 + duotone 压暗、scanline+noise+rgbShift CRT 降解、warp+glitch 消散、underwater 水下、vignette+dissolve 收束、emboss 浮雕、warp:block 容器级扩展。',
    tags: ['fx', 'cyberpunk', 'composite', 'dip-fx', 'm2', 'demo'],
    presentationMode: 'stage',
    orientationHint: 'landscape',
    aspectRatio: '16:9',
    lifecycleStatus: 'published',
    interactionLevel: 'read_only',
    previewMode: 'clip',
    estimatedDurationSec: 35,
    coverUrl: '/assets/covers/cyberpunk-title.jpg',
    script: {
      activeRevisionId: 'rev-1',
      revisions: [{
        id: 'rev-1',
        label: 'DIP-FX M2 cyberpunk title demo',
        sourcePath: 'content/works/cyberpunk-title/rev-1.kmd',
        sourceUrl: '/works/cyberpunk-title/source',
        mimeType: 'text/x-kmd',
        kmdVersion: '0.1',
        runtimeVersion: '0.2-preview',
        createdAt: '2026-07-10T00:00:00.000Z'
      }]
    },
    stats: { scenes: 7, lines: 16, effects: 18 },
    commentSummary: { count: 0, preview: [] }
  },

  {
    id: 'bg',
    title: 'fx — bg 背景图基础 (DIP-FX M2 Task B)',
    authorName: 'KMD Lab',
    description: '系统验证 bg 命令的纯色/图片/组合三种格式、:bg filter 路由（duotone/emboss/gray 作用于背景精灵）、内联 f.x:bg 链路与 bg(color) 清除图片回归。',
    tags: ['fx', 'bg', 'background', 'dip-fx', 'm2', 'regression'],
    presentationMode: 'stage',
    orientationHint: 'landscape',
    aspectRatio: '16:9',
    lifecycleStatus: 'published',
    interactionLevel: 'read_only',
    previewMode: 'clip',
    estimatedDurationSec: 30,
    coverUrl: '/assets/covers/bg.jpg',
    script: {
      activeRevisionId: 'rev-1',
      revisions: [{
        id: 'rev-1',
        label: 'DIP-FX bg command + :bg filter scope showcase',
        sourcePath: 'content/works/bg/rev-1.kmd',
        sourceUrl: '/works/bg/source',
        mimeType: 'text/x-kmd',
        kmdVersion: '0.1',
        runtimeVersion: '0.2-preview',
        createdAt: '2026-07-10T00:00:00.000Z'
      }]
    },
    stats: { scenes: 8, lines: 23, effects: 12 },
    commentSummary: { count: 0, preview: [] }
  }
];

export const seedIssues: ScriptIssue[] = [
  {
    id: 'issue-rain-city-1',
    workId: 'rain-city',
    severity: 'info',
    source: 'accessibility',
    location: 'scene: crosswalk',
    message: 'The portrait stage script relies on cool cyan text for its rain mood.',
    suggestion: 'Keep the glow on key words so the rain tone remains readable on OLED screens.'
  },
  {
    id: 'issue-glass-rail-1',
    workId: 'glass-rail',
    severity: 'warning',
    source: 'metadata',
    location: 'mobile preview',
    message: 'Landscape-first works need a portrait-safe preview treatment.',
    suggestion: 'Add a cropped vertical cover or a short portrait preview clip before publishing.'
  },
  {
    id: 'issue-glass-rail-2',
    workId: 'glass-rail',
    severity: 'warning',
    source: 'metadata',
    location: 'work metadata',
    message: 'The submitted work has no short review summary.',
    suggestion: 'Add a one-sentence summary for volunteer reviewers.'
  },
  {
    id: 'issue-after-school-orbit-1',
    workId: 'after-school-orbit',
    severity: 'warning',
    source: 'runtime',
    location: 'choice teaser',
    message: 'The script presents future choices, but the current revision plays as a linear preview.',
    suggestion: 'Keep this as a draft until interactive branch syntax is implemented.'
  },
  {
    id: 'issue-final-test-1',
    workId: 'final-test',
    severity: 'info',
    source: 'performance',
    location: 'whole script',
    message: 'This work is intentionally dense and should be treated as a runtime integration sample.',
    suggestion: 'Use it for manual playback checks, but do not model normal community writing density after it.'
  },

  // ━━ 打包自 public/ 的新 work issues ━━

  {
    id: 'issue-bg-1',
    workId: 'bg',
    severity: 'info',
    source: 'runtime',
    location: ':bg filter scope',
    message: 'This showcase documents the bg command / :bg filter collision regression — the stage bg command was previously shadowed by the element-level bg, causing :bg filters to silently no-op.',
    suggestion: 'Use this work to verify :bg filters (duotone, emboss, gray) correctly target the background sprite after the bg→box rename fix.'
  },
  {
    id: 'issue-underwater-1',
    workId: 'underwater',
    severity: 'info',
    source: 'runtime',
    location: 'seek filter lifecycle',
    message: 'The underwater preset is the first filter that returns a filters[] array; repeated seeks must not accumulate filter count beyond 3.',
    suggestion: 'Use the seek regression scene at the end of this work to verify clearBehaviors handles Array.isArray correctly.'
  },
  {
    id: 'issue-cyberpunk-title-1',
    workId: 'cyberpunk-title',
    severity: 'warning',
    source: 'performance',
    location: 'scene 2: CRT degradation stack',
    message: 'Scene 2 stacks scanline + noise + rgbShift as three simultaneous block-level filters, which is the heaviest per-frame GPU load in this showcase.',
    suggestion: 'On low-end devices, consider reducing noise amount or disabling rgbShift animation to keep playback smooth.'
  }
];
