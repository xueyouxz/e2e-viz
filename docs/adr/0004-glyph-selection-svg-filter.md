# ADR-0004 — Glyph selection uses SVG edge-detection filter, not a border

## Status

Accepted

## Context

When a scene Glyph is selected in the ProjectionMap, the UI must give clear visual feedback. The simplest implementation is a rectangular `<rect>` stroke drawn around the 44×44 Glyph. An alternative is a CSS `drop-shadow` filter (the approach used before this ADR).

## Decision

Use an SVG `<filter>` applied to the Glyph `<image>` element with two composited layers:

1. **Outer glow**: `feMorphology dilate(3)` on `SourceAlpha` → `feComposite out` (ring outside image boundary) → blue `#2563eb` → `feGaussianBlur(2)`. Produces a soft blue halo around the image frame.
2. **Inner tint**: `feFlood(#2563eb, 0.3)` → `feComposite in(SourceAlpha)` → `feComposite over(SourceGraphic)`. Applies a 30% blue tint over the glyph while keeping its content readable.

Final: tinted image composited over outer glow.

`SourceAlpha` is used (not `SourceGraphic`) for the dilate step to correctly detect the opaque image boundary without amplifying color channel content.

## Reasons

- A rectangular border does not communicate anything about the scene content — it looks the same for every scene.
- The outer glow creates a clearly visible selection frame; the inner tint establishes a consistent blue-selected visual identity.
- `SourceAlpha`-based outer ring is numerically correct for opaque raster images: dilate expands the alpha mask, `feComposite out` isolates the expansion ring, flood + clip produces the blue halo.
- Avoiding `feConvolveMatrix` on RGB channels prevents the image boundary alpha discontinuity from producing artifacts (solid blue blobs) that cover the glyph content.
- Performance is acceptable because only selected Glyphs (typically a few at a time) carry the filter.

## Trade-offs rejected

- **`<rect>` border**: visually clean but content-agnostic. Rejected by design decision.
- **drivable_area polygon overlay**: accurate but requires loading per-scene vector geometry and running the full coordinate transform pipeline just for the selection indicator. Overengineered relative to the visual goal.
- **`drop-shadow` filter** (previous approach): diffuse glow that does not follow map features and is hard to see against complex image backgrounds.
