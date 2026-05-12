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
