# @kmd/reader-runtime-web

WebView/browser runtime bundle for KMD Reader.

This package owns the reader-only HTML entry and static bundle build. It still reuses the runtime implementation in `apps/editor/src/core/`; do not import editor UI modules such as Vue components, Pinia stores, Monaco, TextMate, or editor panels.

```bash
pnpm --filter @kmd/reader-runtime-web build
```

The build writes Android-consumable static files to:

```text
dist/reader-runtime/
```

Android syncs that directory into APK assets under `reader-runtime/`. The legacy `kmd-runtime/` asset path is only the D0 fallback shell.
