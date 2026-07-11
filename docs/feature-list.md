# Gun Metal Barrage — Feature List

Inventory of what the codebase implements, plus stubs and a suggested roadmap.
Last reviewed against the monorepo (`packages/shared`, `server`, `client`).

---

## Core game fantasy

| Feature | Status |
|--------|--------|
| Turn-based 2.5D artillery (Gunbound / Worms style) | Shipped |
| Side-view arena; tanks move on X, terrain has depth | Shipped |
| Destructible voxel terrain (craters reshape the map) | Shipped |
| Wind affects ballistics + visual debris | Shipped |
| Last tank standing + ranked standings | Shipped |

---

## Combat loop

| Feature | Details |
|--------|---------|
| **Turn phases** | `waiting` → `move`/`aim` → `resolving` → next turn / `ended` |
| **Move** | A/D, terrain-following climb, fuel budget, facing flip (F) |
| **Aim** | W/S angle (0–180°), Q/E power (5–100), short arc preview only |
| **Fire** | Space / FIRE primary; R / FIRE ALT secondary |
| **Pass** | P skips turn |
| **Turn timer** | Default 30s, then auto-end |
| **Full fuel each turn** | Chassis fuel refilled on turn start |
| **Wind per turn** | Rolled server-side each turn |
| **Kill credit** | Blast kills + last-attacker for falls/disconnects |
| **Disconnect** | Forfeit mid-match, no kill credit |

**Default match config** (`DEFAULT_MATCH_CONFIG`):

- Max players: 4  
- Loadout budget: 1000  
- Map: 192 × 96 × 12 voxels  
- Turn time: 30s  
- Fill bots: on  
- Sudden death turns: 20 *(config only — see stubs)*  

---

## Weapons

### Primaries (sandbox keys 1–7)

| Weapon | Behavior |
|--------|----------|
| **Peashooter** | Single ballistic shell |
| **Howitzer** | High lob, bigger blast, slower shell |
| **Scatter Shot** | One flight → submunitions around impact |
| **Bunker Buster** | Flatter drill arc; deep shaft + undercut (collapses cover) |
| **Ricochet Shell** | Up to 2 bounces then detonate |
| **Heat Seeker** | Homing toward nearest enemy after launch |
| **Triple Threat** | 3 tight shells (±2°) |

### Secondary specials

| Weapon | Behavior |
|--------|----------|
| **Mini Nuke** | Alt only, ×1 per match, huge lob blast + self-splash risk |

### Combat rules (weapon system)

- Multi-blast damage soft-caps (limits scatter one-shot abuse)
- Reduced self-damage vs enemy damage
- Terrain blast radius larger than damage radius (Worms-style map reshape)
- Analytic ballistics + voxel collision; wind as horizontal acceleration

---

## Loadouts & chassis

| Feature | Details |
|--------|---------|
| **Budget system** | Procedural roll under point cap (default 1000) |
| **Chassis pool** | Scout / Standard / Heavy / Fortress (HP, armor, mobility, fuel, size) |
| **Primary + optional secondary** | Secondary often Mini Nuke or alt gun |
| **Palette + callsign** | Random tank names (e.g. `Rusty Badger`) |
| **Deterministic seeds** | Loadouts from match seed + player id |

---

## Maps & terrain

| Feature | Details |
|--------|---------|
| **Biomes** | Meadow, desert, canyon, volcanic, arctic, ruins |
| **Themes** | Sky / fog / lighting per biome |
| **Landforms** | Multi-scale hills, gulfs, ridges, mesas, trenches, optional bridges |
| **Caves / props** | Caves + metal/rock ruins & spires |
| **Materials** | Air, dirt, sand, rock, metal, bedrock, grass |
| **Spawns** | Scattered pads, shuffled claim order, small jitter |
| **Terrain ops** | Sphere + ellipsoid stamps (Bunker Buster shaft/undercut) |

---

## Multiplayer & lobbies

| Feature | Details |
|--------|---------|
| **Public rooms** | Create / list / join from menu |
| **Private rooms** | Join codes |
| **Host controls** | Add bots, start match |
| **Ready state** | Ready before start |
| **Auto-fill bots** | If enabled and fewer than 2 participants |
| **Colyseus rooms** | Authoritative server simulation |
| **Same-origin production** | Client + server on Railway |

---

## Bots & identity

| Feature | Details |
|--------|---------|
| **Unique bot pilots** | Name, title, motto, accent, flair, skill |
| **Personas** | Brawler, camper, artillery, reckless, sniper, chaotic |
| **Persona AI** | Move range, weapon choice, aim noise / patience |
| **Tank flair** | Horn, banner, spikes, antenna, smokestack, scoop |
| **Bot ammo safety** | Avoid soft-lock on empty magazines |

---

## Modes & UI

| Mode | Features |
|------|----------|
| **Menu** | Callsign, public/private/sandbox, join code, room list, ranks; live ambient battlefield behind UI |
| **Lobby** | Players, bot personas, ready, start, leave |
| **Match HUD** | Wind meter, phase, timer, HP/fuel, weapons, power, turn banners/toasts |
| **Edge markers** | Off-screen tank indicators |
| **Results** | Rankings (place, kills, damage, score) |
| **Sandbox** | Offline; keys 1–7 / `[` `]` cycle weapons; full fire loop; Esc → menu |
| **Leaderboard** | SQLite API + UI (wins, kills, damage, matches, score) |

### Controls (reference)

| Input | Action |
|-------|--------|
| A / D | Move |
| W / S | Aim angle |
| Q / E (or , / .) | Lower / raise power |
| Space or FIRE | Fire primary |
| R or FIRE ALT | Fire secondary |
| F | Flip facing |
| P | Pass turn |
| 1–8 | Sandbox weapon select |
| [ ] | Sandbox cycle weapons |
| Esc | Sandbox → menu |

---

## Presentation (client)

| Feature | Details |
|--------|---------|
| **Three.js renderer** | Voxel chunks, tanks, shells, explosions |
| **Per-weapon VFX** | Shell shapes, trails, explosion profiles |
| **Environment** | Parallax hills, clouds, wind debris |
| **Camera** | Match intro (map → drop-ins → first pilot), shot lock/follow |
| **Short aim guide** | Early arc only (no free impact reticle) |
| **SFX** | Procedural Web Audio (UI, turn, charge, fire, impact) — no asset files |

---

## Persistence & ops

| Feature | Details |
|--------|---------|
| **Leaderboard DB** | `better-sqlite3` on disk (`data/gunmetal-barrage.db`) |
| **Healthcheck** | `GET /health` |
| **Deploy** | Nixpacks + Railway monorepo single service |
| **Ephemeral storage** | Leaderboard data is lost on Railway without an attached volume |

### Stack

| Layer | Tech |
|-------|------|
| Client | Vite, TypeScript, Three.js |
| Server | Node.js, Colyseus, Express |
| Shared | Types, proc-gen, ballistics, game rules |
| Physics | Analytic ballistics + voxel collision |

---

## Protocol stubs / unfinished

Defined in types or protocol but **not fully wired into gameplay**:

| Item | Notes |
|------|--------|
| **`suddenDeathTurns: 20`** | In `MatchConfig` only — no sudden-death logic in sim/room |
| **`ServerMsg.Chat`** | Protocol constant; no chat UI or handlers |
| **Human pilot identity** | Bots get full identity; humans are name-only |

---

## Roadmap (suggested)

### Shipped (playable now)

1. Online public / private lobbies + bots  
2. Turn-based move → power → fire  
3. Full weapon catalog + Mini Nuke alt  
4. Procedural maps, biomes, loadouts  
5. Destructible terrain + Bunker Buster collapse  
6. Wind + short aim preview  
7. Sandbox weapon lab  
8. Leaderboard + post-match rankings  

### Partial / polish

9. Sudden death (config exists; needs rules + UI)  
10. In-match chat (protocol only)  
11. Human cosmetics / personas (bot identity system ready)  
12. Persistent leaderboard volume on deploy  

### Not in code (likely next-game features)

13. Custom loadout builder (vs pure RNG)  
14. More secondaries / weapon unlocks  
15. Team modes / more FFA options beyond 4-player free-for-all  
16. Spectator / reconnection  
17. Match history / rematch  
18. Mobile / gamepad controls  
19. Music + richer audio pack  
20. Account / auth (leaderboard is name-keyed only)  

---

## Related docs

- Root [README.md](../README.md) — play URL, controls, deploy  
- [dev-and-deploy.md](./dev-and-deploy.md) — local testing + ship-to-Railway workflow (agent-safe)  
- Menu screenshot: [menu-screenshot.png](./menu-screenshot.png)  
