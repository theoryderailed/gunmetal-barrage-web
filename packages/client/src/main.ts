import {
  DEFAULT_MATCH_CONFIG,
  allWeapons,
  clampAngle,
  clampPower,
  formatWeaponBehavior,
  applyIdentityToPalette,
  generateBotIdentity,
  generateLoadout,
  generateMap,
  getWeaponById,
  getWeaponByIndex,
  hashSeed,
  makeTestLoadout,
  fuelCostPerUnit,
  moveAlongTerrain,
  moveSpeed,
  blastsToTerrainOps,
  resolveBlastDamage,
  simulateWeaponFire,
  type Loadout,
  type MatchResultEntry,
  type PilotIdentity,
  type PlayerState,
  type TerrainOp,
  type WeaponDef,
} from "@gunmetal-barrage/shared";
import { GameRenderer } from "./render/GameRenderer";
import {
  GameClient,
  fetchLeaderboard,
  fetchPublicRooms,
  type LobbyPlayer,
} from "./net/Client";
import {
  renderHud,
  renderLeaderboard,
  renderLoadoutReveal,
  renderLobby,
  renderMenu,
  renderResults,
} from "./ui/screens";
import {
  computeEdgeMarkers,
  updateEdgeMarkerLayer,
} from "./ui/edgeMarkers";
import { updateNotifications } from "./ui/notifications";
import { sfx } from "./audio/Sfx";

type Mode = "menu" | "lobby" | "playing" | "results" | "sandbox" | "leaderboard";

/** Server events that must wait until the shell lands visually. */
interface PendingImpact {
  terrainOps: TerrainOp[];
  damages: { targetId: string; amount: number; sourceId: string; x?: number; y?: number }[];
  eliminated: { id: string; reason: string }[];
  /** Full player snapshot from match_state — applied on impact so HP doesn't jump early. */
  deferredPlayers: PlayerState[] | null;
  deferredWind: number | null;
  deferredCurrentId: string | null;
  deferredPhase: string | null;
  matchEnd: MatchResultEntry[] | null;
}

const canvas = document.getElementById("game-canvas") as HTMLCanvasElement;
const uiRoot = document.getElementById("ui-root") as HTMLElement;
const appRoot = document.getElementById("app") as HTMLElement;
const renderer = new GameRenderer(canvas);

let mode: Mode = "menu";
let displayName = localStorage.getItem("tdw-name") || "Commander";
let rooms: Awaited<ReturnType<typeof fetchPublicRooms>> = [];
let lobbyPlayers: LobbyPlayer[] = [];
let lobbyMeta = {
  title: "Gun Metal Barrage",
  joinCode: "",
  isPrivate: false,
  hostId: null as string | null,
};
let ready = false;
/** Three tanks offered in lobby character select */
let myLoadoutChoices: Loadout[] = [];
let mySelectedLoadoutIndex = 0;
/** Dead but still in room watching */
let spectating = false;
let players: PlayerState[] = [];
let wind = 0;
let currentPlayerId: string | null = null;
let phase = "waiting";
let turnEndsAt = 0;
let toast = "";
let toastTimer = 0;
let rankings: MatchResultEntry[] = [];
let myId: string | null = null;
/** Sandbox catalog index into WEAPON_POOL (1–7 keys). */
let sandboxWeaponIndex = 0;
let turnTimeMax = 30;
let banner = "";
let bannerUntil = 0;
/** Weapon of the shot currently resolving (for impact VFX). */
let pendingWeapon: WeaponDef | null = null;
const keys = new Set<string>();

/** After a real shell is spawned, lock move until the next turn starts. */
let postShotLock = false;
/** Power units per second while holding Q/E. */
const POWER_ADJUST_RATE = 55;
/** Comfortable default power at turn start (not min). */
const DEFAULT_POWER = 50;

/** Active in-flight shot waiting for impact resolution. */
let pendingImpact: PendingImpact | null = null;

function createPendingImpact(): PendingImpact {
  return {
    terrainOps: [],
    damages: [],
    eliminated: [],
    deferredPlayers: null,
    deferredWind: null,
    deferredCurrentId: null,
    deferredPhase: null,
    matchEnd: null,
  };
}

function resolveImpact(): void {
  const pending = pendingImpact;
  pendingImpact = null;
  if (!pending) return;

  if (pending.terrainOps.length > 0) {
    renderer.applyTerrainOps(pending.terrainOps, pendingWeapon ?? undefined);
  }
  pendingWeapon = null;

  // Prefer deferred authoritative HP, but still show per-hit VFX from damage events
  if (pending.deferredPlayers) {
    players = pending.deferredPlayers;
  }

  if (pending.terrainOps.length > 0) {
    const big = pending.terrainOps.some((o) => o.radius >= 4.5);
    sfx.impact(big);
  }
  for (const d of pending.damages) {
    const p = players.find((x) => x.id === d.targetId);
    if (!p) continue;
    // If we didn't get match_state yet, apply damage locally
    if (!pending.deferredPlayers) {
      p.hp = Math.max(0, p.hp - d.amount);
    }
    const midZ = renderer.getMidZ();
    renderer.flashTank(d.targetId);
    renderer.showDamageNumber(p.x, p.y + 1.2, midZ + 0.5, d.amount);
    sfx.hit();
    showToast(`${p.name} -${d.amount} HP`);
  }

  for (const e of pending.eliminated) {
    const p = players.find((x) => x.id === e.id);
    if (p) {
      p.alive = false;
      p.hp = 0;
      if (e.id === myId) {
        showMatchToast("You're out — spectate or leave", 3200);
        spectating = true;
      }
    }
  }

  if (pending.deferredWind !== null) wind = pending.deferredWind;
  if (pending.deferredCurrentId !== null) currentPlayerId = pending.deferredCurrentId;
  if (pending.deferredPhase !== null) phase = pending.deferredPhase;

  const world = renderer.getWorld();
  if (world) {
    for (const p of players) {
      if (!p.alive) continue;
      const g = world.sampleGroundY(p.x, renderer.getMidZ());
      if (g >= 0) p.y = g;
    }
  }
  renderer.syncPlayers(players, { hardSnap: true });

  if (pending.matchEnd) {
    mode = "results";
    rankings = pending.matchEnd;
    renderResults(uiRoot, rankings, () => {
      net.leave();
      void showMenu();
    });
  }
}

const net = new GameClient({
  onLobby: (data) => {
    lobbyPlayers = data.players;
    lobbyMeta = {
      title: data.title,
      joinCode: data.joinCode,
      isPrivate: data.config.isPrivate,
      hostId: data.hostId,
    };
    if (data.myLoadoutChoices?.length) {
      myLoadoutChoices = data.myLoadoutChoices;
    }
    if (typeof data.mySelectedLoadoutIndex === "number") {
      mySelectedLoadoutIndex = data.mySelectedLoadoutIndex;
    }
    // Selecting a kit un-readies on the server
    const me = data.players.find((p) => p.id === net.sessionId);
    if (me) ready = me.ready;
    if (mode === "lobby") showLobby();
  },
  onMatchStarted: (data) => {
    stopAmbientDemo();
    mode = "playing";
    spectating = false;
    players = data.players.map((p) => ({
      ...p,
      // Full fuel at match start (matches server turn refill)
      fuel: p.loadout?.chassis.fuel ?? p.fuel,
    }));
    wind = data.wind;
    myId = net.sessionId;
    pendingImpact = null;
    postShotLock = false;
    renderer.loadMatch(data.matchSeed, data.config, players);
    renderer.setWind(data.wind);
    // Full map → drop-ins → zoom to first pilot
    renderer.playMatchIntro(players, data.firstPlayerId ?? null);
    // Compact loadout cards during the wide shot
    renderLoadoutReveal(uiRoot, players, myId);
    const mapLabel = renderer.getMapName();
    showToast(mapLabel ? `Map: ${mapLabel}` : "Dropping in…");
    sfx.ui();
    window.setTimeout(() => {
      if (mode === "playing") {
        uiRoot.innerHTML = "";
      }
    }, 3200);
  },
  onTurnStart: (data) => {
    postShotLock = false;
    currentPlayerId = data.playerId;
    wind = data.wind;
    phase = data.phase;
    turnTimeMax = data.timeSec;
    turnEndsAt = performance.now() + data.timeSec * 1000;
    renderer.setWind(data.wind);
    const p = players.find((x) => x.id === data.playerId);
    if (p) {
      p.power = DEFAULT_POWER;
      // Full fuel every turn (authoritative; also local for HUD)
      if (p.loadout) p.fuel = p.loadout.chassis.fuel;
    }
    // Don't yank camera if intro still running
    if (!renderer.isIntroPlaying()) {
      renderer.focusPlayer(p);
    }
    sfx.turnStart(data.playerId === myId);
    if (data.playerId === myId) {
      showBanner("YOUR TURN", 1600);
      showToast(
        `Your turn · Q/E power · SPACE fire · ${data.timeSec}s`,
      );
    } else {
      showBanner(`${p?.name ?? "Enemy"}'s turn`, 1400);
      showToast(`${p?.name ?? "Enemy"}'s turn`);
    }
    renderer.syncPlayers(players);
  },
  onPlayerMoved: (data) => {
    const p = players.find((x) => x.id === data.id);
    if (!p) return;
    // Local player: soft reconcile (prediction already moved us)
    if (p.id === myId) {
      const err = Math.hypot(p.x - data.x, p.y - data.y);
      if (err > 1.5) {
        p.x = data.x;
        p.y = data.y;
      } else {
        // Blend toward server to avoid rubber-band
        p.x += (data.x - p.x) * 0.35;
        p.y += (data.y - p.y) * 0.35;
      }
    } else {
      p.x = data.x;
      p.y = data.y;
    }
    p.fuel = data.fuel;
    p.facing = data.facing;
    renderer.syncPlayers(players);
  },
  onPlayerAimed: (data) => {
    const p = players.find((x) => x.id === data.id);
    if (!p) return;
    p.angle = data.angle;
    p.power = data.power;
    p.facing = data.facing;
    renderer.syncPlayers(players);
  },
  onProjectile: (data) => {
    renderer.hideTrajectory();
    pendingImpact = createPendingImpact();
    const shooter = players.find((p) => p.id === data.ownerId);
    const weapon =
      (data.weaponId
        ? shooter?.loadout?.primary?.id === data.weaponId
          ? shooter.loadout.primary
          : shooter?.loadout?.secondary?.id === data.weaponId
            ? shooter.loadout.secondary
            : null
        : null) ??
      shooter?.loadout?.primary ??
      null;
    pendingWeapon = weapon;
    phase = "resolving";
    if (data.ownerId === myId) postShotLock = true;
    const color = weapon?.color ?? 0xff5522;
    const wname = weapon?.name ?? "Shell";
    showToast(`Fired ${wname}`);
    renderer.playProjectile(
      data.path,
      () => resolveImpact(),
      color,
      weapon ?? undefined,
      data.paths,
    );
  },
  onTerrain: (data) => {
    // Hold crater until shell lands
    if (pendingImpact || renderer.isProjectileFlying()) {
      if (!pendingImpact) pendingImpact = createPendingImpact();
      pendingImpact.terrainOps.push(...data.ops);
      return;
    }
    renderer.applyTerrainOps(data.ops);
  },
  onDamage: (data) => {
    if (pendingImpact || renderer.isProjectileFlying()) {
      if (!pendingImpact) pendingImpact = createPendingImpact();
      pendingImpact.damages.push(data);
      return;
    }
    const p = players.find((x) => x.id === data.targetId);
    if (p) {
      p.hp = Math.max(0, p.hp - data.amount);
      renderer.flashTank(data.targetId);
      renderer.showDamageNumber(
        p.x,
        p.y + 1.2,
        renderer.getMidZ() + 0.5,
        data.amount,
      );
      showToast(`${p.name} -${data.amount} HP`);
    }
    renderer.syncPlayers(players);
  },
  onEliminated: (data) => {
    if (pendingImpact || renderer.isProjectileFlying()) {
      if (!pendingImpact) pendingImpact = createPendingImpact();
      pendingImpact.eliminated.push(data);
      return;
    }
    const p = players.find((x) => x.id === data.id);
    if (p) {
      p.alive = false;
      p.hp = 0;
      if (data.id === myId) {
        showMatchToast("You're out — spectate or leave", 3200);
        spectating = true;
      }
    }
    renderer.syncPlayers(players);
  },
  onMatchState: (data) => {
    // During flight, don't snap HP/positions early — queue for impact
    if (pendingImpact || renderer.isProjectileFlying()) {
      if (!pendingImpact) pendingImpact = createPendingImpact();
      pendingImpact.deferredPlayers = data.players;
      pendingImpact.deferredWind = data.wind;
      pendingImpact.deferredCurrentId = data.currentPlayerId;
      pendingImpact.deferredPhase = data.phase;
      return;
    }
    players = data.players;
    wind = data.wind;
    currentPlayerId = data.currentPlayerId;
    phase = data.phase;
    renderer.syncPlayers(players);
  },
  onMatchEnd: (data) => {
    if (pendingImpact || renderer.isProjectileFlying()) {
      if (!pendingImpact) pendingImpact = createPendingImpact();
      pendingImpact.matchEnd = data.rankings;
      return;
    }
    mode = "results";
    rankings = data.rankings;
    renderResults(uiRoot, rankings, () => {
      net.leave();
      void showMenu();
    });
  },
  onError: (data) => showToast(data.message),
  onLeave: () => {
    if (mode !== "menu" && mode !== "results") void showMenu();
  },
});

async function showMenu(): Promise<void> {
  mode = "menu";
  try {
    rooms = await fetchPublicRooms();
  } catch {
    rooms = [];
  }
  sfx.ui();
  ensureAmbientDemo();
  renderMenu(uiRoot, {
    name: displayName,
    rooms,
    onName: (n) => {
      displayName = n.slice(0, 20) || "Commander";
      localStorage.setItem("tdw-name", displayName);
    },
    onCreatePublic: async () => {
      try {
        sfx.ui();
        await net.createMatch({
          name: `${displayName}'s Game`,
          isPrivate: false,
          displayName,
          fillBots: true,
        });
        mode = "lobby";
        ready = false;
        showLobby();
      } catch (e) {
        showToast(`Failed to create: ${String(e)}`);
      }
    },
    onCreatePrivate: async () => {
      try {
        sfx.ui();
        await net.createMatch({
          name: `${displayName}'s Private`,
          isPrivate: true,
          displayName,
          fillBots: true,
        });
        mode = "lobby";
        ready = false;
        showLobby();
      } catch (e) {
        showToast(`Failed to create: ${String(e)}`);
      }
    },
    onJoinCode: async (code) => {
      try {
        sfx.ui();
        await net.joinByCode(code, displayName);
        mode = "lobby";
        ready = false;
        showLobby();
      } catch (e) {
        showToast(String(e));
      }
    },
    onJoinRoom: async (id) => {
      try {
        sfx.ui();
        await net.joinById(id, displayName);
        mode = "lobby";
        ready = false;
        showLobby();
      } catch (e) {
        showToast(String(e));
      }
    },
    onRefreshRooms: () => {
      sfx.ui();
      void showMenu();
    },
    onShowLeaderboard: async () => {
      sfx.ui();
      mode = "leaderboard";
      ensureAmbientDemo();
      try {
        const entries = await fetchLeaderboard();
        renderLeaderboard(uiRoot, entries, () => {
          void showMenu();
        });
      } catch {
        renderLeaderboard(uiRoot, [], () => {
          void showMenu();
        });
      }
    },
    onSandbox: () => {
      sfx.ui();
      startSandbox();
    },
  });
}

function showLobby(): void {
  mode = "lobby";
  ensureAmbientDemo();
  renderLobby(uiRoot, {
    title: lobbyMeta.title,
    joinCode: lobbyMeta.joinCode,
    isPrivate: lobbyMeta.isPrivate,
    players: lobbyPlayers,
    isHost: lobbyMeta.hostId === net.sessionId,
    ready,
    loadoutChoices: myLoadoutChoices,
    selectedLoadoutIndex: mySelectedLoadoutIndex,
    onSelectLoadout: (index) => {
      mySelectedLoadoutIndex = index;
      ready = false;
      net.sendSelectLoadout(index);
      showLobby();
    },
    onReady: (r) => {
      ready = r;
      net.sendReady(r);
      showLobby();
    },
    onAddBot: () => net.addBot(),
    onStart: () => {
      stopAmbientDemo();
      net.startMatch();
    },
    onLeave: () => {
      net.leave();
      myLoadoutChoices = [];
      mySelectedLoadoutIndex = 0;
      void showMenu();
    },
  });
}

// ── Ambient background battle (menu + lobby) ────────────────────────────

let ambientActive = false;
let ambientNextShotAt = 0;
let ambientReloadAt = 0;
let ambientCamPhase = 0;
let ambientShotCount = 0;

function stopAmbientDemo(): void {
  ambientActive = false;
}

function ensureAmbientDemo(): void {
  if (ambientActive) return;
  if (mode !== "menu" && mode !== "lobby" && mode !== "leaderboard") return;
  bootAmbientArena();
}

function bootAmbientArena(): void {
  const seed = (Date.now() ^ (Math.random() * 1e9)) >>> 0;
  const config = {
    ...DEFAULT_MATCH_CONFIG,
    mapWidth: 160,
    mapHeight: 80,
    mapDepth: 12,
    maxPlayers: 4,
  };
  const map = generateMap(seed, config);
  const demoPlayers: PlayerState[] = [];
  const n = Math.min(3, map.spawns.length);
  for (let i = 0; i < n; i++) {
    const sp = map.spawns[i]!;
    const id = `ambient-${i}`;
    const identity = generateBotIdentity(hashSeed(seed, id));
    const loadout = generateLoadout(hashSeed(seed, id, "lo"), config.budget);
    loadout.palette = applyIdentityToPalette(loadout.palette, identity);
    loadout.name = identity.displayName;
    demoPlayers.push(
      makePlayer(
        id,
        identity.displayName,
        loadout,
        sp.x + 0.5,
        sp.x < config.mapWidth / 2 ? 1 : -1,
        true,
        identity,
      ),
    );
  }
  players = demoPlayers;
  myId = null;
  currentPlayerId = demoPlayers[0]?.id ?? null;
  wind = (Math.random() - 0.5) * 1.2;
  phase = "move";
  postShotLock = false;
  pendingImpact = null;
  renderer.loadMatch(seed, config, players);
  renderer.setWind(wind);
  // Snap tanks to surface after load
  const world = renderer.getWorld();
  if (world) {
    for (const p of players) {
      const g = world.sampleGroundY(p.x, renderer.getMidZ());
      if (g >= 0) p.y = g;
    }
  }
  renderer.syncPlayers(players, { hardSnap: true });
  renderer.frameFullMap(true);
  ambientActive = true;
  ambientShotCount = 0;
  ambientNextShotAt = performance.now() + 1600;
  ambientReloadAt = performance.now() + 45000;
  ambientCamPhase = Math.random() * Math.PI * 2;
}

function updateAmbient(dt: number, now: number): void {
  if (!ambientActive) return;
  if (mode !== "menu" && mode !== "lobby" && mode !== "leaderboard") {
    ambientActive = false;
    return;
  }

  // Slow cinematic pan across the map
  ambientCamPhase += dt * 0.12;
  const mapW = 160;
  const cx = mapW * 0.5 + Math.sin(ambientCamPhase) * mapW * 0.22;
  const cy = 32 + Math.sin(ambientCamPhase * 0.7) * 6;
  if (!renderer.isProjectileFlying() && !renderer.isCameraLockedOnShot()) {
    renderer.panAmbient(cx, cy, dt);
  }

  if (now > ambientReloadAt || ambientShotCount > 8) {
    bootAmbientArena();
    return;
  }

  if (now < ambientNextShotAt || renderer.isProjectileFlying() || pendingImpact) {
    return;
  }

  const alive = players.filter((p) => p.alive && p.loadout);
  if (alive.length < 2) {
    bootAmbientArena();
    return;
  }

  const shooter = alive[Math.floor(Math.random() * alive.length)]!;
  let target = alive[Math.floor(Math.random() * alive.length)]!;
  if (target.id === shooter.id) {
    target = alive.find((p) => p.id !== shooter.id) ?? target;
  }

  const world = renderer.getWorld();
  if (!world || !shooter.loadout) return;

  // Aim roughly at target with noise
  const dx = target.x - shooter.x;
  shooter.facing = dx >= 0 ? 1 : -1;
  const dist = Math.abs(dx);
  shooter.angle = clampAngle(35 + Math.random() * 40 + dist * 0.08);
  shooter.power = clampPower(40 + Math.random() * 50);
  const weapon = shooter.loadout.primary;
  const midZ = renderer.getMidZ();

  const fired = simulateWeaponFire(world, {
    weapon,
    tankX: shooter.x,
    tankY: shooter.y,
    midZ,
    facing: shooter.facing,
    angleDeg: shooter.angle,
    power: shooter.power,
    wind,
    chassisSize: shooter.loadout.chassis.size,
    seekTargets: alive
      .filter((t) => t.id !== shooter.id)
      .map((t) => ({ x: t.x, y: t.y })),
  });

  ambientShotCount++;
  ambientNextShotAt = now + 2200 + Math.random() * 1800;
  renderer.hideTrajectory();
  renderer.playProjectile(
    fired.path,
    () => {
      if (!ambientActive) return;
      if (fired.blasts.length) {
        sfx.impact(fired.blasts.some((b) => b.radius >= 4.5));
        const ops = blastsToTerrainOps(fired.blasts, weapon).map((op) =>
          op.kind === "ellipsoid"
            ? op
            : { ...op, radius: op.radius * 0.85 },
        );
        renderer.applyTerrainOps(ops, weapon);
      }
      // Light vanity damage / flash
      for (const t of players) {
        if (!t.alive || t.id === shooter.id) continue;
        for (const b of fired.blasts) {
          const d = Math.hypot(t.x - b.x, t.y - b.y);
          if (d < b.radius + 1.5) {
            renderer.flashTank(t.id);
            t.hp = Math.max(10, t.hp - 8);
          }
        }
        const g = world.sampleGroundY(t.x, midZ);
        if (g >= 0) t.y = g;
      }
      const g0 = world.sampleGroundY(shooter.x, midZ);
      if (g0 >= 0) shooter.y = g0;
      renderer.syncPlayers(players);
    },
    weapon.color ?? 0xff5522,
    weapon,
    fired.paths,
  );
  sfx.fire(shooter.power);
}

function startSandbox(): void {
  stopAmbientDemo();
  mode = "sandbox";
  sandboxWeaponIndex = 0;
  const seed = (Date.now() >>> 0) ^ 0xdead;
  const config = {
    ...DEFAULT_MATCH_CONFIG,
    mapWidth: 160,
    mapHeight: 80,
    mapDepth: 12,
  };
  const map = generateMap(seed, config);
  // Fixed standard hull + catalog weapon so tests are deterministic
  const loadout = makeTestLoadout(getWeaponByIndex(sandboxWeaponIndex));
  const dummyId = generateBotIdentity(hashSeed(seed, "dummy"));
  const enemyLo = makeTestLoadout(getWeaponByIndex(0));
  enemyLo.palette = applyIdentityToPalette(enemyLo.palette, dummyId);
  enemyLo.name = `${dummyId.displayName}'s Standard`;
  const sp0 = map.spawns[0] ?? { x: 24, y: 40 };
  const sp1 = map.spawns[1] ?? { x: 120, y: 40 };
  players = [
    makePlayer("local", displayName, loadout, sp0.x + 0.5, 1, false, null),
    makePlayer(
      "dummy",
      dummyId.displayName,
      enemyLo,
      sp1.x + 0.5,
      -1,
      true,
      dummyId,
    ),
  ];
  wind = 0.4;
  currentPlayerId = "local";
  myId = "local";
  phase = "move";
  turnEndsAt = performance.now() + 999_999;
  renderer.loadMatch(seed, config, players);
  renderer.setWind(wind);
  showToast(`Map: ${renderer.getMapName()}`);
  const world = renderer.getWorld();
  if (world) {
    for (const p of players) {
      const g = world.sampleGroundY(p.x, renderer.getMidZ());
      if (g >= 0) p.y = g;
    }
  }
  renderer.syncPlayers(players);
  uiRoot.innerHTML = "";
  const w = getWeaponByIndex(sandboxWeaponIndex);
  showToast(`Sandbox · ${w.name} · keys 1–7 switch weapons`);
}

function equipSandboxWeapon(index: number): void {
  if (mode !== "sandbox") return;
  const catalog = allWeapons();
  sandboxWeaponIndex =
    ((index % catalog.length) + catalog.length) % catalog.length;
  const me = players.find((p) => p.id === myId);
  if (!me) return;
  const weapon = getWeaponByIndex(sandboxWeaponIndex);
  me.loadout = makeTestLoadout(weapon);
  me.hp = me.loadout.chassis.maxHp;
  me.fuel = me.loadout.chassis.fuel;
  me.primaryAmmo = weapon.id === "peashooter" ? 99 : weapon.maxAmmo;
  me.secondaryAmmo = 0;
  me.alive = true;
  // Reset dummy HP so each weapon test is clean
  const dummy = players.find((p) => p.id === "dummy");
  if (dummy?.loadout) {
    dummy.hp = dummy.loadout.chassis.maxHp;
    dummy.alive = true;
  }
  renderer.syncPlayers(players);
  const note = weapon.secondaryOnly ? " (special · 1 shot)" : "";
  showToast(
    `${sandboxWeaponIndex + 1}. ${weapon.name}${note} — ${formatWeaponBehavior(weapon)}`,
  );
}

/** When limited ammo is spent, Peashooter is always available with ∞ ammo. */
function equipPeashooterFallback(me: PlayerState): void {
  const pea = getWeaponById("peashooter");
  if (!pea || !me.loadout) return;
  me.loadout = { ...me.loadout, primary: { ...pea } };
  me.primaryAmmo = 99;
  renderer.syncPlayers(players);
}

function makePlayer(
  id: string,
  name: string,
  loadout: PlayerState["loadout"],
  x: number,
  facing: 1 | -1,
  isBot: boolean,
  identity: PilotIdentity | null = null,
): PlayerState {
  return {
    id,
    sessionId: id,
    name,
    isBot,
    ready: true,
    loadout,
    identity,
    x,
    y: 40,
    facing,
    hp: loadout!.chassis.maxHp,
    fuel: loadout!.chassis.fuel,
    angle: 45,
    power: DEFAULT_POWER,
    primaryAmmo: loadout!.primary.maxAmmo,
    secondaryAmmo: loadout!.secondary?.maxAmmo ?? 0,
    kills: 0,
    damageDealt: 0,
    alive: true,
    place: 0,
    lastAttackerId: null,
  };
}

/**
 * Combat feed toasts (Fired X, damage, etc.) are intentionally suppressed
 * during matches — they cluttered the top of the screen. Turn banners stay.
 * Menu / lobby / results still use brief toasts.
 */
function showToast(msg: string): void {
  if (mode === "playing" || mode === "sandbox") return;
  toast = msg;
  toastTimer = performance.now() + 2200;
}

/** Force a toast even in-match (rare: elimination, spectate prompts). */
function showMatchToast(msg: string, ms = 2200): void {
  toast = msg;
  toastTimer = performance.now() + ms;
}

function showBanner(msg: string, ms = 1500): void {
  banner = msg;
  bannerUntil = performance.now() + ms;
}

/** True while a shell is mid-flight or impact is still being applied. */
function shotInProgress(): boolean {
  return renderer.isProjectileFlying() || pendingImpact !== null;
}

/**
 * Clear sticky "resolving" when nothing is in the air and we never locked a real shot.
 * (Optimistic fire with no projectile used to freeze move + pass for the whole turn.)
 */
function recoverStickyPhase(): void {
  if (postShotLock) return;
  if (phase === "resolving" && !shotInProgress()) {
    phase = "move";
  }
}

function passTurn(): void {
  if (mode !== "playing") return;
  if (currentPlayerId !== myId) return;
  if (shotInProgress() || postShotLock) {
    showToast("Wait for shell to land");
    return;
  }
  recoverStickyPhase();
  net.pass();
  showToast("Turn passed");
}

/** Can we fire with the current power meter? */
function canFire(): boolean {
  if (mode !== "playing" && mode !== "sandbox") return false;
  if (mode === "playing" && currentPlayerId !== myId) return false;
  if (renderer.isIntroPlaying()) return false;
  if (shotInProgress() || postShotLock) return false;
  recoverStickyPhase();
  const me = players.find((p) => p.id === myId);
  if (!me?.alive) return false;
  return true;
}

function adjustPower(delta: number): void {
  const me = players.find((p) => p.id === myId);
  if (!me?.alive) return;
  if (mode === "playing" && currentPlayerId !== myId) return;
  if (shotInProgress() || postShotLock) return;
  me.power = clampPower(me.power + delta);
  renderer.syncPlayers(players);
}

/** Single-press fire at current power. slot: primary (Space) or secondary/alt (R). */
function fireShot(slot: "primary" | "secondary" = "primary"): void {
  if (!canFire()) {
    if (shotInProgress() || postShotLock) showToast("Wait for shell to land");
    return;
  }

  const me = players.find((p) => p.id === myId);
  if (!me || !me.alive || !me.loadout) return;

  if (slot === "secondary") {
    if (!me.loadout.secondary) {
      showToast("No alt weapon");
      return;
    }
    if (me.secondaryAmmo <= 0) {
      showToast(`${me.loadout.secondary.name} spent — use Space (Peashooter)`);
      return;
    }
  } else {
    // Primary empty → local Peashooter fallback (server does the same)
    if (me.primaryAmmo <= 0) {
      equipPeashooterFallback(me);
      showToast("Out of ammo — Peashooter equipped");
    }
  }

  const power = clampPower(me.power);
  me.power = power;
  sfx.fire(power);

  if (mode === "playing") {
    net.fire({
      angle: me.angle,
      power,
      weaponSlot: slot,
      facing: me.facing,
    });
    // Optimistic ammo so HUD updates immediately
    if (slot === "secondary") {
      me.secondaryAmmo = Math.max(0, me.secondaryAmmo - 1);
    } else if (me.loadout.primary.id !== "peashooter") {
      me.primaryAmmo = Math.max(0, me.primaryAmmo - 1);
      if (me.primaryAmmo <= 0) equipPeashooterFallback(me);
    } else {
      me.primaryAmmo = 99;
    }
    phase = "resolving";
    window.setTimeout(() => {
      if (
        phase === "resolving" &&
        !shotInProgress() &&
        !postShotLock &&
        currentPlayerId === myId
      ) {
        phase = "move";
      }
    }, 900);
  } else {
    fireSandbox(me, slot);
  }
}

window.addEventListener("keydown", (e) => {
  // Space: primary fire (ignore key-repeat)
  if (e.code === "Space") {
    e.preventDefault();
    if (e.repeat) return;
    keys.add(e.code);
    fireShot("primary");
    return;
  }
  // R: secondary / special (Mini Nuke, etc.)
  if (e.code === "KeyR") {
    e.preventDefault();
    if (e.repeat) return;
    fireShot("secondary");
    return;
  }
  keys.add(e.code);
  if (e.code === "Escape") {
    if (mode === "sandbox") void showMenu();
  }
  // Sandbox weapon select: 1–8, [ ] cycle (includes Mini Nuke special)
  if (mode === "sandbox") {
    if (e.code.startsWith("Digit")) {
      const n = Number(e.code.replace("Digit", ""));
      if (n >= 1 && n <= allWeapons().length) {
        equipSandboxWeapon(n - 1);
        e.preventDefault();
      }
    }
    if (e.code === "BracketLeft") {
      equipSandboxWeapon(sandboxWeaponIndex - 1);
      e.preventDefault();
    }
    if (e.code === "BracketRight") {
      equipSandboxWeapon(sandboxWeaponIndex + 1);
      e.preventDefault();
    }
  }
  // prevent page scroll on game keys
  if (
    ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.code)
  ) {
    e.preventDefault();
  }
});
window.addEventListener("keyup", (e) => {
  keys.delete(e.code);
  if (e.code === "Space") e.preventDefault();
});

canvas.addEventListener("pointerdown", (e) => {
  if (mode !== "sandbox") return;
  const world = renderer.getWorld();
  if (!world) return;
  const x = (e.clientX / window.innerWidth) * world.width;
  const y = (1 - e.clientY / window.innerHeight) * world.height * 0.9;
  renderer.digAt(x, y, renderer.getMidZ(), 4);
});

let lastMoveSend = 0;
let lastAimSend = 0;

/** Continuous terrain-following move (shared with server logic). */
function applyLocalMove(
  me: PlayerState,
  dir: -1 | 1,
  dt: number,
  mobility: number,
): boolean {
  const world = renderer.getWorld();
  if (!world) return false;
  if (me.fuel <= 0) return false;

  const speed = moveSpeed(mobility);
  const costPer = fuelCostPerUnit(mobility);
  const maxDist = me.fuel / Math.max(1e-4, costPer);
  const want = Math.min(speed * dt, maxDist);
  if (want <= 1e-4) return false;

  const result = moveAlongTerrain(
    world,
    me.x,
    me.y,
    renderer.getMidZ(),
    dir,
    want,
  );
  if (result.traveled <= 0) return false;

  me.x = result.x;
  me.y = result.y;
  me.facing = dir;
  me.fuel = Math.max(0, me.fuel - costPer * result.traveled);
  return true;
}

function updateInput(dt: number): void {
  if (mode !== "playing" && mode !== "sandbox") return;
  const me = players.find((p) => p.id === myId);
  if (!me || !me.alive) return;
  const isMyTurn = currentPlayerId === myId;
  if (!isMyTurn && mode === "playing") {
    return;
  }

  // Pass before shot-lock so sticky phase never eats the key
  if (keys.has("KeyP")) {
    keys.delete("KeyP");
    passTurn();
  }

  // Hard lock only while a shell is actually resolving (or post-shot until next turn)
  if (shotInProgress() || postShotLock) {
    renderer.hideTrajectory();
    return;
  }

  recoverStickyPhase();

  let dirty = false;
  const mobility = me.loadout?.chassis.mobility ?? 1;

  if (keys.has("KeyA") || keys.has("ArrowLeft")) {
    if (applyLocalMove(me, -1, dt, mobility)) {
      dirty = true;
      if (mode === "playing" && performance.now() - lastMoveSend > 33) {
        net.move(-1, dt);
        lastMoveSend = performance.now();
      }
    }
  }
  if (keys.has("KeyD") || keys.has("ArrowRight")) {
    if (applyLocalMove(me, 1, dt, mobility)) {
      dirty = true;
      if (mode === "playing" && performance.now() - lastMoveSend > 33) {
        net.move(1, dt);
        lastMoveSend = performance.now();
      }
    }
  }
  // Angle
  if (keys.has("KeyW") || keys.has("ArrowUp")) {
    me.angle = clampAngle(me.angle + 45 * dt);
    dirty = true;
  }
  if (keys.has("KeyS") || keys.has("ArrowDown")) {
    me.angle = clampAngle(me.angle - 45 * dt);
    dirty = true;
  }
  // Power meter (hold Q/E or ,/.)
  if (keys.has("KeyQ") || keys.has("Comma")) {
    me.power = clampPower(me.power - POWER_ADJUST_RATE * dt);
    dirty = true;
  }
  if (keys.has("KeyE") || keys.has("Period")) {
    me.power = clampPower(me.power + POWER_ADJUST_RATE * dt);
    dirty = true;
  }
  // Facing
  if (keys.has("KeyF")) {
    keys.delete("KeyF");
    me.facing = me.facing === 1 ? -1 : 1;
    dirty = true;
  }

  if (mode === "playing" && performance.now() - lastAimSend > 80) {
    net.aim({ angle: me.angle, power: me.power, facing: me.facing });
    lastAimSend = performance.now();
  }

  if (dirty) renderer.syncPlayers(players);

  // Don't re-center on the tank while the shell is mid-flight
  if (!renderer.isCameraLockedOnShot() && (isMyTurn || mode === "sandbox")) {
    const seekTargets = players
      .filter((t) => t.alive && t.id !== me.id)
      .map((t) => ({ x: t.x, y: t.y }));
    renderer.showTrajectory(me, wind, { seekTargets });
    renderer.focusPlayer(me);
  } else if (shotInProgress()) {
    renderer.hideTrajectory();
  }
}

function fireSandbox(
  me: PlayerState,
  slot: "primary" | "secondary" = "primary",
): void {
  const world = renderer.getWorld();
  if (!world || !me.loadout) {
    showToast("Can't fire right now");
    phase = "move";
    return;
  }
  if (renderer.isProjectileFlying()) {
    showToast("Wait for shell to land");
    return;
  }
  phase = "move"; // reset any sticky state before arming

  const midZ = renderer.getMidZ();
  const weapon =
    slot === "secondary" && me.loadout.secondary
      ? me.loadout.secondary
      : me.loadout.primary;
  if (slot === "secondary" && !me.loadout.secondary) {
    showToast("No alt weapon");
    return;
  }
  if (slot === "secondary" && me.secondaryAmmo <= 0) {
    showToast(`${weapon.name} spent — use Space (Peashooter)`);
    return;
  }
  let fireWeapon = weapon;
  if (slot === "primary") {
    if (me.primaryAmmo <= 0 || fireWeapon.id === "peashooter") {
      if (me.primaryAmmo <= 0) equipPeashooterFallback(me);
      fireWeapon = me.loadout.primary;
    }
  }

  const seekTargets = players
    .filter((t) => t.alive && t.id !== me.id)
    .map((t) => ({ x: t.x, y: t.y }));

  const fired = simulateWeaponFire(world, {
    weapon: fireWeapon,
    tankX: me.x,
    tankY: me.y,
    midZ,
    facing: me.facing,
    angleDeg: me.angle,
    power: me.power,
    wind,
    chassisSize: me.loadout.chassis.size,
    seekTargets,
  });

  renderer.hideTrajectory();
  if (slot === "secondary") {
    me.secondaryAmmo = Math.max(0, me.secondaryAmmo - 1);
  } else if (fireWeapon.id !== "peashooter") {
    me.primaryAmmo = Math.max(0, me.primaryAmmo - 1);
    if (me.primaryAmmo <= 0) equipPeashooterFallback(me);
  } else {
    me.primaryAmmo = 99;
  }
  phase = "resolving";
  showToast(`▶ ${fireWeapon.name} · ${formatWeaponBehavior(fireWeapon)}`);

  // Same weapon resolution as the server (cluster splits at impact, not at the muzzle)
  renderer.playProjectile(
    fired.path,
    () => {
      phase = "move";
      if (fired.blasts.length === 0) {
        showToast(`${weapon.name}: no impact (timeout/bounds)`);
        return;
      }

      sfx.impact(fired.blasts.some((b) => b.radius >= 4.5));
      // Same terrain stamps as the server (drill gets deep shaft + undercut)
      renderer.applyTerrainOps(blastsToTerrainOps(fired.blasts, weapon), weapon);

      const damageByTarget = resolveBlastDamage(
        weapon,
        fired.blasts,
        players
          .filter((t) => t.alive)
          .map((t) => ({
            id: t.id,
            x: t.x,
            y: t.y,
            armor: t.loadout?.chassis.armor ?? 0,
            isShooter: t.id === me.id,
          })),
      );

      const hitSummary: string[] = [
        `${weapon.name}: ${fired.blasts.length} blast${fired.blasts.length === 1 ? "" : "s"}`,
      ];
      for (const [targetId, dmg] of damageByTarget) {
        const t = players.find((p) => p.id === targetId);
        if (!t || dmg <= 0) continue;
        t.hp -= dmg;
        if (t.hp <= 0) {
          t.hp = 0;
          t.alive = false;
        }
        renderer.flashTank(t.id);
        renderer.showDamageNumber(t.x, t.y + 1.2, midZ + 0.5, dmg);
        hitSummary.push(
          t.id === me.id ? `you -${dmg}` : `${t.name} -${dmg}`,
        );
      }
      if (damageByTarget.size === 0) {
        hitSummary.push("no tank damage");
      }
      showToast(hitSummary.join(" · "));

      for (const t of players) {
        if (!t.alive) continue;
        const g = world.sampleGroundY(t.x, midZ);
        if (g >= 0) t.y = g;
      }
      renderer.syncPlayers(players);
    },
    weapon.color ?? 0xff5522,
    weapon,
    fired.paths,
  );
}

let lastHud = 0;
let lastFrame = performance.now();

function loop(): void {
  const now = performance.now();
  const dt = Math.min(0.05, (now - lastFrame) / 1000);
  lastFrame = now;

  if (mode === "playing" || mode === "sandbox") {
    updateInput(dt);
  } else {
    updateAmbient(dt, now);
  }
  renderer.update();

  const inMatch = mode === "playing" || mode === "sandbox";
  if (inMatch) {
    // Edge markers + turn banner/toast live outside uiRoot so HUD rebuilds don't remount them
    const markers = computeEdgeMarkers(
      renderer,
      players,
      myId,
      currentPlayerId,
    );
    updateEdgeMarkerLayer(appRoot, markers, true);

    updateNotifications(appRoot, {
      visible: true,
      banner: now < bannerUntil ? banner : undefined,
      toast: now < toastTimer ? toast : undefined,
      isMyTurn: currentPlayerId === myId,
    });

    if (now - lastHud > 100) {
      lastHud = now;
      const me = players.find((p) => p.id === myId);
      const amDead = mode === "playing" && !!me && !me.alive;
      if (amDead) spectating = true;
      const tLeft =
        mode === "sandbox"
          ? 99
          : Math.max(0, (turnEndsAt - now) / 1000);
      renderHud(uiRoot, {
        players,
        meId: myId,
        currentId: currentPlayerId,
        wind,
        turnTimeLeft: tLeft,
        turnTimeMax: mode === "sandbox" ? 99 : turnTimeMax,
        phase,
        sandbox: mode === "sandbox",
        weaponIndex: sandboxWeaponIndex,
        weaponCount: allWeapons().length,
        mapName: renderer.getMapName(),
        spectating: amDead || spectating,
      });
    }
  } else {
    updateEdgeMarkerLayer(appRoot, [], false);
    updateNotifications(appRoot, { visible: false });
  }

  requestAnimationFrame(loop);
}

// HUD buttons use pointerdown: rebuilds destroy nodes mid-click.
uiRoot.addEventListener("pointerdown", (e) => {
  const t = e.target as HTMLElement | null;
  if (!t?.closest) return;
  if (t.closest("#btn-spectate-leave")) {
    e.preventDefault();
    net.leave();
    spectating = false;
    void showMenu();
  } else if (t.closest("#btn-spectate-stay")) {
    e.preventDefault();
    showMatchToast("Spectating…", 1600);
  } else if (t.closest("#btn-pass")) {
    e.preventDefault();
    passTurn();
  } else if (t.closest("#btn-fire-alt")) {
    e.preventDefault();
    fireShot("secondary");
  } else if (t.closest("#btn-fire")) {
    e.preventDefault();
    fireShot("primary");
  } else if (t.closest("#btn-power-up")) {
    e.preventDefault();
    adjustPower(5);
  } else if (t.closest("#btn-power-down")) {
    e.preventDefault();
    adjustPower(-5);
  }
});

void showMenu();
loop();
