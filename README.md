# E2E Viz

[English](README.md) | [简体中文](README.zh-CN.md)

E2E Viz is a browser-based visualization tool for exploring autonomous-driving datasets and end-to-end model outputs. It combines a scene projection map with a synchronized 3D viewer, helping researchers and developers locate representative scenes and inspect perception, prediction, and planning results frame by frame.

## Features

- Explore nuScenes train and validation scenes in a 2D projection map.
- Filter, search, highlight, and select scene groups with a lasso.
- Inspect point clouds, vector maps, objects, trajectories, and ego motion in 3D.
- Compare SparseDrive predictions with nuScenes ground truth.
- Review six camera views, playback state, scene statistics, and model metrics.

## Getting started

Requirements: Node.js 20.19 or later and pnpm 9 or later.

```bash
git clone https://github.com/xueyouxz/e2e-viz.git
cd e2e-viz
pnpm install
pnpm dev
```

Open <http://localhost:3001> after preparing the runtime data under `public/data/`.

The scene viewer uses the NUSVIZ stream format documented in [`docs/NUSVIZ.md`](docs/NUSVIZ.md). The repository does not include nuScenes data, SparseDrive checkpoints, or generated predictions. These resources must be obtained separately and remain subject to their original terms.

## Development

Run the complete validation suite before submitting changes:

```bash
pnpm check
```

## References

- [SparseDrive repository](https://github.com/swc-17/SparseDrive)
- [nuScenes official website](https://www.nuscenes.org/)

E2E Viz is an independent project and is not affiliated with or endorsed by the SparseDrive or nuScenes maintainers.

## License

The source code in this repository is available under the [MIT License](LICENSE). Third-party datasets, models, and generated artifacts retain their respective licenses and terms.
