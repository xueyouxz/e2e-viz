# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
pnpm dev          # dev server at http://localhost:3001
pnpm build        # tsc -b && vite build
pnpm lint         # eslint
pnpm lint:fix     # eslint --fix
pnpm lint:style   # stylelint CSS
pnpm format       # prettier
pnpm test         # vitest run (single pass)
pnpm test:watch   # vitest (watch mode)
pnpm test:coverage
```

Run a single test file:

```bash
pnpm vitest run src/features/scene-viewer/data/MessageParser.test.ts
```

Path alias `@/` maps to `src/`.

## Architecture

Two independent features under `src/features/`:

- **`projection-map`** — 2D D3 scatter plot of scenes in embedding space; lasso selection, pan/zoom, multi-dataset toggling. Data: `public/data/projection-map/`.
- **`scene-viewer`** — 3D frame-by-frame playback of a driving scene with camera overlays and D3 charts. Data: `public/data/scenes/`, ego model: `public/ego.glb`.

Routes: `/` and `/projection-map` → ProjectionMap; `/scenes/:sceneName` → SceneViewer.

### State

- **AppStore** (`src/app/appStore.ts`) — module-level Zustand singleton. Owns `theme` (`'dark'|'light'`), synced to `localStorage` and `document.documentElement[data-theme]`.
- **SceneStore** (`src/features/scene-viewer/store/sceneStore.ts`) — created via `createSceneStore()` factory, not a singleton. Each `<SceneViewer>` mount gets its own store instance passed through `SceneCtx`. Never refactor to a singleton (ADR-0001).

### Scene data pipeline

Scene bundles are `.glb` files following the NUSVIZ protocol (see `docs/NUSVIZ.md`):

1. **Web Worker** (`data/workers/messageParse.worker.ts` → `data/MessageParser.ts`) — parses the GLB binary, resolves typed array accessors, returns raw `ArrayBuffer` bytes for images. Uses `Transferable` to avoid copy overhead.
2. **Main thread** (`data/SceneDataManager.ts`) — receives `RawDecodedFrame`, materializes image payloads with `URL.createObjectURL()` (DOM required; not doable in Worker). Handles revocation on `destroy()` (ADR-0002).

### Rendering: Layer / Renderer split

Six `StreamType` values from the NUSVIZ protocol (`point`, `polyline`, `polygon`, `cuboid`, `image`, `pose`):

- **Layer** (`layer/*Layer.tsx`) — reads `StreamPayload` from SceneStore, owns React lifecycle.
- **Renderer** (`renderers/*Renderer.tsx`) — receives typed arrays as props, manages Three.js geometry/material. No store access; no knowledge of frame index.
- **Registry** (`registry/layerRegistry.ts`) — maps `StreamType` → Layer. `FrameSynchronizer` iterates it; never hardcode type checks there (ADR-0003).

Adding a new stream name under an existing type requires no code changes. Adding a new `StreamType` = new Layer + Renderer + one registry entry.

### Theming

CSS: `--app-*` custom properties in `src/styles/variables.css` per `[data-theme]`. For SVG/canvas elements (D3 charts, PlaybackTimeline) that cannot consume CSS variables: `ThemeTokens` JS object derived from `theme` via `ThemeTokensContext` inside SceneViewer.

## Key constraints

- `URL.createObjectURL()` must stay on the main thread — Workers have no DOM access.
- `URL.revokeObjectURL()` must be called by the same thread that created the URL; `SceneDataManager.destroy()` handles this.
- Do not add store access inside Renderers.
- Do not replace `SceneCtx` with a module-level import of SceneStore.
- The `RawDecodedFrame` type (with `_raw` discriminant) is the Worker IPC contract — changes require updating `workerMessages.ts`, `MessageParser.ts`, and `SceneDataManager.materializeFrame`.

## Tooling

- Package manager: **pnpm** (v10+)
- Build: **Vite 7** with manual chunks (three-core, r3f, react-vendor, router, zustand)
- Tests: **Vitest** with jsdom; coverage via v8; test setup in `src/test/setup.ts`
- Linting: ESLint (flat config `eslint.config.mjs`), Stylelint (`stylelint-config-recess-order`)
- Pre-commit: Husky + lint-staged (ESLint + Prettier on TS/TSX; Stylelint + Prettier on CSS)
- Pre-push: full lint run via `.husky/pre-push`
