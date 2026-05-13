# e2e-viz — Domain Context

## What this app is

A standalone browser-based visualization tool for autonomous driving evaluation data. It has two features:

- **ProjectionMap** — 2D scatter plot of scenes in embedding space; supports lasso selection
- **SceneViewer** — 3D frame-by-frame playback of a single scene with camera overlays and charts

---

## Core Terms

### Scene

A recorded driving clip. Has a name, description, and a sequence of **Frames**. Identified by a URL pointing to a `.glb` bundle.

### Frame

One time-step in a Scene. Indexed by integer `frameIndex`. Each frame carries an **EgoPose** and a set of **StreamPayloads**.

### EgoPose

The position and orientation of the ego vehicle at a given Frame. Stored as `{ translation: [x,y,z], rotation: [w,x,y,z] }`.

### Stream

A named channel of data that exists across all Frames in a Scene. Each Stream has a `StreamType` (`point`, `polyline`, `polygon`, `cuboid`, `image`, `pose`) and a coordinate space (`world` or `ego`).

### StreamPayload

The data for one Stream at one Frame. Typed per `StreamType` (e.g. `CuboidPayload`, `PointPayload`). Stored as typed arrays for memory efficiency.

### Layer

A React Three Fiber component that renders one Stream's `StreamPayload` in the 3D canvas. Each `StreamType` has a corresponding Layer (e.g. `CuboidLayer`, `PointLayer`). Layers are registered in `layerRegistry`.

### Renderer

A thin R3F component inside a Layer that holds the Three.js geometry and material. Layers own data selection; Renderers own geometry.

### SceneStore

A per-SceneViewer instance Zustand store (created via `createSceneStore()`). Holds all runtime state: current Frame, playback status, stream visibility, metadata. Not a module-level singleton — each `<SceneViewer>` has its own store.

### AppStore

Module-level Zustand singleton (`useAppStore`). Holds application-wide UI state: `theme`. Syncs `theme` to `localStorage` and `document.documentElement[data-theme]`.

### Theme

`'dark' | 'light'`. Owned by **AppStore**. Applied globally via `data-theme` on `<html>`. CSS modules consume `--app-*` custom properties that are defined per theme in `src/styles/variables.css`.

### ThemeTokens

A JS object (`ThemeTokens`) providing colour values for SVG/canvas elements that cannot consume CSS variables (D3 charts, PlaybackTimeline). Derived from `theme` via `ThemeTokensContext` inside SceneViewer.

### ProjectionMap

Feature that renders a 2D D3 scatter plot of scenes. Supports panning, zooming, lasso selection, and multi-dataset toggling.

### VectorMap

The data backing ProjectionMap: a set of scenes each with a 2D projection coordinate, thumbnail, metadata, and split label.

### Glyph

A 44×44 SVG-unit bird's-eye thumbnail rendered per scene in the ProjectionMap, visible when zoom ≥ `LOD_GLYPH_MIN_K`. Implemented as a D3-managed `<g>` group containing a raster `<image>` (webp) and an SVG `<polyline>` for the **EgoTrajectory**. Selection state is expressed via a per-image SVG filter (edge detection + glow), not a rectangular border (see ADR-0004).

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
- [ADR-0003](docs/adr/0003-layer-renderer-split.md) — Why Layer and Renderer are separate components
- [ADR-0004](docs/adr/0004-glyph-selection-svg-filter.md) — Why Glyph selection uses SVG edge-detection filter instead of a border
