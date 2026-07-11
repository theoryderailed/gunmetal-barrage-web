# Gun Metal Barrage

Turn-based 3D artillery (Gunbound / Worms inspired) with **destructible voxel terrain**, **procedural maps & loadouts**, and **online public/private lobbies**.

## Stack

| Layer | Tech |
|-------|------|
| Client | Vite, TypeScript, Three.js |
| Server | Node.js, Colyseus |
| Shared | Types, proc-gen, ballistics, game rules |
| Physics | Analytic ballistics + voxel collision |

## Monorepo

```
packages/
  shared/   # types, RNG, map/loadout gen, ballistics, protocol
  server/   # Colyseus rooms, simulation, AI, leaderboard DB
  client/   # Three.js renderer, HUD, lobby UI, networking
```

## Quick start

```bash
npm install
npm run build:shared
npm run dev:server   # terminal 1 — http://localhost:2567
npm run dev:client   # terminal 2 — http://localhost:5173
```

## Game design (MVP)

- **2.5D side arena** — side-view camera, tanks move on X, hold-to-charge fire
- **Voxel terrain** — chunked grid, explosion stamps, greedy mesh
- **Turn-based** — move → aim → fire; wind; timers; full fuel each turn
- **Budget loadouts** — procedural tanks/weapons under a point cap
- **Lobbies** — public list + private join codes; unique bot pilots
- **Leaderboard** — post-match rankings persisted to SQLite

## Controls

| Input | Action |
|-------|--------|
| A / D | Move |
| W / S | Aim angle |
| Hold Space | Charge power |
| Release Space | Fire |
| F | Flip facing |
| P | Pass turn |
| 1–7 | Sandbox weapon select |

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev:client` | Vite dev server |
| `npm run dev:server` | Colyseus with hot reload |
| `npm run build:shared` | Compile shared package |
| `npm run build` | Build shared + server + client |
| `npm start` | Production server (serves client + Colyseus) |
| `npm run typecheck` | Typecheck all workspaces |

## Deploy (Railway)

One Railway service runs **Colyseus + Express + the built client** on the same origin (`https` / `wss`). That avoids CORS and mixed-content issues.

### Steps

1. Push this repo to GitHub.
2. [Railway](https://railway.app) → **New Project** → **Deploy from GitHub** → select the repo.
3. Use **one service** for the whole app (not separate client + server services).
4. Leave **Root Directory** empty (monorepo root). If Railway auto-created `@gunmetal-barrage/client` and `@gunmetal-barrage/server` services, delete/disable the extras and keep a single service pointed at the repo root.
5. Railway reads `railway.toml`:
   - **Install:** Nixpacks `npm ci` (includes devDependencies for the build)
   - **Build:** `npm run build`
   - **Start:** `npm start`
   - **Healthcheck:** `GET /health`
6. Deploy. Open the public URL — the game UI and WebSocket share the same host.

**Do not** set Root Directory to `packages/client` or `packages/server` — workspace packages need the monorepo root install.  
**Vercel** will fail for this repo (no Node/Colyseus runtime). Disconnect Vercel or ignore those checks; Railway is the intended host.

### Environment

| Variable | Required | Notes |
|----------|----------|--------|
| `PORT` | Auto | Railway injects this; server already uses `process.env.PORT` |
| `NODE_ENV` | Optional | Set `production` if not set by the platform |
| `VITE_SERVER_URL` | No | Only if you split client/server later. Leave **unset** so the client uses same-origin `wss://` |

Copy `.env.example` for local reference. Do not bake secrets into the Vite client.

### Local production smoke test

```bash
npm install
npm run build
npm start
# open http://localhost:2567
```

### Notes

- **SQLite** (`better-sqlite3`) lives on the container filesystem. Ephemeral disks lose leaderboard data on redeploy/restart unless you attach a Railway volume to the data path.
- **Vercel / static hosts** can serve only the client; multiplayer still needs this Node process (or another host) for Colyseus.
- Shared hosting (e.g. Hostinger shared) will not run the game server; a **VPS** can if you install Node 20+ and reverse-proxy WebSockets.

## License

Private / WIP.
