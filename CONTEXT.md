# e2e-viz — Domain Context

## What this app is

A standalone browser-based visualization tool for autonomous driving evaluation data. It has two features:

- **ProjectionMap** — 2D scatter plot of scenes in embedding space; supports lasso selection
- **SceneViewer** — 3D frame-by-frame playback of a single scene with camera projections and charts

---

## Core Terms

### Scene

A recorded driving clip. Has a name, description, and a sequence of **Frames**. Its base URL contains `message_index.json`, `metadata.glb`, and frame files.

### Frame

One time-step in a Scene. Indexed by integer `frameIndex`. Each frame carries an **EgoPose** and a set of **StreamPayloads**.

### EgoPose

The position and orientation of the ego vehicle at a given Frame. Stored as `{ translation: [x,y,z], rotation: [w,x,y,z] }`.

### Stream

A named channel of data that exists across all Frames in a Scene. Each Stream has a `StreamType` (`point`, `polyline`, `polygon`, `cuboid`, `image`, `pose`) and a coordinate space (`world` or `ego`).

### StreamPayload

The data for one Stream at one Frame. Typed per `StreamType` (e.g. `CuboidPayload`, `PointPayload`). Stored as typed arrays for memory efficiency.

### Layer

A React Three Fiber component that renders one Stream type. `PointLayer`, `PolylineLayer`, `PolygonLayer`, `CuboidLayer`, and `ImageLayer` read SceneStore imperatively from `useFrame`, resolve stream visibility, style, and coordinates, and own their typed arrays, Three.js objects, update gates, and disposal. `SceneViewer` selects the concrete Layer from the Stream metadata. Frame updates mutate Layer-owned resources without causing per-Frame React renders.

### SceneManager

The lifecycle owner for one loaded Scene. It coordinates `SceneLoader`, commits the latest requested Frame to SceneStore, starts prefetch, publishes the contiguous buffer range, and prevents stale requests from updating a replaced or destroyed Scene.

### SceneLoader

Loads scene metadata and Frames and owns fetch cancellation, priority queueing, request deduplication, bounded cache, and Blob URL creation/revocation. It delegates NUSVIZ parsing to `MessageParser`.

### MessageParser

Parses NUSVIZ metadata and Frame messages through shared Stream payload readers. Frame messages run in a Worker when available; `GlbReader` remains the lower-level GLB and accessor reader.

### timeManager

The pure timestamp-based playback calculation module. `SceneEffects` is its only R3F tick driver. `Playback` renders the controls, keeps pointer-drag frames local, and requests one target frame when dragging ends.

### CameraProjector

An instance-owned camera projection pipeline used by `CameraPanel`. It reuses matrices, cuboid corners, projected points, and image-space bounds. Each private `CameraViewport` uses the same viewport transform for canvas rendering and object picking.

### SceneStore

A per-SceneViewer instance Zustand store (created via `createSceneStore()`). It separates `requestedFrameIndex` from `displayedFrameIndex`; a loaded Frame commits its index, EgoPose, and StreamPayloads atomically. It also holds playback status, stream visibility, and metadata. Not a module-level singleton — each `<SceneViewer>` has its own store.

### svgTokens

A JS object (`svgTokens`, type `SvgTokens`) in `styleConfig.ts` providing colour values for D3 SVG/canvas charts. The app ships a single light palette with no runtime theme switching (see ADR-0006). `Playback` owns its semantic styles in `Playback.css`.

### ProjectionMap

Self-contained feature under `src/features/projection-map/` that renders a 2D D3 scatter plot of scenes. It owns its route entry, view, selected-scene list, Glyph Atlas rendering, data adapters, and domain types. Supports panning, zooming, lasso selection, and multi-dataset toggling.

### VectorMap

The data backing ProjectionMap: a set of scenes each with a 2D projection coordinate, thumbnail, metadata, and split label.

### Glyph

A bird's-eye thumbnail rendered from one Sprite Atlas into a screen-space Canvas. The ProjectionMap selects one representative scene per LOD grid cell; `GlyphThumbnail` crops the same Atlas for the selected-scene list. Selection is drawn by the shared Canvas renderer.

---

## Architecture Decisions

Non-obvious design choices are recorded in `docs/adr/`. Key entries:

- [ADR-0001](docs/adr/0001-per-instance-scene-store.md) — Why SceneStore is a factory (not a singleton)
- [ADR-0002](docs/adr/0002-worker-parse-main-thread-materialize.md) — Why Worker parses but main thread materializes images
- [ADR-0003](docs/adr/0003-layer-renderer-split.md) — Why each Layer owns its complete store-to-GPU lifecycle
- [ADR-0004](docs/adr/0004-glyph-selection-svg-filter.md) — Previous SVG Glyph selection approach (superseded by Canvas Atlas rendering)
- [ADR-0005](docs/adr/0005-theme-react-context.md) — Theme state via React Context (superseded by ADR-0006)
- [ADR-0006](docs/adr/0006-remove-theme-system.md) — Why the theme system was removed in favour of a single light palette
- [ADR-0007](docs/adr/0007-scene-manager-lifecycle-owner.md) — Why SceneManager is the single lifecycle owner for one loaded Scene
