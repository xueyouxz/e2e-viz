# ADR-0007: SceneSession owns one scene lifecycle

**Status:** Accepted

## Context

Scene initialization, frame loading, store commits, prefetch, buffer updates, and teardown must stay coordinated when a viewer changes scenes or seeks faster than requests complete. Splitting these operations across React effects and data hooks allowed stale requests to update a newer scene.

## Decision

Create one `SceneSession` for each `sceneUrl` and per-instance SceneStore pair.

- `SceneSession` resets scene data, initializes `SceneRepository`, subscribes to frame-index changes, and commits only the latest requested frame.
- `SceneRepository` owns fetch cancellation, decoding, cache entries, Blob URLs, and their cleanup.
- `SceneSession.destroy()` invalidates pending commits, removes subscriptions, and destroys the repository.
- Viewer preferences such as camera mode and playback speed remain in the per-instance store across scene data resets.

## Consequences

- React owns only session construction and destruction; it does not coordinate individual frame requests.
- A stale frame result cannot commit after a newer seek or session destruction.
- Do not add a second frame-loading effect or expose `SceneRepository` through the feature root.
