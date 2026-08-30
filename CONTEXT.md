# e2e-viz — Domain Context

## What this app is

A standalone browser-based visualization tool for autonomous driving evaluation data. It has two features:

- **ProjectionMap** — 2D scatter plot of scenes in embedding space; supports lasso selection
- **SceneViewer** — 3D frame-by-frame playback of a single scene with camera overlays and charts

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

### Renderer

A React Three Fiber component that renders one Stream's `StreamPayload` directly in the 3D canvas. It uses `useSceneStoreApi()` with `useFrame` instead of reactive Frame subscriptions, reuses instance-owned typed arrays and Three.js resources, and owns disposal. One Renderer exists per rendered `StreamType`: `CuboidRenderer`, `PointRenderer`, `PathRenderer`, `PolygonRenderer`, and `ImageRenderer`. `rendererRegistry` maps protocol types to these Renderers. The `pose` type is handled separately by `scene/EgoVehicle.tsx`.

### SceneSession

The lifecycle owner for one loaded Scene. It coordinates `SceneRepository`, commits the latest requested Frame to SceneStore, starts prefetch, publishes the contiguous buffer range, and prevents stale requests from updating a replaced or destroyed Scene.

### SceneRepository

Owns scene metadata and Frame I/O: fetch cancellation, priority queueing, request deduplication, bounded cache, and Blob URL creation/revocation. It delegates binary decoding to `FrameDecoder`.

### PlaybackClock

The pure timestamp-based playback state machine. `SceneEffects` is its only R3F tick driver; `PlaybackTimeline` sends play, pause, speed, and seek commands without a second RAF.

### CameraOverlayProjector

An instance-owned camera projection pipeline used by `CameraPanel`. It reuses matrices, cuboid corners, projected points, and image-space bounds. Each private `CameraViewport` uses the same viewport transform for canvas drawing and object picking.

### SceneStore

A per-SceneViewer instance Zustand store (created via `createSceneStore()`). Holds all runtime state: current Frame, playback status, stream visibility, metadata. Not a module-level singleton — each `<SceneViewer>` has its own store.

### svgTokens

A frozen JS object (`svgTokens`, type `SvgTokens`) in `styleConfig.ts` providing colour values for SVG/canvas elements that cannot consume CSS variables (D3 charts, PlaybackTimeline). The app ships a single light palette with no runtime theme switching (see ADR-0006); CSS modules consume `--app-*` custom properties defined in `:root` in `src/styles/variables.css`.

### ProjectionMap

Self-contained feature under `src/features/projection-map/` that renders a 2D D3 scatter plot of scenes. It owns its route entry, view, selected-scene list, Glyph Atlas rendering, data adapters, and domain types. Supports panning, zooming, lasso selection, and multi-dataset toggling.

### VectorMap

The data backing ProjectionMap: a set of scenes each with a 2D projection coordinate, thumbnail, metadata, and split label.

### Glyph

A bird's-eye thumbnail rendered from one Sprite Atlas into a screen-space Canvas. The ProjectionMap selects one representative scene per LOD grid cell; `GlyphThumbnail` crops the same Atlas for the selected-scene list. Selection is drawn by the shared Canvas renderer.

### EgoTrajectory

The driven path of the ego vehicle through a scene: ~40 `[x, y]` waypoints in the **first_ego frame**. Displayed as an orange (`#f97316`) polyline overlay on each Glyph. Source: `public/data/projection-map/ego_trajectories_slim.json`.

### GlyphRange

Per-scene bounding box (`range_center`, `range_size`) in the **first_ego frame** that defines what the Glyph image covers. Used to project EgoTrajectory global coordinates into Glyph pixel space. Source: `public/data/projection-map/glyph_ranges.json`.

### first_ego frame

A per-scene 2D coordinate system. Origin = ego vehicle position at sample 0; axes aligned to vehicle heading at that moment (rotation by `poses[0].yaw`). All VectorMap layer geometries and GlyphRange values are expressed in this frame. EgoTrajectory global coordinates are converted to this frame before rendering.

---

## Architecture Decisions

Non-obvious design choices are recorded in `docs/adr/`. Key entries:

- [ADR-0001](docs/adr/0001-per-instance-scene-store.md) — Why SceneStore is a factory (not a singleton)
- [ADR-0002](docs/adr/0002-worker-parse-main-thread-materialize.md) — Why Worker parses but main thread materializes images
- [ADR-0003](docs/adr/0003-layer-renderer-split.md) — Why each Renderer owns its complete store-to-GPU lifecycle
- [ADR-0004](docs/adr/0004-glyph-selection-svg-filter.md) — Why Glyph selection uses SVG edge-detection filter instead of a border
- [ADR-0005](docs/adr/0005-theme-react-context.md) — Theme state via React Context (superseded by ADR-0006)
- [ADR-0006](docs/adr/0006-remove-theme-system.md) — Why the theme system was removed in favour of a single light palette
- [ADR-0007](docs/adr/0007-scene-session-lifecycle-owner.md) — Why SceneSession is the single lifecycle owner for one loaded Scene
