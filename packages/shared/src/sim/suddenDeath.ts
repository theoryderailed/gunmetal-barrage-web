import { createRng, hashSeed } from "../rng.js";
import { VoxelMaterial, type MatchConfig, type SuddenDeathMode, type SuddenDeathState, type TerrainOp } from "../types.js";
import type { VoxelWorld } from "../voxels.js";
import { isSolid } from "../voxels.js";

const SD_MODES: SuddenDeathMode[] = [
  "rising_water",
  "exploding_mountain",
  "ufo",
  "hurricane",
];

const SD_LABELS: Record<SuddenDeathMode, string> = {
  rising_water: "RISING WATERS",
  exploding_mountain: "BURIED MOUNTAIN",
  ufo: "HOSTILE UFO",
  hurricane: "MEGA HURRICANE",
};

export function suddenDeathLabel(mode: SuddenDeathMode): string {
  return SD_LABELS[mode];
}

export function pickSuddenDeathMode(matchSeed: number): SuddenDeathMode {
  const rng = createRng(hashSeed(matchSeed, "sudden-death-mode"));
  return SD_MODES[Math.floor(rng() * SD_MODES.length)]!;
}

export function createInitialSuddenDeathState(
  matchSeed: number,
  config: MatchConfig,
): SuddenDeathState {
  const mode = pickSuddenDeathMode(matchSeed);
  const rng = createRng(hashSeed(matchSeed, "sd-init", mode));
  const midX = config.mapWidth * (0.35 + rng() * 0.3);
  return {
    active: false,
    mode: null,
    label: "",
    tick: 0,
    waterLevel: 2,
    mountainX: midX,
    ufoX: config.mapWidth * 0.5,
    ufoY: config.mapHeight * 0.72,
    hurricaneX: config.mapWidth * 0.5,
    windOverride: null,
  };
}

export interface SuddenDeathTickInput {
  state: SuddenDeathState;
  matchSeed: number;
  config: MatchConfig;
  world: VoxelWorld;
  midZ: number;
  players: {
    id: string;
    x: number;
    y: number;
    alive: boolean;
    hp: number;
  }[];
  /** Global match turn index */
  turnIndex: number;
}

export interface SuddenDeathTickResult {
  state: SuddenDeathState;
  justActivated: boolean;
  message: string;
  terrainOps: TerrainOp[];
  damages: { targetId: string; amount: number; sourceId: string }[];
  /** Player ids that should be eliminated (void / drown) */
  killIds: string[];
  windOverride: number | null;
}

/**
 * Call once at the start of each turn while the match is live.
 * Activates SD after suddenDeathTurns, then applies mode hazards.
 */
export function tickSuddenDeath(input: SuddenDeathTickInput): SuddenDeathTickResult {
  const { matchSeed, config, world, midZ, players, turnIndex } = input;
  let state = { ...input.state };
  const alive = players.filter((p) => p.alive);
  const empty: SuddenDeathTickResult = {
    state,
    justActivated: false,
    message: "",
    terrainOps: [],
    damages: [],
    killIds: [],
    windOverride: state.windOverride,
  };

  if (alive.length <= 1) return empty;

  // Activate
  if (!state.active && turnIndex >= config.suddenDeathTurns) {
    const mode = pickSuddenDeathMode(matchSeed);
    const rng = createRng(hashSeed(matchSeed, "sd-activate", turnIndex));
    state = {
      ...state,
      active: true,
      mode,
      label: SD_LABELS[mode],
      tick: 0,
      waterLevel: 3,
      mountainX: config.mapWidth * (0.3 + rng() * 0.4),
      ufoX: config.mapWidth * (0.2 + rng() * 0.6),
      ufoY: config.mapHeight * (0.62 + rng() * 0.15),
      hurricaneX: config.mapWidth * 0.5,
      windOverride: mode === "hurricane" ? (rng() > 0.5 ? 1.75 : -1.75) : null,
    };
    return {
      state,
      justActivated: true,
      message: `⚡ SUDDEN DEATH — ${SD_LABELS[mode]}`,
      terrainOps: mode === "exploding_mountain" ? plantMountain(world, state.mountainX, midZ) : [],
      damages: [],
      killIds: [],
      windOverride: state.windOverride,
    };
  }

  if (!state.active || !state.mode) return empty;

  state = { ...state, tick: state.tick + 1 };
  const rng = createRng(hashSeed(matchSeed, "sd-tick", turnIndex, state.tick));

  switch (state.mode) {
    case "rising_water":
      return tickRisingWater(state, world, midZ, alive, rng);
    case "exploding_mountain":
      return tickExplodingMountain(state, world, midZ, alive, rng);
    case "ufo":
      return tickUfo(state, config, world, midZ, alive, rng);
    case "hurricane":
      return tickHurricane(state, config, world, midZ, alive, rng);
    default:
      return { ...empty, state };
  }
}

function tickRisingWater(
  state: SuddenDeathState,
  world: VoxelWorld,
  midZ: number,
  alive: SuddenDeathTickInput["players"],
  rng: () => number,
): SuddenDeathTickResult {
  const rise = 1.4 + rng() * 0.9;
  const waterLevel = state.waterLevel + rise;
  const next = { ...state, waterLevel, windOverride: null };
  const damages: SuddenDeathTickResult["damages"] = [];
  const killIds: string[] = [];

  for (const p of alive) {
    // Standing at or under waterline
    if (p.y <= waterLevel + 0.8) {
      const amount = Math.round(8 + (waterLevel - p.y) * 3 + rng() * 6);
      damages.push({ targetId: p.id, amount, sourceId: "sudden_death" });
      if (p.y + 0.5 < waterLevel - 1.5 || p.hp - amount <= 0) {
        killIds.push(p.id);
      }
    }
  }

  // Visual: nibble low terrain near waterline (small digs)
  const terrainOps: TerrainOp[] = [];
  const nibble = 2 + Math.floor(rng() * 3);
  for (let i = 0; i < nibble; i++) {
    const x = Math.floor(rng() * world.width);
    const sy = world.surfaceYWalkable(x, midZ);
    if (sy >= 0 && sy <= waterLevel + 2) {
      terrainOps.push({
        kind: "sphere",
        x,
        y: Math.min(sy, waterLevel),
        z: midZ,
        radius: 1.6 + rng(),
        material: VoxelMaterial.Air,
      });
    }
  }

  return {
    state: next,
    justActivated: false,
    message: `🌊 Waters rise to ${waterLevel.toFixed(0)}…`,
    terrainOps,
    damages,
    killIds: [...new Set(killIds)],
    windOverride: null,
  };
}

function plantMountain(world: VoxelWorld, cx: number, midZ: number): TerrainOp[] {
  // Ops are digs (Air). Planting is done by server filling rock via special apply.
  // We return "fill" markers as Metal/Rock spheres the server interprets.
  void world;
  return [
    {
      kind: "sphere",
      x: cx,
      y: 18,
      z: midZ,
      radius: 7,
      material: VoxelMaterial.Rock,
    },
    {
      kind: "sphere",
      x: cx,
      y: 26,
      z: midZ,
      radius: 5,
      material: VoxelMaterial.Rock,
    },
  ];
}

function tickExplodingMountain(
  state: SuddenDeathState,
  _world: VoxelWorld,
  midZ: number,
  alive: SuddenDeathTickInput["players"],
  rng: () => number,
): SuddenDeathTickResult {
  void _world;
  const blastR = 3.5 + state.tick * 0.85 + rng() * 1.2;
  const cx = state.mountainX + (rng() - 0.5) * 6;
  const cy = 8 + state.tick * 2.5 + rng() * 4;
  const terrainOps: TerrainOp[] = [
    {
      kind: "sphere",
      x: cx,
      y: cy,
      z: midZ,
      radius: blastR,
      material: VoxelMaterial.Air,
    },
  ];
  const damages: SuddenDeathTickResult["damages"] = [];
  for (const p of alive) {
    const d = Math.hypot(p.x - cx, p.y - cy);
    if (d < blastR + 2) {
      const amount = Math.round(12 + (1 - d / (blastR + 2)) * 28);
      damages.push({ targetId: p.id, amount, sourceId: "sudden_death" });
    }
  }
  return {
    state: { ...state, windOverride: null },
    justActivated: false,
    message: `🌋 Buried mountain erupts!`,
    terrainOps,
    damages,
    killIds: [],
    windOverride: null,
  };
}

function tickUfo(
  state: SuddenDeathState,
  config: MatchConfig,
  world: VoxelWorld,
  midZ: number,
  alive: SuddenDeathTickInput["players"],
  rng: () => number,
): SuddenDeathTickResult {
  // Drift toward a random living tank
  const target = alive[Math.floor(rng() * alive.length)]!;
  const ufoX = state.ufoX + (target.x - state.ufoX) * 0.35 + (rng() - 0.5) * 8;
  const ufoY = Math.min(
    config.mapHeight * 0.85,
    Math.max(config.mapHeight * 0.45, state.ufoY + (rng() - 0.5) * 4),
  );
  const next = { ...state, ufoX, ufoY, windOverride: null };

  // Drop a beam / bomb under the UFO
  const bx = ufoX + (rng() - 0.5) * 5;
  const ground = world.sampleGroundY(bx, midZ);
  const by = ground >= 0 ? ground : 12;
  const terrainOps: TerrainOp[] = [
    {
      kind: "sphere",
      x: bx,
      y: by,
      z: midZ,
      radius: 3.2 + rng() * 1.5,
      material: VoxelMaterial.Air,
    },
  ];
  const damages: SuddenDeathTickResult["damages"] = [];
  for (const p of alive) {
    const d = Math.hypot(p.x - bx, p.y - by);
    if (d < 5.5) {
      damages.push({
        targetId: p.id,
        amount: Math.round(14 + (1 - d / 5.5) * 22),
        sourceId: "sudden_death",
      });
    }
  }
  // Occasional tractor beam damage on closest tank
  if (rng() < 0.45) {
    const nearest = [...alive].sort(
      (a, b) => Math.hypot(a.x - ufoX, a.y - ufoY) - Math.hypot(b.x - ufoX, b.y - ufoY),
    )[0]!;
    damages.push({
      targetId: nearest.id,
      amount: 10 + Math.floor(rng() * 10),
      sourceId: "sudden_death",
    });
  }

  return {
    state: next,
    justActivated: false,
    message: `👽 UFO strikes at X ${bx.toFixed(0)}!`,
    terrainOps,
    damages,
    killIds: [],
    windOverride: null,
  };
}

function tickHurricane(
  state: SuddenDeathState,
  config: MatchConfig,
  world: VoxelWorld,
  midZ: number,
  alive: SuddenDeathTickInput["players"],
  rng: () => number,
): SuddenDeathTickResult {
  const hurricaneX =
    state.hurricaneX + (rng() - 0.5) * 18;
  const clampedX = Math.max(20, Math.min(config.mapWidth - 20, hurricaneX));
  // Flip / strengthen wind each tick
  const windOverride =
    (state.windOverride ?? 1.5) * (rng() > 0.35 ? 1 : -1) *
    (1.4 + rng() * 0.5);
  const next = {
    ...state,
    hurricaneX: clampedX,
    windOverride,
  };

  const damages: SuddenDeathTickResult["damages"] = [];
  // Flying debris hits
  const hits = 1 + Math.floor(rng() * 3);
  for (let i = 0; i < hits; i++) {
    const victim = alive[Math.floor(rng() * alive.length)]!;
    const amount = 6 + Math.floor(rng() * 14);
    damages.push({
      targetId: victim.id,
      amount,
      sourceId: "sudden_death",
    });
  }

  // Scrape surface under the eye
  const terrainOps: TerrainOp[] = [];
  for (let i = 0; i < 3; i++) {
    const x = clampedX + (rng() - 0.5) * 28;
    const g = world.sampleGroundY(x, midZ);
    if (g >= 0) {
      terrainOps.push({
        kind: "sphere",
        x,
        y: g,
        z: midZ,
        radius: 2 + rng() * 1.8,
        material: VoxelMaterial.Air,
      });
    }
  }

  return {
    state: next,
    justActivated: false,
    message: `🌀 Hurricane debris! Wind ${windOverride >= 0 ? "+" : ""}${windOverride.toFixed(1)}`,
    terrainOps,
    damages,
    killIds: [],
    windOverride,
  };
}

/** Apply non-Air materials as fills (for planting the buried mountain). */
export function applyTerrainOpToWorld(
  world: VoxelWorld,
  op: TerrainOp,
): void {
  if (op.material === VoxelMaterial.Air) {
    if (op.kind === "ellipsoid") {
      world.stampEllipsoid(
        Math.round(op.x),
        Math.round(op.y),
        Math.round(op.z),
        op.radius,
        op.radiusY ?? op.radius,
        op.radiusZ ?? op.radius,
        VoxelMaterial.Air,
        true,
      );
    } else {
      world.stampSphere(
        Math.round(op.x),
        Math.round(op.y),
        Math.round(op.z),
        op.radius,
        VoxelMaterial.Air,
        true,
      );
    }
    return;
  }
  // Fill solid (mountain plant) — full depth strip
  world.stampSphere(
    Math.round(op.x),
    Math.round(op.y),
    Math.round(op.z),
    op.radius,
    op.material,
    false,
  );
  // Ensure some solid mass even if stamp skips air-only
  const r = Math.ceil(op.radius);
  const cx = Math.round(op.x);
  const cy = Math.round(op.y);
  const cz = Math.round(op.z);
  for (let y = cy - r; y <= cy + r; y++) {
    for (let x = cx - r; x <= cx + r; x++) {
      const dx = x - cx;
      const dy = y - cy;
      if (dx * dx + dy * dy > r * r) continue;
      for (let z = 0; z < world.depth; z++) {
        if (!world.inBounds(x, y, z)) continue;
        if (!isSolid(world.get(x, y, z))) {
          world.set(x, y, z, op.material);
        }
      }
    }
  }
  void cz;
}
