# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
pnpm dev          # dev server at http://localhost:3001
pnpm build        # validate glyph atlas, typecheck, Vite build, initial bundle check
pnpm typecheck    # tsc --noEmit (type check without emit)
pnpm lint         # eslint
pnpm lint:fix     # eslint --fix
pnpm lint:style   # stylelint CSS
pnpm format       # prettier
pnpm test         # vitest run (single pass)
pnpm test:watch   # vitest (watch mode)
pnpm test:coverage
pnpm size         # bundle size check (requires prior pnpm build)
pnpm sync:data    # upload public/data + nusviz-val.zip to private OSS with ossutil
```

Run a single test file:

```bash
pnpm vitest run src/features/scene-viewer/data/FrameDecoder.test.ts
```

Path alias `@/` maps to `src/`.

## Architecture

Two independent features under `src/features/`:

- **`projection-map`** — 2D D3 scatter plot of scenes in embedding space; lasso selection, pan/zoom, multi-dataset toggling. Data: `public/data/projection-map/`.
- **`scene-viewer`** — 3D frame-by-frame playback of a driving scene with camera overlays and D3 charts. Data: `public/data/scenes/`, ego model: `public/ego.glb`.

Routes: `/` and `/projection-map` → ProjectionMap; `/scenes/:sceneName` → SceneViewer.

### State

- **SceneStore** (`src/features/scene-viewer/store/sceneStore.ts`) — created via `createSceneStore()` factory, not a singleton. Each `<SceneViewer>` mount gets its own store instance passed through `SceneCtx`. Never refactor to a singleton (ADR-0001).

### Scene data pipeline

Scene bundles are `.glb` files following the NUSVIZ protocol (see `docs/NUSVIZ.md`):

1. **Frame decoder** (`data/FrameDecoder.ts` with `data/workers/frameDecoder.worker.ts`) — keeps Worker and main-thread fallback behavior aligned, resolves typed array accessors, and returns raw `ArrayBuffer` bytes for images. Uses `Transferable` to avoid copy overhead.
2. **Main thread** (`data/SceneDataManager.ts`) — receives `RawDecodedFrame`, materializes image payloads with `URL.createObjectURL()` (DOM required; not doable in Worker). Handles revocation on `destroy()` (ADR-0002).

### Rendering: Renderer + Registry

Five `StreamType` values from the NUSVIZ protocol are rendered via the registry (`point`, `polyline`, `polygon`, `cuboid`, `image`). The `pose` type is handled separately by `EgoVehicle` in `components/`.

- **Renderer** (`renderers/*Renderer.tsx`) — the complete rendering pipeline for one `StreamType`. Reads `StreamPayload` directly from SceneStore (zero-subscription `useSceneStoreApi()` + `useFrame` for per-frame streams; `useMemo` for static geometry). Owns pre-allocated `DynamicDrawUsage` typed arrays mutated in-place; manages Three.js geometry, material, and disposal.
- **Registry** (`registry/layerRegistry.ts`) — maps `StreamType` → Renderer. `SceneViewer` iterates it; never hardcode type checks there (ADR-0003).

Adding a new stream name under an existing type requires no code changes. Adding a new `StreamType` = new Renderer + one registry entry.

### Styling

A single light palette; no runtime theme switching (removed in ADR-0006). CSS: `--app-*` custom properties in `:root` in `src/styles/variables.css`. For SVG/canvas elements (D3 charts, PlaybackTimeline) that cannot consume CSS variables: the `svgTokens` constant in `styleConfig.tsx`.

## Key constraints

- `URL.createObjectURL()` must stay on the main thread — Workers have no DOM access.
- `URL.revokeObjectURL()` must be called by the same thread that created the URL; `SceneDataManager.destroy()` handles this.
- Do not add store access inside Renderers.
- Do not replace `SceneCtx` with a module-level import of SceneStore.
- The `RawDecodedFrame` type (with `_raw` discriminant) is the Worker IPC contract — changes require updating `frameDecoderMessages.ts`, `FrameDecoder.ts`, and `SceneDataManager.materializeFrame`.

## Type safety conventions

The project runs `strict: true` with `noUnusedLocals` and `noUnusedParameters`. CI enforces `pnpm typecheck` before the build step.

**Prohibited:**

- `@ts-ignore` and `@ts-nocheck` — never use; they silently suppress real errors.
- `as any` — use `unknown` + type narrowing, or proper generic bounds.
- `// eslint-disable` on type-related rules (e.g. `@typescript-eslint/no-explicit-any`) — fix the root type instead.

**Permitted with a mandatory explanation comment:**

- `@ts-expect-error` — only when suppressing a known upstream library bug. The comment must name the library version and link or describe the issue.

**Pattern for third-party ref types (drei / r3f):**
Use `React.ElementRef<typeof Component>` instead of importing from indirect packages:

```ts
import type { ElementRef } from 'react'
import { OrbitControls } from '@react-three/drei'
const ref = useRef<ElementRef<typeof OrbitControls> | null>(null)
```

## Tooling

- Package manager: **pnpm** (v10+)
- Build: **Vite 7** with manual chunks for the application shell (`react-vendor`, `router`); the Three.js/R3F/Zustand graph stays inside the lazy SceneViewer chunk
- Tests: **Vitest** with jsdom; coverage via v8; test setup in `src/test/setup.ts`
- Linting: ESLint (flat config `eslint.config.mjs`), Stylelint (`stylelint-config-recess-order`)
- Pre-commit: Husky + lint-staged (ESLint + Prettier on TS/TSX; Stylelint + Prettier on CSS)
- Pre-push: full lint run via `.husky/pre-push`
