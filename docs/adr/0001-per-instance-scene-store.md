# ADR-0001: Per-instance Zustand store for SceneViewer

**Status:** Accepted

## Context

SceneViewer needs state for frame index, playback, stream visibility, ego pose, and camera mode. The natural first instinct is a global singleton store (one `useSceneStore` export used everywhere).

## Decision

Use a store factory: `createSceneStore()` returns a new Zustand store per SceneViewer mount. The store instance is passed down via React Context (`SceneCtx`) scoped to that subtree.

## Consequences

**Enables:**

- Multiple independent SceneViewer instances on the same page without state collision
- Clean teardown: when a SceneViewer unmounts, its store and context are garbage-collected
- Isolation in tests: each test creates its own store with no cross-test bleed

**Rules out:**

- Accessing scene state from outside the SceneViewer subtree without going through a ref or callback prop
- Do not refactor to a singleton — it would silently break if two viewers are ever rendered simultaneously
- Do not replace `SceneCtx` with a module-level import of the store
