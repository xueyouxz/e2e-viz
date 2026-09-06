# ADR-0002: Worker parses frames, main thread materializes images

**Status:** Accepted

## Context

Scene frame data follows the **NUSVIZ protocol** (see [`docs/NUSVIZ.md`](../NUSVIZ.md)). Each frame is a GLB binary file containing:

- A JSON chunk with a `nuviz/state_update` envelope, accessor descriptors, and JSON Pointer refs (`#/accessors/N`, `#/images/N`)
- A BIN chunk with the raw typed arrays: point clouds (`VEC3 float32`), cuboid centers/sizes/rotations/classIds (`VEC3/VEC4 float32`, `SCALAR uint32`), polyline/polygon vertex buffers, and JPEG/WebP image bytes

Each frame is hundreds of KB to several MB. Decoding on the main thread blocks rendering. Image stream payloads produce raw `ArrayBuffer` bytes (JPEG/WebP). Ordinary Web Workers support `URL.createObjectURL()`, but this project materializes Blob URLs on the main thread so SceneLoader owns both their cache lifetime and revocation. This is an ownership decision, not a DOM API restriction.

## Decision

Split frame processing into two phases:

1. **Worker** (`MessageParser.worker.ts` → `MessageParser.ts`):
   - Parses the GLB binary container (`GlbReader.parseGlb`)
   - Resolves all `#/accessors/N` JSON Pointer refs into typed arrays (`Float32Array`, `Uint32Array`)
   - Resolves `#/images/N` refs into raw `ArrayBuffer` bytes
   - Returns `ParsedFrame` — typed arrays + raw image bytes with `_raw` discriminant
   - Uses `Transferable` to transfer ArrayBuffers to the main thread without copying

2. **Main thread** (`SceneLoader` materialization):
   - Receives `ParsedFrame`
   - Calls `URL.createObjectURL(new Blob([bytes], { type: mimeType }))` for each `image` payload
   - Returns `LoadedFrame` with Blob URLs ready for Layers, tracking all created URLs for revocation on destroy

Fallback: if `Worker` is unavailable, `MessageParser` calls `parseFrame()` directly on the main thread with the same `streamsMeta`.

Metadata and Frame messages share the same Stream payload parsing functions in `MessageParser`; their distinct NUSVIZ envelopes remain separate.

The Worker is initialised with `streamsMeta` (from `metadata.glb`) so it can disambiguate `polyline` vs `polygon` payloads — both use identical `{ vertices, offsets, count }` shapes in the protocol; only `StreamMeta.type` distinguishes them.

## Consequences

**Enables:**

- Frame decoding off the main thread; rendering stays smooth during prefetch
- Transferable ArrayBuffers avoid copy overhead for large point clouds and cuboid arrays
- `ParsedFrame` is a clean, DOM-free type — safe to construct in tests without a browser environment

**Rules out:**

- Keep `URL.createObjectURL()` in SceneLoader so cache eviction and scene teardown share one resource owner
- Keep Blob URL revocation in SceneLoader; eviction and `destroy()` must release all URLs owned by that loader
- The `ParsedFrame` type (with `_raw` discriminant) is the Worker IPC contract — changes require updating `MessageParser.ts`, `MessageParser.worker.ts`, and the main-thread materialization path
- Do not resolve accessor refs on the main thread as an optimisation — the BIN chunk ArrayBuffer is transferred to the Worker; accessing it afterward on the main thread would be a use-after-transfer bug
