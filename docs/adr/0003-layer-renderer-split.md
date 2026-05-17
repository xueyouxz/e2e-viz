# ADR-0003: Layer / Renderer two-layer split for scene rendering

**Status:** Amended (see below)

## Context

The **NUSVIZ protocol** (see [`docs/NUSVIZ.md`](../NUSVIZ.md)) defines six fixed `StreamType` values, each with a distinct typed-array payload shape:

| StreamType | Payload arrays                                               | Rendered as                 |
| ---------- | ------------------------------------------------------------ | --------------------------- |
| `pose`     | _(no geometry)_                                              | EgoPose transform only      |
| `point`    | `VEC3 float32` points + optional `SCALAR float32` intensity  | Point cloud                 |
| `polyline` | `VEC3 float32` vertices + `SCALAR uint32` offsets            | Trajectory / map line       |
| `polygon`  | `VEC3 float32` vertices + `SCALAR uint32` offsets            | Map area                    |
| `cuboid`   | CENTER/SIZE `VEC3`, ROTATION `VEC4`, CLASS_ID/TRACK_ID/SCORE | 3D bounding box             |
| `image`    | Blob URL (materialized from raw JPEG/WebP bytes)             | Camera overlay / raster map |

The protocol is stable but extensible — new stream names can appear under any existing type. The naive approach (one monolithic component per stream type that reads state and creates Three.js geometry) would couple store access, frame data, and GPU resource management into a single unit hard to extend or replace.

## Decision

Split rendering into two distinct layers:

- **Layer** (`layer/*Layer.tsx`): a React Three Fiber component. Reads the current `StreamPayload` from the Zustand store via `useSceneStore`, derives per-frame geometry inputs, and delegates to a **Renderer**. Owns the React lifecycle — it decides when to update geometry. One Layer per `StreamType`: `PointLayer`, `PathLayer`, `PolygonLayer`, `CuboidLayer`, `ImageLayer`.

- **Renderer** (`renderers/*Renderer.tsx`): a pure Three.js component. Receives typed array props (e.g. `Float32Array` positions, `Uint32Array` classIds), creates/updates `BufferGeometry` and `Material`. Has no store dependency and no knowledge of frame index or stream names.

A central **registry** (`registry/layerRegistry.ts`) maps each `StreamType` → Layer component. `FrameSynchronizer` iterates the registry to render all active streams without hardcoding type checks.

The NUSVIZ `polyline` and `polygon` types share the same vertex/offsets payload shape; they are disambiguated at parse time (see ADR-0002) and rendered by the same `PathLayer` / `PolygonLayer` with different fill behaviour.

## Consequences

**Enables:**

- Adding a new stream name under an existing `StreamType` requires zero code changes — the registry handles it automatically
- Adding a genuinely new `StreamType` = one Layer + one Renderer + one registry entry, no changes elsewhere
- Renderers are testable in isolation with raw typed arrays — no store, no frame index needed
- The registry is the single place to audit which stream types are supported

**Rules out:**

- Do not bypass the registry by hardcoding `StreamType` checks in `FrameSynchronizer`
- The six `StreamType` values come from the NUSVIZ protocol spec — do not invent new types outside the spec without updating both the protocol doc and the registry

---

## Amendment — Layer / Renderer merged (May 2026)

**The Layer abstraction has been removed.** All five Layer components (`PointLayer`, `PathLayer`, `PolygonLayer`, `ImageLayer`, and the unused `CuboidLayer`) were merged into their corresponding Renderers.

### Why the original split was revoked

The original rationale ("Renderers are testable in isolation with raw typed arrays") relied on Renderers receiving typed arrays as props. In practice:

1. **PathLayer and PolygonLayer** converted `StreamPayload` typed arrays into intermediate JS-object arrays (`PathLayerDatum[]`, `PolygonLayerDatum[]`) and passed them as props. These intermediate allocations happened every frame, causing measurable GC pressure on high-frequency polyline streams.
2. **All Layers** created new Three.js geometry objects on every payload change — there was no pre-allocation. The split added indirection without adding testability in practice (no Renderer-only tests existed or were planned).
3. **CuboidLayer** was dead code — `CuboidRenderer` was always used directly and never delegated to a separate Layer component.

### New architecture

Each Renderer is now the **complete rendering pipeline** for its StreamType:

- Reads `StreamPayload` directly from SceneStore (`useSceneStoreApi()` + `useFrame` for per-frame streams; `useMemo` for static streams)
- Owns pre-allocated `DynamicDrawUsage` typed arrays; mutates them in-place per frame
- Manages geometry, material, and disposal lifecycle
- Is registered in `layerRegistry` as before — registry contract is unchanged

### Updated constraints

- Do not add intermediate typed-array → JS-object → typed-array conversion steps in Renderers; write directly into pre-allocated buffers
- Do not add store access outside of the `useFrame` callback or mount-time `useMemo` in Renderers — no reactive `useSceneStore(selector)` subscriptions inside Renderers
- `CameraOverlayCanvas` in `layer/` is **not** a Renderer in this sense; it is a 2D canvas component used by `CameraPanel` and is not registered in `layerRegistry`
