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
| `npm run build` | Build all packages |
| `npm run typecheck` | Typecheck all workspaces |

## License

Private / WIP.
