# Local development & production deploy

Straight-path guide for **Gun Metal Barrage** so humans and AI agents use the same workflow and do not break the live Railway app while iterating.

**Production URL:** https://gunmetal-barrageserver-production.up.railway.app/

**Repo:** monorepo at repo root (`packages/shared`, `packages/server`, `packages/client`).  
**Deploy surface:** one Railway service from the monorepo root (not a package subdirectory).

---

## Golden rules (agents + humans)

1. **Never treat Railway production as a dev sandbox.** Develop and verify locally first.
2. **Default work happens on a feature branch**, not by force-pushing or rewriting `main` history.
3. **`main` is production.** Merging to `main` (and the subsequent push that Railway watches) is the prod release.
4. **Do not change Railway service Root Directory** to `packages/client` or `packages/server`. Always monorepo root.
5. **Do not set `VITE_SERVER_URL` on Railway** unless you intentionally split client/server origins. Same-origin `wss://` is the production design.
6. **Do not re-run `npm ci` in Railway’s build step.** Install is already handled by Nixpacks; `railway.toml` only runs `npm run build`.
7. **Leaderboard SQLite is ephemeral on Railway** without a volume — local DBs and prod DBs are unrelated.
8. **Prefer reversible local commands** (`npm run typecheck`, `npm run build`, sandbox play). Avoid production DB/API mutation tools that do not exist yet.

---

## Environments at a glance

| Environment | How you run it | Client URL | Game server / WS | Serves static client? |
|-------------|----------------|------------|------------------|------------------------|
| **Local split dev** (default) | Two processes | http://localhost:5173 | Colyseus on :2567 (`ws://hostname:2567`) | No — Vite HMR |
| **Local prod-like** | `npm run build` + `npm start` | http://localhost:2567 | Same process / origin | Yes (`packages/client/dist`) |
| **Railway production** | Auto on deploy from Git | Public Railway HTTPS URL | Same origin (`wss://host`) | Yes |

### How the client picks a WebSocket URL

From `packages/client/src/net/Client.ts`:

1. If `VITE_SERVER_URL` is set at **build** time → use that.
2. Else if production build (`import.meta.env.PROD`) → same-origin `ws:` / `wss:`.
3. Else (Vite dev) → `ws://${location.hostname}:2567`.

Vite proxies `/api` and `/colyseus` to `:2567` in dev (`packages/client/vite.config.ts`). The game client still connects Colyseus to port **2567** by default in local split mode.

---

## Prerequisites

- **Node.js ≥ 20** (see root `package.json` `engines`)
- **npm** (lockfile is `package-lock.json`; use `npm ci` / `npm install`, not pnpm, for install parity with Railway)
- Git access to this repo
- Optional: [Railway CLI](https://docs.railway.app/guides/cli) for logs/status (not required to ship if GitHub → Railway is already wired)

---

## Local development (safe default)

This is the day-to-day path. It does **not** touch Railway.

### 1. Install & build shared types once

```bash
# From monorepo root
npm install
npm run build:shared
```

Re-run `npm run build:shared` after edits under `packages/shared/` if the server process was started without a path that recompiles shared (client Vite aliases shared source; server uses the built package in some setups — when in doubt, rebuild shared).

### 2. Run server + client (two terminals)

```bash
# Terminal 1 — Colyseus + Express API
npm run dev:server
# → http://localhost:2567  (health: GET /health)
```

```bash
# Terminal 2 — Vite client
npm run dev:client
# → http://localhost:5173
```

Play in the browser at **http://localhost:5173**.

Optional one-liner (backgrounds both; harder to read logs):

```bash
npm run dev
```

### 3. What to test locally before any prod push

| Check | Command / action |
|-------|------------------|
| Types | `npm run typecheck` |
| Full build | `npm run build` |
| Sandbox weapons / terrain | Menu → **Sandbox** (keys 1–7, `[` `]`) |
| Lobby + bots | Menu → **Public Match** (or private + code); host adds bots / starts |
| API | `curl -s http://localhost:2567/health` |
| Leaderboard API | `curl -s http://localhost:2567/api/leaderboard` (or via Vite proxy on :5173) |

### 4. Local data

- SQLite lives under `data/` when the server writes leaderboard (path relative to process cwd).
- `*.db` is gitignored — local scores never go to prod.
- Delete local `data/` anytime to reset leaderboard.

### 5. Environment variables (local)

Copy from `.env.example` only if you need overrides. **Do not commit `.env`.**

| Variable | Local split dev | Local prod-like / Railway |
|----------|-----------------|---------------------------|
| `PORT` | Default `2567` | Railway injects; local prod-like can use `PORT=2567` |
| `NODE_ENV` | unset / development | `production` for prod-like |
| `VITE_SERVER_URL` | Usually **unset** | **Unset** on Railway |

---

## Local production-like run (catch deploy bugs)

Use this before promoting to `main` when you change:

- Server static serving
- Client build / assets
- Same-origin WebSocket behavior
- `railway.toml` / `nixpacks.toml` / root scripts

```bash
# From monorepo root
npm install
npm run build
npm start
# open http://localhost:2567
```

This matches Railway’s runtime shape: one Node process, built Vite client from `packages/client/dist`, Colyseus on the same port.

**Do not** set `VITE_SERVER_URL` for this mode if you want same-origin behavior.

---

## Git workflow (protect production)

Railway is configured to deploy from this GitHub repo. Treat **`main` as production**.

### Recommended flow

```text
1. git checkout -b feat/short-description   # or fix/...
2. Implement + test locally (split dev and/or prod-like)
3. npm run typecheck && npm run build
4. Commit on the feature branch
5. Push branch → open PR → review
6. Merge to main only when ready for prod
7. Confirm Railway deploy health (see below)
```

### Branch naming (suggested)

- `feat/...` — new gameplay / features  
- `fix/...` — bugfixes  
- `chore/...` — tooling, docs, deps  

### What not to do

- Do not push untested experiments straight to `main`.
- Do not `git push --force` to `main`.
- Do not amend/rebase commits already on `main` without an explicit human request.
- Do not change production Railway env vars as part of “just testing.”
- Do not point a second experimental service at the same production custom domain without a deliberate plan.

### Optional: staging (not required today)

If you need a cloud preview later without touching prod:

1. Create a **second Railway service/environment** (e.g. `staging`) from the same repo.
2. Deploy a non-`main` branch or a separate Railway environment that only tracks `staging`.
3. Keep production service pinned to `main` only.

Until that exists, **local prod-like + PR on `main`** is the release bar.

---

## Push to production (when ready)

### Preconditions checklist

- [ ] Feature branch tested on http://localhost:5173 (and ideally http://localhost:2567 after `npm run build && npm start`)
- [ ] `npm run typecheck` passes
- [ ] `npm run build` succeeds
- [ ] No secrets in client code or committed `.env`
- [ ] Railway config still monorepo-root (`railway.toml`, `nixpacks.toml` untouched unless intentional)
- [ ] PR reviewed / you intentionally own the merge

### Ship steps

```bash
# On your feature branch, after tests
git status
git push -u origin HEAD

# Open PR (example with GitHub CLI)
gh pr create --title "..." --body "..."

# After approval / self-review: merge to main
gh pr merge --merge   # or merge via GitHub UI

# Ensure main is on remote
git checkout main
git pull origin main
```

Railway should build with:

| Phase | Command / config |
|-------|------------------|
| Install | Nixpacks `npm ci` (devDependencies kept via `NPM_CONFIG_PRODUCTION=false`) |
| Build | `npm run build` only (`railway.toml`) |
| Start | `npm start` |
| Health | `GET /health` |

### Post-deploy verification

1. Open production URL — menu loads over HTTPS.  
2. `GET https://<prod-host>/health` → `{ "ok": true, ... }`.  
3. Smoke: Sandbox or quick public match with bots.  
4. If deploy fails: check Railway build logs for `EBUSY` / wrong Root Directory / missing Node 20 toolchain (see README deploy notes).

### Rollback (high level)

- Revert the bad commit on `main` and push (preferred for auditability), **or** redeploy a previous successful Railway deployment from the Railway dashboard.
- Do not “fix forward” with half-baked hotfixes on production without a local repro.

---

## Railway configuration reference

Config lives in-repo (source of truth):

| File | Role |
|------|------|
| `railway.toml` | Build command, start, healthcheck, watch patterns |
| `nixpacks.toml` | Node 20, native build deps for `better-sqlite3` |
| `.env.example` | Documented env vars (no secrets) |

### Service settings (dashboard)

- **Root Directory:** empty / monorepo root  
- **One service** for client + server  
- **PORT:** injected by Railway  
- **VITE_SERVER_URL:** leave unset  

### SQLite on Railway

- DB file is on the container filesystem unless a volume is attached.  
- Redeploys/restarts can wipe leaderboard.  
- Local and prod leaderboards are never shared.

---

## Agent playbook (copy-paste consistency)

When an AI agent works on this repo, it should:

1. **Assume production is live on Railway from `main`.**  
2. **Make code changes only; never deploy by changing Railway dashboard settings unless the human asks.**  
3. **Run verification locally:**
   ```bash
   npm install          # if deps missing
   npm run build:shared # after shared edits
   npm run typecheck
   npm run build        # before claiming ship-ready
   ```
4. **Start local servers only when needed for interactive testing** (`npm run dev:server` + `npm run dev:client`).  
5. **Open PRs / push to `main` only when the human has asked to ship** (or explicit “merge and deploy”). Default is implement + verify + stop.  
6. **Not invent env vars** beyond `.env.example`.  
7. **Not run destructive git commands** (`reset --hard`, force-push) against shared branches without explicit approval.  
8. **Point humans/agents at this doc** for “how do I test / ship?”

### Quick decision tree

```text
Need to try a game idea?
  → feature branch + local split dev (5173 + 2567)

Changed shared physics / server protocol?
  → typecheck + build; retest multiplayer lobby + fire path

Changed static serving / Railway config?
  → local prod-like (build + start on :2567)

Ready for players on the live URL?
  → PR → merge main → verify /health + smoke on Railway

Unsure if it will break prod?
  → do not merge; stay on branch and re-test locally
```

---

## Common pitfalls

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| Client connects to wrong host in dev | `VITE_SERVER_URL` set in env | Unset for normal local split dev |
| Empty screen / no WS on Railway | Client built with wrong `VITE_SERVER_URL` | Leave unset; same-origin |
| Railway build EBUSY on `node_modules` | Build step re-runs `npm ci` | Build command must be only `npm run build` |
| Deploy builds wrong package | Root Directory set to a package | Clear Root Directory |
| Leaderboard empty after deploy | Ephemeral disk | Expected without volume; local DB unrelated |
| Shared types out of date on server | Forgot rebuild | `npm run build:shared` then restart server |
| `npm run dev` hard to debug | Combined background processes | Use two terminals: `dev:server` + `dev:client` |

---

## Related docs

- [README.md](../README.md) — features, controls, short deploy blurb  
- [feature-list.md](./feature-list.md) — product feature inventory  
- `.env.example` — environment variable template  
- `railway.toml` / `nixpacks.toml` — production build contract  
