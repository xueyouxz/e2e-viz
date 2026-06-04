# ADR-0005: Theme state managed by React Context, not Zustand

**Status:** Superseded by [ADR-0006](./0006-remove-theme-system.md)

> The dark/light theme system described below was removed in ADR-0006. The app
> now ships a single light palette with no runtime theme switching. This record
> is retained for historical context.

## Context

`theme: 'dark' | 'light'` was the sole piece of state in `AppStore` (a module-level Zustand singleton). No other state existed in the store. `toggleTheme` and `setTheme` were defined but had no callers; `useAppStore` was called in exactly one place (`ThemeTokensProvider`).

Zustand offers devtools, middleware, and subscription optimisation — none of which are needed for a single, rarely-changing string value.

## Decision

Replace `AppStore` with a React Context (`ThemeContext`) and `ThemeProvider` placed at the app root (`AppProviders`). Expose `{ theme, setTheme, toggleTheme }` via a `useTheme()` hook that throws if called outside the provider.

FOUC is prevented by a module-level `applyTheme(getInitialTheme())` call that runs when `src/app/themeContext.tsx` is first imported — before any React render cycle.

The existing `ThemeTokensContext` (SVG/canvas palette for D3 and PlaybackTimeline) is kept as a separate, SceneViewer-scoped second layer. Its provider now reads `theme` from `useTheme()` instead of `useAppStore()`, preserving structural sync: ThemeContext update → ThemeTokensProvider re-renders → new tokens propagate downstream.

## Consequences

**Enables:**

- Theme state participates in the React tree — easier to test, no external store to reset
- `useTheme()` throws on misuse, matching the `useSceneCtx()` defensive pattern already in the codebase
- `AppProviders` becomes a real provider wrapper instead of a passthrough no-op
- `appStore.ts` and its Zustand dependency for this concern are eliminated

**Rules out:**

- Reading `theme` outside the React tree (e.g. in a module-level variable or Web Worker) — call `localStorage.getItem('app-theme')` directly if needed outside React
- Do not reintroduce a Zustand store for theme; single-value state does not justify the dependency
