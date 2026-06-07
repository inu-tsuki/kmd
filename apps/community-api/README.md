# KMD Community API

KMD Community API is the tiny mock backend for the Android reader course project. It provides realistic community-shaped endpoints for work browsing, work detail, script checks, and review submission.

## Commands

```bash
pnpm community-api:dev
pnpm community-api:build
pnpm community-api:test
```

The service listens on `http://localhost:3000` by default. Android emulators should use `http://10.0.2.2:3000/`.

## Endpoints

- `GET /health`
- `GET /works`
- `GET /works/:id`
- `GET /works/:id/source`
- `GET /works/:id/revisions/:revisionId/source`
- `GET /works/:id/issues`
- `POST /reviews`

`GET /works` supports `mode`, `status`, and `q` query parameters.

## Work And KMD Source

`Work` is the community entity. `.kmd` is the playable source document. Work detail responses include `script.activeRevisionId` and revision `sourceUrl`; Android should fetch that source and pass both `work` and `source` to the reader runtime.

Seed KMD files live in:

```text
content/works/<work-id>/<revision-id>.kmd
```
