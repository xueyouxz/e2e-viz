# E2E Viz

React/Vite visualization with a Node.js proxy for private Alibaba Cloud OSS data.

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

Local development data is read from `public/data/`, with `public/ego.glb` used by the scene viewer.

## Production architecture

Docker Compose starts two independent containers from the same immutable image:

- `app`: public nginx frontend, bound only to `127.0.0.1:3001` for the host reverse proxy.
- `api`: private Node.js service; streams allow-listed `/data` objects from OSS over its internal endpoint.

The server does not mount or persist scene data. OSS credentials are mounted from ignored files
under `secrets/`. Only the daily request/byte counters are kept in a small Docker volume so
container restarts cannot reset the configured safety cap. The OSS bucket remains private, while
the public demo can request allow-listed objects through the rate-limited backend proxy.

Required object mapping:

```text
/data/scenes/scene-0916/metadata.glb
→ oss://e2e-viz-private/e2e-viz/data/scenes/scene-0916/metadata.glb
```

Copy `.env.example` to `.env` and create these files before starting Compose:

```text
secrets/oss_access_key_id
secrets/oss_access_key_secret
```

After configuring Alibaba Cloud `ossutil` locally, upload `public/data/` and
`/Users/xyxz/Data/nusviz-val.zip` with:

```bash
pnpm sync:data
```
