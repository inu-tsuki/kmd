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
  }
];
