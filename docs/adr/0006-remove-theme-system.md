# ADR-0006: Remove the theme system, collapse to a single light palette

**Status:** Accepted

Supersedes [ADR-0005](./0005-theme-react-context.md).

## Context

The dark/light theme system (ADR-0005) carried three layers:

- `ThemeProvider` / `useTheme` in `src/app/themeContext.tsx` — wrote `data-theme`
  to `<html>` and persisted to `localStorage`.
- `[data-theme='dark']` and `[data-theme='light']` blocks in
  `src/styles/variables.css` feeding `--app-*` CSS custom properties.
- A SceneViewer-scoped `ThemeTokensContext` (`DARK_TOKENS` / `LIGHT_TOKENS`)
  supplying colours to D3 charts and `PlaybackTimeline`, which cannot consume
  CSS variables.

No theme toggle UI was ever shipped. `setTheme` / `toggleTheme` had no callers,
and `useTheme()` was consumed in exactly one place (`ThemeTokensProvider`). The
entire apparatus existed to broadcast a constant that never changed at runtime.

## Decision

Remove the theme system and keep light as the sole palette.

- Delete `src/app/themeContext.tsx` and the `<ThemeProvider>` wrapper in `App`.
- Inline the light `--app-*` values into a plain `:root` block in
  `variables.css`; drop both `[data-theme]` selectors. No code sets `data-theme`.
- Flatten the token layer: delete `DARK_TOKENS`, `ThemeTokensContext`,
  `ThemeTokensProvider`, and `useThemeTokens`. Export the former `LIGHT_TOKENS`
  as a plain frozen constant `svgTokens` (interface `SvgTokens`); the four
  SVG/canvas consumers import it directly. Remove the `<ThemeTokensProvider>`
  wrapper from `SceneViewer`.

The word "theme" is retired from the codebase. The SVG/canvas palette is named
for what it is — a palette for surfaces that cannot read CSS variables.

## Consequences

**Enables:**

- One source of truth per token; no context/provider/`useMemo` indirection for a
  value that never changes.
- Smaller surface for the follow-up Tailwind migration — a single palette to map.

**Rules out:**

- Runtime light/dark switching. Reintroducing it means restoring a token layer
  and the `data-theme` mechanism — reopen this decision rather than bolting it on.

## Follow-up

Migrating the `--app-*` tokens and the 15 CSS modules to Tailwind is tracked
separately; this ADR only covers collapsing to a single palette.
