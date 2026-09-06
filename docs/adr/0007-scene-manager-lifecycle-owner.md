# ADR-0007: SceneManager owns one scene lifecycle

**Status:** Accepted

## Context

Scene initialization, frame loading, store commits, prefetch, buffer updates, and teardown must stay coordinated when a viewer changes scenes or seeks faster than requests complete. Splitting these operations across React effects and data hooks allowed stale requests to update a newer scene.

## Decision

Create one `SceneManager` for each `sceneUrl` and per-instance SceneStore pair.

- `SceneManager` resets scene data, initializes `SceneLoader`, subscribes to frame-index changes, and commits only the latest requested frame.
- `SceneLoader` owns fetch cancellation, parsing, cache entries, Blob URLs, and their cleanup.
- `SceneManager.destroy()` invalidates pending commits, removes subscriptions, and destroys the loader.
- Viewer preferences such as camera mode and playback speed remain in the per-instance store across scene data resets.

## Consequences

- React owns only session construction and destruction; it does not coordinate individual frame requests.
- A stale frame result cannot commit after a newer seek or session destruction.
- Do not add a second frame-loading effect or expose `SceneLoader` through the feature root.
