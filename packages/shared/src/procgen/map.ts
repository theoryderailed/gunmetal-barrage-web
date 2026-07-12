import { fbm2D } from "../noise.js";
import { createRng } from "../rng.js";
import { VoxelMaterial, type MatchConfig, type Vec2 } from "../types.js";
import { VoxelWorld } from "../voxels.js";

export type MapBiome =
  | "meadow"
  | "desert"
  | "canyon"
  | "volcanic"
  | "arctic"
  | "ruins";

export interface MapTheme {
  biome: MapBiome;
  name: string;
  skyTop: number;
  skyBottom: number;
  fog: number;
  hill: number;
  cloud: number;
  sun: number;
  hemiSky: number;
  hemiGround: number;
}

export interface MapGenResult {
  world: VoxelWorld;
  spawns: Vec2[];
  seed: number;
  biome: MapBiome;
  theme: MapTheme;
  name: string;
}

const BIOMES: {
  biome: MapBiome;
  name: string;
  weight: number;
  theme: Omit<MapTheme, "biome" | "name">;
}[] = [
  {
    biome: "meadow",
    name: "Green Scarps",
    weight: 3,
    theme: {
      skyTop: 0x5ba3d9,
      skyBottom: 0xa8d4f0,
      fog: 0x87b5d9,
      hill: 0x3d5a40,
      cloud: 0xf0f4f8,
      sun: 0xfff0d0,
      hemiSky: 0xb8d4ff,
      hemiGround: 0x3a2a18,
    },
  },
  {
    biome: "desert",
    name: "Bone Dunes",
    weight: 2,
    theme: {
      skyTop: 0xe8a84a,
      skyBottom: 0xf5d49a,
      fog: 0xe8c88a,
      hill: 0xc4a35a,
      cloud: 0xffe8c8,
      sun: 0xffe0a0,
      hemiSky: 0xffd090,
      hemiGround: 0x6a4820,
    },
  },
  {
    biome: "canyon",
    name: "Red Gulch",
    weight: 2,
    theme: {
      skyTop: 0x4a6a9a,
      skyBottom: 0xc89070,
      fog: 0xb08070,
      hill: 0x8a4030,
      cloud: 0xd0c0b0,
      sun: 0xffc090,
      hemiSky: 0xc0a090,
      hemiGround: 0x4a2010,
    },
  },
  {
    biome: "volcanic",
    name: "Ash Caldera",
    weight: 1,
    theme: {
      skyTop: 0x2a1830,
      skyBottom: 0x6a3040,
      fog: 0x4a2838,
      hill: 0x2a2028,
      cloud: 0x605060,
      sun: 0xff6633,
      hemiSky: 0x805060,
      hemiGround: 0x1a1010,
    },
  },
  {
    biome: "arctic",
    name: "Frozen Shelf",
    weight: 2,
    theme: {
      skyTop: 0x8ec8e8,
      skyBottom: 0xe0f0ff,
      fog: 0xc0dce8,
      hill: 0xa0b8c8,
      cloud: 0xffffff,
      sun: 0xe8f0ff,
      hemiSky: 0xd0e8ff,
      hemiGround: 0x607080,
    },
  },
  {
    biome: "ruins",
    name: "Scrap Wastes",
    weight: 2,
    theme: {
      skyTop: 0x4a5568,
      skyBottom: 0x8a9070,
      fog: 0x6a7060,
      hill: 0x4a5040,
      cloud: 0x909888,
      sun: 0xd0c080,
      hemiSky: 0x90a090,
      hemiGround: 0x303028,
    },
  },
];

/** Extra name flourishes so maps feel unique even within a biome. */
const NAME_SUFFIXES = [
  "Gulfs",
  "Ridges",
  "Spires",
  "Fissures",
  "Overlook",
  "Breach",
  "Shelf",
  "Mesa",
  "Trench",
  "Archipelago",
];

/**
 * Generate a 2.5D side-view arena from a seed.
 * Multi-scale hills, gulfs, ridges, and scattered spawn pads.
 */
export function generateMap(
  seed: number,
  config: Pick<MatchConfig, "mapWidth" | "mapHeight" | "mapDepth" | "maxPlayers">,
): MapGenResult {
  const { mapWidth: w, mapHeight: h, mapDepth: d, maxPlayers } = config;
  const world = new VoxelWorld(w, h, d);
  const rng = createRng(seed);

  const biomePick = pickBiome(rng);
  const theme: MapTheme = {
    biome: biomePick.biome,
    name: biomePick.name,
    ...biomePick.theme,
  };

  const profile = biomeProfile(biomePick.biome, h, rng);
  const midZ = Math.floor(d / 2);

  // Precompute terrain features (deterministic from seed)
  const gulfs = makeGulfs(w, h, rng, biomePick.biome);
  const ridges = makeRidges(w, h, rng);
  const mesas = makeMesas(w, h, rng);
  const trenches = makeTrenches(w, rng);

  // Height profile pass
  const surfaceY = new Int16Array(w);
  for (let x = 0; x < w; x++) {
    const nx = x / w;
    let heightNoise =
      fbm2D(nx * profile.noiseScale, 0.5, seed, profile.octaves) * profile.amp;
    // Second octave band for irregular skyline
    heightNoise +=
      fbm2D(nx * profile.noiseScale * 2.3, 1.7, seed + 19, 3) *
      profile.amp *
      0.35;
    // Long rolling undulation
    heightNoise += Math.sin(nx * Math.PI * profile.rollFreq + seed * 0.001) *
      profile.amp *
      0.22;

    if (profile.terrace > 0) {
      heightNoise =
        Math.floor((profile.base + heightNoise) / profile.terrace) *
          profile.terrace -
        profile.base;
    }

    let surface = Math.floor(profile.base + heightNoise);

    // Ridges (sharp peaks)
    for (const r of ridges) {
      const dx = Math.abs(x - r.cx);
      if (dx < r.halfW) {
        const t = 1 - dx / r.halfW;
        surface += Math.floor(r.height * t * t);
      }
    }

    // Mesas (flat-top plateaus)
    for (const m of mesas) {
      const dx = Math.abs(x - m.cx);
      if (dx < m.halfW) {
        const edge = Math.min(1, (m.halfW - dx) / Math.max(2, m.ramp));
        surface = Math.max(surface, Math.floor(m.top * edge + surface * (1 - edge * 0.4)));
      }
    }

    // Gulfs / bays (deep cuts)
    for (const g of gulfs) {
      const dx = Math.abs(x - g.cx);
      if (dx < g.halfW) {
        const t = 1 - dx / g.halfW;
        // Smooth bowl: deeper in the middle
        const bowl = t * t * (3 - 2 * t);
        surface -= Math.floor(g.depth * bowl);
      }
    }

    // Narrow trenches (steep V cuts)
    for (const t of trenches) {
      const dx = Math.abs(x - t.cx);
      if (dx < t.halfW) {
        const u = 1 - dx / t.halfW;
        surface -= Math.floor(t.depth * u);
      }
    }

    // Biome flourishes
    if (biomePick.biome === "desert") {
      const dune = Math.sin(nx * Math.PI * 5 + seed * 0.01);
      surface += Math.floor((dune * 0.5 + 0.5) * 8);
    } else if (biomePick.biome === "arctic") {
      const shelf = fbm2D(nx * 3.2, 1.2, seed + 3, 3);
      if (shelf > 0.52) surface += Math.floor((shelf - 0.52) * 16);
    } else if (biomePick.biome === "volcanic") {
      const caldera = fbm2D(nx * 1.8, 2.1, seed + 11, 3);
      if (caldera < 0.38 && x > w * 0.2 && x < w * 0.8) {
        surface -= Math.floor((0.38 - caldera) * 20);
      }
    }

    // Keep beaches at map ends walkable but not walls
    if (x < 8 || x > w - 9) {
      const edgeLift = Math.floor(h * profile.edgeBoost);
      surface = Math.max(surface, edgeLift - Math.abs(x < 8 ? x : w - 1 - x));
    }

    surface = Math.max(5, Math.min(h - 10, surface));
    surfaceY[x] = surface;
  }

  // Optional stone bridges over deep gulfs
  for (const g of gulfs) {
    if (g.depth < 12 || rng() > 0.55) continue;
    const left = Math.max(2, g.cx - g.halfW);
    const right = Math.min(w - 3, g.cx + g.halfW);
    const deckY =
      Math.min(surfaceY[left]!, surfaceY[right]!) + 1 + Math.floor(rng() * 2);
    const thickness = 1 + Math.floor(rng() * 2);
    for (let x = left; x <= right; x++) {
      // Leave gaps for broken bridges
      if (rng() < 0.12) continue;
      for (let t = 0; t < thickness; t++) {
        const y = deckY + t;
        if (y >= h - 2) continue;
        for (let z = midZ - 1; z <= midZ + 1; z++) {
          world.set(x, y, z, VoxelMaterial.Rock);
        }
      }
      // Raise surface profile under deck so spawns don't sink
      if (surfaceY[x]! < deckY) surfaceY[x] = deckY;
    }
  }

  // Voxel fill — floating islands: solid only between underside and surface,
  // open sky below. Digging through the bottom drops tanks into the void.
  for (let x = 0; x < w; x++) {
    const surface = surfaceY[x]!;
    for (let z = 0; z < d; z++) {
      const edgeFade = 1 - Math.abs(z - midZ) / (d * 0.55);
      const colHeight = Math.floor(surface * Math.max(0.55, edgeFade));
      if (colHeight < 2) continue;

      // Sky gap under the island (varies along X so undersides look natural)
      const skyGap =
        3 +
        Math.floor(
          (fbm2D(x * 0.045, z * 0.08, seed + 77, 3) * 0.5 + 0.5) * 9,
        );
      // Island thickness: thicker under high peaks, always diggable through
      const thickNoise =
        fbm2D(x * 0.07, 0.2, seed + 31, 3) * 0.5 + 0.5;
      let thickness = Math.floor(7 + colHeight * 0.32 + thickNoise * 7);
      thickness = Math.max(4, Math.min(thickness, colHeight - skyGap));
      if (thickness < 4) thickness = Math.min(4, colHeight);
      const bottom = Math.max(0, colHeight - thickness);

      for (let y = bottom; y <= colHeight; y++) {
        world.set(
          x,
          y,
          z,
          islandMaterial(biomePick.biome, y, bottom, colHeight, x, seed, rng),
        );
      }

      // Caves inside the island body only
      if (biomePick.biome !== "arctic" && x > 18 && x < w - 18) {
        const caveLo = bottom + 2;
        const caveHi = colHeight - 3;
        for (let y = caveLo; y < caveHi; y++) {
          const cave = fbm2D(x * 0.08, y * 0.1, seed + 42, 3);
          const lo = biomePick.biome === "volcanic" ? 0.56 : 0.61;
          const hi = biomePick.biome === "volcanic" ? 0.72 : 0.73;
          if (cave > lo && cave < hi) {
            world.set(x, y, z, VoxelMaterial.Air);
          }
        }
      }
    }
  }

  // Props / ruins / spires
  const ruinCount =
    biomePick.biome === "ruins"
      ? 6 + Math.floor(rng() * 5)
      : biomePick.biome === "volcanic"
        ? 2 + Math.floor(rng() * 3)
        : 3 + Math.floor(rng() * 4);

  for (let i = 0; i < ruinCount; i++) {
    const rx = 16 + Math.floor(rng() * (w - 32));
    const rz = midZ + Math.floor(rng() * 3) - 1;
    const ry = world.surfaceY(rx, rz) + 1;
    const rw = 2 + Math.floor(rng() * 5);
    const rh = 2 + Math.floor(rng() * 7);
    const spire = rng() > 0.7;
    for (let dx = 0; dx < rw; dx++) {
      for (let dy = 0; dy < (spire ? rh + dx : rh); dy++) {
        if (rng() > 0.2) {
          const mat =
            biomePick.biome === "arctic"
              ? VoxelMaterial.Rock
              : biomePick.biome === "volcanic" && rng() > 0.45
                ? VoxelMaterial.Rock
                : VoxelMaterial.Metal;
          world.set(rx + dx, ry + dy, rz, mat);
          if (d > 2) world.set(rx + dx, ry + dy, rz + 1, mat);
        }
      }
    }
  }

  // Scattered spawns (not fixed left/right lanes)
  const spawnCount = Math.max(4, maxPlayers + 3);
  const spawns = pickScatteredSpawns(world, midZ, w, h, spawnCount, rng, biomePick.biome);

  const suffix =
    NAME_SUFFIXES[Math.floor(rng() * NAME_SUFFIXES.length)] ?? "Gulfs";
  const mapName =
    rng() > 0.45 ? `${biomePick.name} · ${suffix}` : biomePick.name;

  return {
    world,
    spawns,
    seed,
    biome: biomePick.biome,
    theme,
    name: mapName,
  };
}

// ── Terrain feature generators ──────────────────────────────────────────

interface Gulf {
  cx: number;
  halfW: number;
  depth: number;
}
interface Ridge {
  cx: number;
  halfW: number;
  height: number;
}
interface Mesa {
  cx: number;
  halfW: number;
  top: number;
  ramp: number;
}
interface Trench {
  cx: number;
  halfW: number;
  depth: number;
}

function makeGulfs(
  w: number,
  h: number,
  rng: () => number,
  biome: MapBiome,
): Gulf[] {
  const bias =
    biome === "canyon" || biome === "volcanic"
      ? 3
      : biome === "arctic"
        ? 1
        : 2;
  const count = bias + Math.floor(rng() * 3);
  const gulfs: Gulf[] = [];
  for (let i = 0; i < count; i++) {
    const cx = Math.floor(w * (0.18 + rng() * 0.64));
    const halfW = Math.floor(8 + rng() * (biome === "canyon" ? 28 : 18));
    const depth = Math.floor(
      h * (biome === "canyon" ? 0.18 : 0.1) + rng() * h * 0.14,
    );
    // Avoid stacking identical centers
    if (gulfs.some((g) => Math.abs(g.cx - cx) < halfW * 0.6)) continue;
    gulfs.push({ cx, halfW, depth });
  }
  return gulfs;
}

function makeRidges(w: number, h: number, rng: () => number): Ridge[] {
  const count = 1 + Math.floor(rng() * 3);
  const ridges: Ridge[] = [];
  for (let i = 0; i < count; i++) {
    ridges.push({
      cx: Math.floor(w * (0.15 + rng() * 0.7)),
      halfW: Math.floor(5 + rng() * 12),
      height: Math.floor(h * 0.06 + rng() * h * 0.12),
    });
  }
  return ridges;
}

function makeMesas(w: number, h: number, rng: () => number): Mesa[] {
  const count = Math.floor(rng() * 3);
  const mesas: Mesa[] = [];
  for (let i = 0; i < count; i++) {
    mesas.push({
      cx: Math.floor(w * (0.2 + rng() * 0.6)),
      halfW: Math.floor(10 + rng() * 18),
      top: Math.floor(h * (0.4 + rng() * 0.2)),
      ramp: 3 + Math.floor(rng() * 5),
    });
  }
  return mesas;
}

function makeTrenches(w: number, rng: () => number): Trench[] {
  const count = Math.floor(rng() * 3);
  const trenches: Trench[] = [];
  for (let i = 0; i < count; i++) {
    trenches.push({
      cx: Math.floor(w * (0.2 + rng() * 0.6)),
      halfW: Math.floor(3 + rng() * 6),
      depth: Math.floor(6 + rng() * 14),
    });
  }
  return trenches;
}

/**
 * Pick random valid surface positions on the *current* map (no pad flattening).
 * Used for sandbox respawn so tanks land on walkable, gentle ground after digs.
 */
export function pickRandomValidSpawns(
  world: VoxelWorld,
  count: number,
  seed = Date.now() >>> 0,
  midZ = Math.floor(world.depth / 2),
): Vec2[] {
  const rng = createRng(seed);
  const w = world.width;
  const h = world.height;
  type Cand = { x: number; y: number };
  const candidates: Cand[] = [];

  for (let x = 12; x < w - 12; x++) {
    // Require walkable footing (floating islands may have void columns)
    if (world.isVoidColumn(x + 0.5, midZ)) continue;
    const y0 = world.surfaceY(x, midZ);
    if (y0 < 4 || y0 > h - 10) continue;
    const ground = world.sampleGroundY(x + 0.5, midZ);
    if (ground < 0) continue;

    const yL = world.surfaceY(x - 2, midZ);
    const yR = world.surfaceY(x + 2, midZ);
    if (yL < 0 || yR < 0) continue;
    const slope = Math.abs(yL - yR);
    if (slope > 3) continue; // too steep to stand

    // Skip razor peaks / tiny pillars
    const yL2 = world.surfaceY(x - 1, midZ);
    const yR2 = world.surfaceY(x + 1, midZ);
    if (yL2 < 0 || yR2 < 0) continue;
    if (Math.abs(y0 - yL2) > 1.5 || Math.abs(y0 - yR2) > 1.5) continue;

    candidates.push({ x, y: ground });
  }

  // Fisher–Yates shuffle
  for (let i = candidates.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = candidates[i]!;
    candidates[i] = candidates[j]!;
    candidates[j] = tmp;
  }

  const minDist = Math.max(14, Math.floor(w / (count + 3)));
  const picked: Cand[] = [];
  for (const c of candidates) {
    if (picked.length >= count) break;
    if (picked.some((p) => Math.abs(p.x - c.x) < minDist)) continue;
    // Refresh y in case terrain changed (caller may dig between checks)
    const g = world.sampleGroundY(c.x + 0.5, midZ);
    if (g < 0) continue;
    picked.push({ x: c.x + 0.5, y: g });
  }

  // Fallback: space evenly and take nearest valid column
  let guard = 0;
  while (picked.length < count && guard++ < 40) {
    const t = (picked.length + 1) / (count + 1);
    let x = Math.floor(14 + t * (w - 28) + (rng() - 0.5) * 12);
    x = Math.max(12, Math.min(w - 13, x));
    // Search nearby for a valid column
    let found: Cand | null = null;
    for (let d = 0; d < 20 && !found; d++) {
      for (const sign of d === 0 ? [0] : [1, -1]) {
        const xx = x + sign * d;
        if (xx < 12 || xx >= w - 12) continue;
        if (world.isVoidColumn(xx + 0.5, midZ)) continue;
        const g = world.sampleGroundY(xx + 0.5, midZ);
        if (g < 0) continue;
        if (picked.some((p) => Math.abs(p.x - (xx + 0.5)) < minDist * 0.5)) {
          continue;
        }
        found = { x: xx + 0.5, y: g };
        break;
      }
    }
    if (found) picked.push(found);
    else break;
  }

  return picked;
}

/**
 * Pick spread-out surface pads so tanks (esp. bots) aren't always on map edges.
 */
function pickScatteredSpawns(
  world: VoxelWorld,
  midZ: number,
  w: number,
  h: number,
  count: number,
  rng: () => number,
  biome: MapBiome,
): Vec2[] {
  type Cand = { x: number; y: number; score: number };
  const candidates: Cand[] = [];

  for (let x = 14; x < w - 14; x += 2) {
    const y0 = world.surfaceY(x, midZ);
    if (y0 < 6 || y0 > h - 12) continue;
    const yL = world.surfaceY(x - 3, midZ);
    const yR = world.surfaceY(x + 3, midZ);
    const slope = Math.abs(yL - yR) + Math.abs(y0 - yL) * 0.5;
    // Prefer gentle slopes, mid-high ground, not underwater gulfs
    const heightScore = 1 - Math.abs(y0 / h - 0.4);
    const flatScore = Math.max(0, 1 - slope / 10);
    // Slight preference away from dead center (drama across the map)
    const spreadScore = Math.abs(x / w - 0.5);
    const score = flatScore * 1.4 + heightScore * 0.8 + spreadScore * 0.35 + rng() * 0.4;
    if (flatScore < 0.25 && slope > 8) continue;
    candidates.push({ x, y: y0 + 1, score });
  }

  // Shuffle-ish by score + noise
  candidates.sort((a, b) => b.score - a.score);

  const minDist = Math.max(18, Math.floor(w / (count + 2)));
  const picked: Cand[] = [];
  for (const c of candidates) {
    if (picked.length >= count) break;
    if (picked.some((p) => Math.abs(p.x - c.x) < minDist)) continue;
    picked.push(c);
  }

  // Fallback: force spaced slots if we under-picked
  while (picked.length < count) {
    const t = (picked.length + 1) / (count + 1);
    const x = Math.floor(14 + t * (w - 28) + (rng() - 0.5) * 10);
    const clamped = Math.max(14, Math.min(w - 15, x));
    if (picked.some((p) => Math.abs(p.x - clamped) < minDist * 0.6)) {
      // nudge
      const alt = clamped + (rng() > 0.5 ? minDist : -minDist);
      const x2 = Math.max(14, Math.min(w - 15, alt));
      picked.push({ x: x2, y: world.surfaceY(x2, midZ) + 1, score: 0 });
    } else {
      picked.push({
        x: clamped,
        y: world.surfaceY(clamped, midZ) + 1,
        score: 0,
      });
    }
  }

  // Fisher–Yates so player order ≠ left-to-right
  for (let i = picked.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = picked[i]!;
    picked[i] = picked[j]!;
    picked[j] = tmp;
  }

  const spawns: Vec2[] = [];
  for (const p of picked.slice(0, count)) {
    flattenSpawnPad(world, p.x, midZ, 3 + Math.floor(rng() * 2), biome);
    const y = world.surfaceY(p.x, midZ) + 1;
    spawns.push({ x: p.x, y: Math.max(1, y) });
  }
  return spawns;
}

function pickBiome(rng: () => number) {
  const total = BIOMES.reduce((s, b) => s + b.weight, 0);
  let r = rng() * total;
  for (const b of BIOMES) {
    r -= b.weight;
    if (r <= 0) return b;
  }
  return BIOMES[0]!;
}

function biomeProfile(biome: MapBiome, h: number, rng: () => number) {
  // Per-match jitter so two meadows don't feel identical
  const jitter = () => 0.9 + rng() * 0.25;
  switch (biome) {
    case "desert":
      return {
        base: h * 0.3 * jitter(),
        amp: h * 0.2 * jitter(),
        noiseScale: 2.8 + rng() * 1.2,
        octaves: 4,
        terrace: 0,
        edgeBoost: 0.38,
        rollFreq: 2.5 + rng() * 2,
      };
    case "canyon":
      return {
        base: h * 0.42 * jitter(),
        amp: h * 0.3 * jitter(),
        noiseScale: 4.2 + rng() * 2,
        octaves: 5,
        terrace: 4 + Math.floor(rng() * 3),
        edgeBoost: 0.5,
        rollFreq: 1.8 + rng(),
      };
    case "volcanic":
      return {
        base: h * 0.3 * jitter(),
        amp: h * 0.28 * jitter(),
        noiseScale: 3.8 + rng() * 1.5,
        octaves: 5,
        terrace: 3 + Math.floor(rng() * 3),
        edgeBoost: 0.42,
        rollFreq: 2 + rng() * 1.5,
      };
    case "arctic":
      return {
        base: h * 0.36 * jitter(),
        amp: h * 0.15 * jitter(),
        noiseScale: 2.2 + rng(),
        octaves: 3,
        terrace: 6 + Math.floor(rng() * 4),
        edgeBoost: 0.44,
        rollFreq: 1.5 + rng(),
      };
    case "ruins":
      return {
        base: h * 0.34 * jitter(),
        amp: h * 0.22 * jitter(),
        noiseScale: 3.5 + rng() * 1.5,
        octaves: 4,
        terrace: 5 + Math.floor(rng() * 3),
        edgeBoost: 0.45,
        rollFreq: 2.2 + rng(),
      };
    default:
      return {
        base: h * 0.34 * jitter(),
        amp: h * 0.24 * jitter(),
        noiseScale: 3.2 + rng() * 1.8,
        octaves: 5,
        terrace: 5 + Math.floor(rng() * 3),
        edgeBoost: 0.45,
        rollFreq: 2 + rng() * 2,
      };
  }
}

/**
 * Materials for a floating-island column (y from underside `bottom` to `top`).
 * Underside is dark rock (destructible) so blasts can open the floor into open sky.
 * No indestructible bedrock slab.
 */
function islandMaterial(
  biome: MapBiome,
  y: number,
  bottom: number,
  top: number,
  x: number,
  seed: number,
  rng: () => number,
): VoxelMaterial {
  const thickness = Math.max(1, top - bottom);
  const rel = (y - bottom) / thickness; // 0 underside → 1 surface

  // Craggy underside of the floating landmass
  if (y <= bottom + 1) return VoxelMaterial.Rock;

  switch (biome) {
    case "desert":
      if (rel < 0.35) return VoxelMaterial.Rock;
      if (y < top) return VoxelMaterial.Sand;
      return VoxelMaterial.Sand;
    case "canyon":
      if (rel < 0.4) return VoxelMaterial.Rock;
      if (y < top) return VoxelMaterial.Dirt;
      return VoxelMaterial.Dirt;
    case "volcanic":
      if (rel < 0.45) return VoxelMaterial.Rock;
      if (y === top) return VoxelMaterial.Rock;
      return fbm2D(x * 0.12, y * 0.12, seed + 11) > 0.55
        ? VoxelMaterial.Rock
        : VoxelMaterial.Dirt;
    case "arctic":
      if (rel < 0.3) return VoxelMaterial.Rock;
      if (y < top) return VoxelMaterial.Sand;
      return VoxelMaterial.Metal;
    case "ruins":
      if (rel < 0.35) return VoxelMaterial.Rock;
      if (y < top) {
        return fbm2D(x * 0.15, y * 0.1, seed + 3) > 0.65
          ? VoxelMaterial.Metal
          : VoxelMaterial.Dirt;
      }
      return rng() > 0.7 ? VoxelMaterial.Metal : VoxelMaterial.Grass;
    default:
      if (rel < 0.35) return VoxelMaterial.Rock;
      if (y < top) {
        if (fbm2D(x * 0.1, y * 0.1, seed + 99) > 0.72) return VoxelMaterial.Sand;
        return VoxelMaterial.Dirt;
      }
      return VoxelMaterial.Grass;
  }
}

function flattenSpawnPad(
  world: VoxelWorld,
  cx: number,
  cz: number,
  radius: number,
  biome: MapBiome,
): void {
  const targetY = Math.max(
    8,
    world.surfaceY(cx, cz),
    world.surfaceY(cx - 1, cz),
    world.surfaceY(cx + 1, cz),
  );
  // Keep pad as a floating shelf (not a pillar to y=0)
  const padBottom = Math.max(2, targetY - 5);
  const topMat =
    biome === "desert" || biome === "arctic"
      ? VoxelMaterial.Sand
      : biome === "volcanic"
        ? VoxelMaterial.Rock
        : VoxelMaterial.Grass;
  const fillMat =
    biome === "desert"
      ? VoxelMaterial.Sand
      : biome === "arctic"
        ? VoxelMaterial.Sand
        : VoxelMaterial.Dirt;

  for (let dx = -radius; dx <= radius; dx++) {
    for (let dz = -1; dz <= 1; dz++) {
      const x = cx + dx;
      const z = cz + dz;
      if (!world.inBounds(x, 0, z)) continue;
      for (let y = 0; y < world.height; y++) {
        if (y >= padBottom && y < targetY) {
          const mat =
            y === padBottom
              ? VoxelMaterial.Rock
              : y === targetY - 1
                ? topMat
                : fillMat;
          world.set(x, y, z, mat);
        } else {
          world.set(x, y, z, VoxelMaterial.Air);
        }
      }
    }
  }
}
