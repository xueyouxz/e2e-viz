# ADR-0003: Renderer owns the complete stream rendering lifecycle

**Status:** Accepted

## Context

The NUSVIZ protocol defines distinct typed-array payloads for `point`, `polyline`, `polygon`, `cuboid`, and `image` streams. An earlier Layer/Renderer split converted those arrays into intermediate JavaScript objects before rebuilding Three.js inputs. It added per-Frame allocation and separated GPU resource ownership from store updates without creating a useful reuse boundary.

The `pose` stream is not geometry data and is handled by `scene/EgoVehicle.tsx`.

## Decision

Each file in `renderers/` owns the complete store-to-GPU lifecycle for one rendered `StreamType`:

- Read Frame data with `useSceneStoreApi().getState()` from `useFrame`; do not use reactive `useSceneStore(selector)` subscriptions.
- Keep scratch vectors, matrices, growable typed arrays, geometry, materials, textures, and async request tokens inside the Renderer instance.
- Use payload and style reference gates so unchanged Frames do not rewrite GPU attributes.
- Grow capacity only when required and dispose every owned Three.js resource on replacement or unmount.
- Write protocol typed arrays directly into reusable buffers without intermediate object collections.

`layerRegistry.ts` remains the single `StreamType` to Renderer mapping. No Layer compatibility components or generic Renderer base class are retained.

Camera overlay code in `camera/` is outside this registry. `CameraOverlayProjector` owns reusable 2D projection scratch; each private `CameraViewport` owns its image, canvas resize, draw, and pick state.

## Consequences

- Adding a stream name under an existing protocol type requires no Renderer change.
- Adding a new protocol type requires a dedicated Renderer and one registry entry.
- Renderer tests use a minimal per-instance store provider; implementation-detail render-count tests are not duplicated for every Renderer.
- Store access, GPU mutation, and resource cleanup can be audited in one file per payload type.
