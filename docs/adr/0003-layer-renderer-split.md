# ADR-0003: Concrete Layers own stream rendering

**Status:** Accepted

## Context

The SceneViewer renders point, polyline, polygon, cuboid, and image Streams through React Three Fiber. Each type has different data, Three.js objects, update rules, interactions, and disposal requirements.

Splitting each type between `renderers/` and `layers/` duplicated module boundaries without creating an independent consumer for the lower-level objects.

## Decision

Each concrete component in `layers/` owns the complete rendering lifecycle for one Stream type:

- Read the current Stream data imperatively from SceneStore in `useFrame`.
- Resolve visibility, style, and world/ego coordinate transforms.
- Own reusable typed arrays, Three.js objects, scratch values, update gates, and disposal.
- Keep Frame updates outside React reconciliation.
- Handle type-specific requirements such as polygon resolution, cuboid selection, and image loading.

`SceneViewer` contains the single `StreamType` to Layer mapping and mounts the selected Layer component. The `renderers/` module is removed.

Point, polyline, polygon, and cuboid modules retain internal primitive classes so their GPU updates remain directly testable. These classes are implementation details of their corresponding Layer modules, not a second architecture layer.

No generic base Layer, Layer manager, compatibility component, or independent registry is introduced.

Camera projection code in `camera/` remains outside the Layer boundary. `CameraProjector` owns reusable 2D projection scratch; each private `CameraViewport` owns its image, canvas resize, rendering, and pointer-picking state.

## Consequences

- One module contains the full store-to-GPU path for each rendered Stream type.
- `SceneViewer` selects Layer strategies without owning their implementation details.
- GPU resources remain instance-owned and are released when the Layer unmounts.
- Adding a new rendered Stream type requires one concrete Layer and one `SceneViewer` mapping entry.
