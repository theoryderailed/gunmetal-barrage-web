import {
  DEFAULT_MATCH_CONFIG,
  MAX_POWER,
  MIN_POWER,
  VoxelMaterial,
  WEAPON_POOL,
  clampAngle,
  clampPower,
  formatWeaponBehavior,
  applyIdentityToPalette,
  generateBotIdentity,
  getWeaponByIndex,
  hashSeed,
  makeTestLoadout,
  fuelCostPerUnit,
  moveAlongTerrain,
  moveSpeed,
  resolveBlastDamage,
  simulateWeaponFire,
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

/** Hold-to-charge fire: Space down charges, release fires. */
let charging = false;
/** +1 filling, -1 draining (Worms-style bounce at max/min). */
let chargeDir = 1;
/** Power units per second while holding fire. */
const CHARGE_RATE = 75;

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
      showToast(`${p.name} eliminated!`);
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
    if (mode === "lobby") showLobby();
  },
  onMatchStarted: (data) => {
    mode = "playing";
    players = data.players.map((p) => ({
      ...p,
      // Full fuel at match start (matches server turn refill)
      fuel: p.loadout?.chassis.fuel ?? p.fuel,
    }));
    wind = data.wind;
    myId = net.sessionId;
    pendingImpact = null;
    cancelCharge();
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
    cancelCharge();
    currentPlayerId = data.playerId;
    wind = data.wind;
    phase = data.phase;
    turnTimeMax = data.timeSec;
    turnEndsAt = performance.now() + data.timeSec * 1000;
    renderer.setWind(data.wind);
    const p = players.find((x) => x.id === data.playerId);
    if (p) {
      p.power = MIN_POWER;
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
        `Your turn · full fuel · hold SPACE to charge · ${data.timeSec}s`,
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
    const weapon = shooter?.loadout?.primary ?? null;
    pendingWeapon = weapon;
    phase = "resolving";
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
      showToast(`${p.name} eliminated!`);
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
  renderLobby(uiRoot, {
    title: lobbyMeta.title,
    joinCode: lobbyMeta.joinCode,
    isPrivate: lobbyMeta.isPrivate,
    players: lobbyPlayers,
    isHost: lobbyMeta.hostId === net.sessionId,
    ready,
    onReady: (r) => {
      ready = r;
      net.sendReady(r);
      showLobby();
    },
    onAddBot: () => net.addBot(),
    onStart: () => net.startMatch(),
    onLeave: () => {
      net.leave();
      void showMenu();
    },
  });
}

function startSandbox(): void {
  mode = "sandbox";
  sandboxWeaponIndex = 0;
  const seed = (Date.now() >>> 0) ^ 0xdead;
  const config = {
    ...DEFAULT_MATCH_CONFIG,
    mapWidth: 160,
    mapHeight: 80,
    mapDepth: 12,
  };
  // Fixed standard hull + catalog weapon so tests are deterministic
  const loadout = makeTestLoadout(getWeaponByIndex(sandboxWeaponIndex));
  const dummyId = generateBotIdentity(hashSeed(seed, "dummy"));
  const enemyLo = makeTestLoadout(getWeaponByIndex(0));
  enemyLo.palette = applyIdentityToPalette(enemyLo.palette, dummyId);
  enemyLo.name = `${dummyId.displayName}'s Standard`;
  players = [
    makePlayer("local", displayName, loadout, 20, 1, false, null),
    makePlayer("dummy", dummyId.displayName, enemyLo, 120, -1, true, dummyId),
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
  sandboxWeaponIndex =
    ((index % WEAPON_POOL.length) + WEAPON_POOL.length) % WEAPON_POOL.length;
  const me = players.find((p) => p.id === myId);
  if (!me) return;
  const weapon = getWeaponByIndex(sandboxWeaponIndex);
  me.loadout = makeTestLoadout(weapon);
  me.hp = me.loadout.chassis.maxHp;
  me.fuel = me.loadout.chassis.fuel;
  me.primaryAmmo = weapon.maxAmmo;
  me.secondaryAmmo = 0;
  me.alive = true;
  // Reset dummy HP so each weapon test is clean
  const dummy = players.find((p) => p.id === "dummy");
  if (dummy?.loadout) {
    dummy.hp = dummy.loadout.chassis.maxHp;
    dummy.alive = true;
  }
  renderer.syncPlayers(players);
  showToast(`${sandboxWeaponIndex + 1}. ${weapon.name} — ${formatWeaponBehavior(weapon)}`);
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
    power: MIN_POWER,
    primaryAmmo: loadout!.primary.maxAmmo,
    secondaryAmmo: loadout!.secondary?.maxAmmo ?? 0,
    kills: 0,
    damageDealt: 0,
    alive: true,
    place: 0,
    lastAttackerId: null,
  };
}

function showToast(msg: string): void {
  toast = msg;
  toastTimer = performance.now() + 2200;
}

function showBanner(msg: string, ms = 1500): void {
  banner = msg;
  bannerUntil = performance.now() + ms;
}

function passTurn(): void {
  if (mode !== "playing") return;
  if (currentPlayerId !== myId) return;
  if (renderer.isProjectileFlying()) return;
  cancelCharge();
  net.pass();
  showToast("Turn passed");
}

/** Can we start a new charge? (stricter) */
function canBeginCharge(): boolean {
  if (mode !== "playing" && mode !== "sandbox") return false;
  if (mode === "playing" && currentPlayerId !== myId) return false;
  if (renderer.isIntroPlaying()) return false;
  if (phase === "resolving" || renderer.isProjectileFlying()) return false;
  const me = players.find((p) => p.id === myId);
  if (!me?.alive) return false;
  return true;
}

function beginCharge(): void {
  if (!canBeginCharge() || charging) return;
  const me = players.find((p) => p.id === myId);
  if (!me) return;
  charging = true;
  chargeDir = 1;
  me.power = MIN_POWER;
  sfx.chargeStart();
  renderer.syncPlayers(players);
}

function cancelCharge(opts?: { silent?: boolean }): void {
  if (!charging) return;
  charging = false;
  chargeDir = 1;
  sfx.stopCharge();
  const me = players.find((p) => p.id === myId);
  if (me) {
    me.power = MIN_POWER;
    renderer.syncPlayers(players);
  }
  if (!opts?.silent) {
    // no toast spam on blur
  }
}

function releaseFire(): void {
  if (!charging) return;

  const me = players.find((p) => p.id === myId);
  // Capture power while still charging
  const power = clampPower(me?.power ?? MIN_POWER);

  charging = false;
  chargeDir = 1;

  if (!me || !me.alive) {
    sfx.stopCharge();
    return;
  }

  // Lost the turn mid-charge
  if (mode === "playing" && currentPlayerId !== myId) {
    sfx.stopCharge();
    me.power = MIN_POWER;
    showToast("Turn ended — shot canceled");
    return;
  }

  // Shell still in air from previous shot — keep power and tell player
  if (renderer.isProjectileFlying()) {
    sfx.stopCharge();
    me.power = power; // keep last charged value for next try
    showToast("Wait for shell to land");
    return;
  }

  // If phase was stuck on resolving but nothing is flying, recover
  if (phase === "resolving" && !renderer.isProjectileFlying()) {
    phase = "move";
  }

  me.power = power;
  sfx.fire(power);

  if (mode === "playing") {
    net.fire({
      angle: me.angle,
      power,
      weaponSlot: "primary",
      facing: me.facing,
    });
    // Optimistic local phase so we don't double-charge before server projectile arrives
    phase = "resolving";
  } else {
    fireSandbox(me);
  }
}

window.addEventListener("keydown", (e) => {
  // Ignore key-repeat for Space so charge only starts once
  if (e.code === "Space" && e.repeat) {
    e.preventDefault();
    return;
  }
  keys.add(e.code);
  if (e.code === "Escape") {
    if (charging) {
      cancelCharge();
      e.preventDefault();
      return;
    }
    if (mode === "sandbox") void showMenu();
  }
  // Sandbox weapon select: 1–7, [ ] cycle (disabled while charging)
  if (mode === "sandbox" && !charging) {
    if (e.code.startsWith("Digit")) {
      const n = Number(e.code.replace("Digit", ""));
      if (n >= 1 && n <= WEAPON_POOL.length) {
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
  if (e.code === "Space") {
    e.preventDefault();
    // Resume audio on first gesture; then charge
    beginCharge();
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
  if (e.code === "Space") {
    e.preventDefault();
    releaseFire();
  }
});
// Blur: cancel charge without firing (e.g. tab switch). Don't reset power toast.
window.addEventListener("blur", () => {
  if (charging) cancelCharge({ silent: true });
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
    // Lost turn while charging — cancel cleanly
    if (charging) cancelCharge({ silent: true });
    return;
  }

  // Hold Space: always update charge power even if phase is sticky
  if (charging) {
    // Only abort charge if we truly can't finish the shot
    if (mode === "playing" && currentPlayerId !== myId) {
      cancelCharge({ silent: true });
    } else if (!me.alive) {
      cancelCharge({ silent: true });
    } else {
      me.power = clampPower(me.power + chargeDir * CHARGE_RATE * dt);
      if (me.power >= MAX_POWER) {
        me.power = MAX_POWER;
        chargeDir = -1;
      } else if (me.power <= MIN_POWER) {
        me.power = MIN_POWER;
        chargeDir = 1;
      }
      renderer.syncPlayers(players);
    }
  }

  // No move/aim while shell is in the air (charge release still handled on keyup)
  if (renderer.isProjectileFlying()) return;
  // Recover stuck resolving phase when nothing is flying
  if (phase === "resolving") {
    // wait for projectile message / sandbox callback — don't block charge update above
    if (!charging) return;
  }

  let dirty = false;
  const mobility = me.loadout?.chassis.mobility ?? 1;
  // Don't drive while charging power (hold-space)
  const canMove = !charging && phase !== "resolving";

  if (canMove && (keys.has("KeyA") || keys.has("ArrowLeft"))) {
    if (applyLocalMove(me, -1, dt, mobility)) {
      dirty = true;
      if (mode === "playing" && performance.now() - lastMoveSend > 33) {
        net.move(-1, dt);
        lastMoveSend = performance.now();
      }
    }
  }
  if (canMove && (keys.has("KeyD") || keys.has("ArrowRight"))) {
    if (applyLocalMove(me, 1, dt, mobility)) {
      dirty = true;
      if (mode === "playing" && performance.now() - lastMoveSend > 33) {
        net.move(1, dt);
        lastMoveSend = performance.now();
      }
    }
  }
  // Angle / facing (allowed while charging so you can fine-tune the arc)
  if (keys.has("KeyW") || keys.has("ArrowUp")) {
    me.angle = clampAngle(me.angle + 45 * dt);
    dirty = true;
  }
  if (keys.has("KeyS") || keys.has("ArrowDown")) {
    me.angle = clampAngle(me.angle - 45 * dt);
    dirty = true;
  }
  if (keys.has("KeyF") && !charging) {
    keys.delete("KeyF");
    me.facing = me.facing === 1 ? -1 : 1;
    dirty = true;
  }

  if (mode === "playing" && performance.now() - lastAimSend > 80) {
    net.aim({ angle: me.angle, power: me.power, facing: me.facing });
    lastAimSend = performance.now();
  }

  if (keys.has("KeyP")) {
    keys.delete("KeyP");
    passTurn();
  }

  if (dirty) renderer.syncPlayers(players);

  // Don't re-center on the tank while the shell is mid-flight
  if (!renderer.isCameraLockedOnShot() && (isMyTurn || mode === "sandbox")) {
    renderer.showTrajectory(me, wind);
    renderer.focusPlayer(me);
  } else if (renderer.isProjectileFlying()) {
    renderer.hideTrajectory();
  }
}

function fireSandbox(me: PlayerState): void {
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
  const weapon = me.loadout.primary;
  const fired = simulateWeaponFire(world, {
    weapon,
    tankX: me.x,
    tankY: me.y,
    midZ,
    facing: me.facing,
    angleDeg: me.angle,
    power: me.power,
    wind,
    chassisSize: me.loadout.chassis.size,
  });

  renderer.hideTrajectory();
  me.primaryAmmo = Math.max(0, me.primaryAmmo - 1);
  phase = "resolving";
  showToast(`▶ ${weapon.name} · ${formatWeaponBehavior(weapon)}`);

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
      // Single terrain batch so multi-blast VFX stagger correctly
      renderer.applyTerrainOps(
        fired.blasts.map((b) => ({
          kind: "sphere" as const,
          x: b.x,
          y: b.y,
          z: b.z,
          radius: b.radius,
          material: VoxelMaterial.Air,
        })),
        weapon,
      );

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

  updateInput(dt);
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
        weaponCount: WEAPON_POOL.length,
        charging,
        mapName: renderer.getMapName(),
        onPass: passTurn,
      });
    }
  } else {
    updateEdgeMarkerLayer(appRoot, [], false);
    updateNotifications(appRoot, { visible: false });
  }

  requestAnimationFrame(loop);
}

void showMenu();
loop();
