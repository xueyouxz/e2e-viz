# E2E Viz

Standalone React/Vite app containing the migrated `projection-map` and `scene-viewer2`
visualizations from `plannning-eval-vis`.

## Routes

- `/` - projection map visualization
- `/projection-map` - projection map visualization alias
- `/scenes/:sceneName` - scene viewer, for example `/scenes/scene-0916`

## Commands

```bash
pnpm install
pnpm dev
pnpm lint
pnpm build
```

Runtime data is copied under `public/data/`, with `public/ego.glb` used by the scene viewer.
