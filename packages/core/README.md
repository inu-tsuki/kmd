# @kmd/core

Internal source package for the shared KMD parser, layout, effects, stage, rendering, playback, and reader-runtime contract.

This package is private while KMD remains in its experimental phase. Deep imports are intentionally available to the monorepo, but they are not a stable public API and may change during Phase B.

Editor-only integrations such as Vue, Pinia, Monaco, TextMate, and editor panels must stay outside this package.

## Current boundary and north star

Today this package is the monorepo's Pixi + GSAP reference-runtime closure, not the final portable KMD core.
The long-term boundary is a lowering pipeline of language/semantic IR, backend-neutral layout plans, effect
graphs and execution/segment-graph plans, followed by backend adapters. IR is the bridge, but each stage owns
a typed IR rather than sharing one universal mutable object.

The concrete direction, including Effect Graph plugins, typed anchor indexing, source navigation under graph
control flow, and the three distinct time concepts, is recorded in
[`portable-language-runtime-boundaries.md`](../../docs/planning/runtime/portable-language-runtime-boundaries.md).
Physical package splits wait for a real second
backend so that this private extraction is not mistaken for a stable publication contract.
