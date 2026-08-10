# @kmd/core

Internal source package for the shared KMD parser, layout, effects, stage, rendering, playback, and reader-runtime contract.

This package is private while KMD remains in its experimental phase. Deep imports are intentionally available to the monorepo, but they are not a stable public API and may change during Phase B.

Editor-only integrations such as Vue, Pinia, Monaco, TextMate, and editor panels must stay outside this package.
