# E2E Viz

React/Vite visualization with a Node.js proxy for private Alibaba Cloud OSS data.

## Routes

- `/` - projection map visualization
- `/projection-map` - projection map visualization alias
- `/scenes/:sceneName` - scene viewer, for example `/scenes/scene-0916`

## Commands

```bash
pnpm install
pnpm dev
pnpm check
pnpm build
pnpm preview
pnpm render:glyphs
```

Local development data is read from `public/data/`, with `public/ego.glb` used by the scene viewer.
`pnpm render:glyphs` renders the individual source glyphs and then packs them into the single
`public/data/glyphs/glyph-atlas-v1.webp` runtime atlas. The projection map and selected-scenes
panel both crop thumbnails from that shared atlas, so glyph display uses one HTTP request.
`pnpm build` validates this atlas and rebuilds it when local glyph data is present, then bundles with Vite; CI/Docker skip
that data step because production data is served from OSS and excluded from the image build context.

## Production architecture

Docker Compose starts two independent containers from the same immutable image:

- `app`: public nginx frontend, bound only to `127.0.0.1:3001` for the host reverse proxy.
- `api`: private Node.js service; streams allow-listed `/data` objects from OSS over its internal endpoint.

The server does not mount or persist scene data. OSS credentials are mounted from ignored files
under `secrets/`. Only the daily request/byte counters are kept in a small Docker volume so
container restarts cannot reset the configured safety cap. The OSS bucket remains private, while
the public demo can request allow-listed objects through the rate-limited backend proxy.

Required object mapping:

```text
/data/scenes/scene-0916/metadata.glb
→ oss://e2e-viz-private/e2e-viz/data/scenes/scene-0916/metadata.glb
```

Copy `.env.example` to `.env` and create these files before starting Compose:

```text
secrets/oss_access_key_id
secrets/oss_access_key_secret
```

Generate the glyph atlas before uploading. After configuring Alibaba Cloud `ossutil` locally,
upload `public/data/` and
`/Users/xyxz/Data/nusviz-val.zip` with:

```bash
pnpm build:glyph-atlas
pnpm validate:glyph-atlas
pnpm sync:data
```

`sync:data` also validates atlas coverage, format, dimensions and freshness before upload, then
checks that the uploaded atlas exists in OSS.

## Verification

`pnpm check` is the single complete check used locally, by the pre-push hook and by CI. It runs ESLint, Stylelint, Prettier check, incremental TypeScript checks, frontend coverage tests, server/script tests, the production build and bundle budgets. Pre-commit only checks staged files.

`pnpm test` runs non-interactive tests without coverage. `pnpm test:coverage` writes HTML, LCOV and JSON summaries under `coverage/` for frontend source; server and script test results are separate. Coverage percentages do not block pushes; failed tests do. Pure tests use Node; React resource/lifecycle tests explicitly opt into jsdom.

Users manually validate layout, zoom, lasso gestures, playback controls, keyboard behavior and scene opening/closing with `pnpm dev` or `pnpm build` followed by `pnpm preview`. There is no staging deployment or automated browser interaction suite.

`pnpm size` reads `dist/.vite/manifest.json`. Budgets use gzip: projection initial JavaScript including shared dependencies ≤150 KiB, additional scene-viewer route JavaScript excluding already loaded shared assets ≤330 KiB, and all manifest CSS ≤12 KiB. The lazy route must not become an eager dependency of the projection route. Chunk filenames are not used to classify routes.

`pnpm check:unused` runs Knip manually. Review unused exports/dependencies against dynamic routes, Worker entry points and offline scripts before removing anything. Knip is not part of the push gate and does not auto-fix.

The vector-map merge script remains an input to offline glyph rendering. Legacy glyph range/trajectory generation and the old per-glyph manifest output have been retired. Existing local and OSS data is not deleted by this cleanup.
