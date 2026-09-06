# Development instructions

## Commands and checks

Use pnpm (the exact version is recorded in `package.json`). Node.js 22 is used in CI and Docker.

- `pnpm dev`: local Vite server on port 3001.
- `pnpm build`: validate local glyph data when present, then build the production frontend.
- `pnpm preview`: manually validate the production build locally. No staging environment is maintained.
- `pnpm check`: the complete pre-push and CI check: lint, style lint, formatting, typecheck, non-interactive tests with coverage, server/script tests, build and bundle budgets.
- `pnpm test`: run frontend, server and script tests without coverage.
- `pnpm test:watch`: watch frontend tests; append a module path to focus the run.
- `pnpm test:coverage`: frontend coverage report in `coverage/`; no coverage percentage gate.
- `pnpm typecheck`: `tsc -b`, checking application and Vite configuration.
- `pnpm lint`, `pnpm lint:style`, `pnpm format:check`: read-only checks.
- `pnpm format`: format supported source, script, configuration and documentation files.
- `pnpm size`: inspect the existing build through its Vite manifest.
- `pnpm check:unused`: manual Knip audit. Review findings; do not auto-delete code or treat this as a push gate.
- `pnpm render:glyphs`: generate individual glyph images and build the shared Atlas.
- `pnpm sync:data`: explicitly requested uploads only; validates the Atlas before upload.

Pre-commit checks only staged files. Pre-push and CI both run `pnpm check`.
Tests failing or builds exceeding their budget block the check; low coverage does not.
Run focused checks while developing and the full check before delivery. Do not claim full verification after only module-level checks.

## Test boundary

Users manually verify visual appearance, buttons, keyboard/pointer gestures, zoom, playback controls and page flows. Do not add Playwright or UI interaction tests.
Automated tests cover requests, retry/cancellation, cache and load order, parsing, coordinate/selection calculations, state transitions and resource cleanup. Prefer existing fetch injection/mocks; do not add MSW without a new requirement.
Vitest defaults to Node. Lifecycle tests that require React DOM opt into jsdom with a file-level annotation; using React in such tests does not make them interaction tests.
Keep tests beside their module, including existing `__test__` folders. Coverage includes frontend source and reports untested code without imposing a global threshold. Server and script suites run separately with Node's test runner.

## Architecture

See `CONTEXT.md` for domain terms and `docs/NUSVIZ.md` for the data protocol. Current decisions are recorded in `docs/adr/`; superseded ADRs are historical, not implementation requirements.

- `src/app/` owns routes, shell and route fallbacks.
- `projection-map/index.tsx` owns selection and Train/Val display modes. Its permanent sidebar contains the summary and selected list in a 1:3 height ratio. `ProjectionMapView` owns D3 zoom and Canvas frames; `spatial.ts` owns pure geometry and sampling rules. One application-owned Atlas is shared with list thumbnails.
- `scene-viewer/SceneManager.ts` owns a scene lifecycle and coordinates `SceneLoader` with a per-instance Zustand store.
- `SceneLoader` owns fetch cancellation, queueing, cache and Blob URL creation/revocation. `MessageParser` and its Worker share parsing logic; `GlbReader` reads GLB/accessor data.
- `layers/` contains one rendering pipeline per stream type. Layers read the store imperatively in the R3F update path and own their buffers and Three.js resource disposal.
- `scene/SceneContent.tsx` contains the sole playback tick driver. `playback/timeManager.ts` calculates playback time; `Playback.tsx` owns controls.
- `camera/CameraPanel.tsx` composes reusable projection and drawing/picking helpers.

Preserve per-instance scene stores and resource ownership. Do not introduce store singletons, generic loader/renderer base classes, or duplicate frame-loading effects.
Blob URLs remain owned by SceneLoader to align their lifetime with the scene/cache. Ordinary Web Workers can create Blob URLs; keeping ownership on the main thread is a project design choice, not a DOM API restriction.
Changes to Worker messages must update `MessageParser.ts`, `MessageParser.worker.ts` and the SceneLoader materialization path together. Do not reuse detached transferred buffers.

## Styling and types

Use the light palette in `src/styles/variables.css`. Feature CSS may use semantic class names. `styleConfig.ts` owns scene stream styles and chart colors supplied to imperative rendering.
TypeScript is strict. Do not use `@ts-ignore`, `@ts-nocheck`, `as any`, or disable type-related lint rules. A necessary `@ts-expect-error` must explain the upstream issue.
Keep exports limited to actual cross-file interfaces. Preserve existing worktree changes unrelated to the requested task.
