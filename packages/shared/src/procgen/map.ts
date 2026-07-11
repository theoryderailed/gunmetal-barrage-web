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

/**
 * Generate a 2.5D side-view arena from a seed.
 * Biome is deterministic from seed → random map each match.
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

  const profile = biomeProfile(biomePick.biome, h);
  const midZ = Math.floor(d / 2);

  for (let x = 0; x < w; x++) {
    const nx = x / w;
    let heightNoise = fbm2D(nx * profile.noiseScale, 0.5, seed, profile.octaves);
    if (profile.terrace) {
      heightNoise = Math.floor(heightNoise * profile.terrace) / profile.terrace;
    }
    let surface = Math.floor(profile.base + heightNoise * profile.amp);

    if (x < 6 || x > w - 7) {
      surface = Math.max(surface, Math.floor(h * profile.edgeBoost));
    }

    // Biome-specific features
    if (biomePick.biome === "canyon" || biomePick.biome === "volcanic") {
      const pit = fbm2D(nx * 2.2, 2.5, seed + 7, 3);
      if (pit < 0.4 && x > w * 0.25 && x < w * 0.75) {
        surface -= Math.floor((0.4 - pit) * profile.pitDepth);
      }
    } else if (biomePick.biome === "desert") {
      const dune = Math.sin(nx * Math.PI * 5 + seed * 0.01) * 0.5 + 0.5;
      surface += Math.floor(dune * 6);
    } else if (biomePick.biome === "arctic") {
      const shelf = fbm2D(nx * 3, 1.2, seed + 3, 3);
      if (shelf > 0.55) surface += Math.floor((shelf - 0.55) * 14);
    } else {
      const pit = fbm2D(nx * 2, 2.5, seed + 7, 3);
      if (pit < 0.35 && x > w * 0.3 && x < w * 0.7) {
        surface -= Math.floor((0.35 - pit) * 14);
      }
    }

    surface = Math.max(4, Math.min(h - 8, surface));

    for (let z = 0; z < d; z++) {
      const edgeFade = 1 - Math.abs(z - midZ) / (d * 0.55);
      const colHeight = Math.floor(surface * Math.max(0.55, edgeFade));

      for (let y = 0; y <= colHeight; y++) {
        world.set(x, y, z, surfaceMaterial(biomePick.biome, y, colHeight, x, seed, rng));
      }

      // Caves (skip arctic ice shelves somewhat)
      if (
        biomePick.biome !== "arctic" &&
        x > 20 &&
        x < w - 20
      ) {
        for (let y = 6; y < colHeight - 4; y++) {
          const cave = fbm2D(x * 0.08, y * 0.1, seed + 42, 3);
          const threshold =
            biomePick.biome === "volcanic"
              ? [0.58, 0.7]
              : [0.62, 0.72];
          if (cave > threshold[0]! && cave < threshold[1]!) {
            if (world.get(x, y, z) !== VoxelMaterial.Bedrock) {
              world.set(x, y, z, VoxelMaterial.Air);
            }
          }
        }
      }
    }
  }

  // Props / ruins
  const ruinCount =
    biomePick.biome === "ruins"
      ? 5 + Math.floor(rng() * 4)
      : biomePick.biome === "volcanic"
        ? 1 + Math.floor(rng() * 2)
        : 2 + Math.floor(rng() * 3);

  for (let i = 0; i < ruinCount; i++) {
    const rx = 20 + Math.floor(rng() * (w - 40));
    const rz = midZ;
    const ry = world.surfaceY(rx, rz) + 1;
    const rw = 3 + Math.floor(rng() * 4);
    const rh = 2 + Math.floor(rng() * 5);
    for (let dx = 0; dx < rw; dx++) {
      for (let dy = 0; dy < rh; dy++) {
        if (rng() > 0.22) {
          const mat =
            biomePick.biome === "arctic"
              ? VoxelMaterial.Rock
              : biomePick.biome === "volcanic" && rng() > 0.5
                ? VoxelMaterial.Rock
                : VoxelMaterial.Metal;
          world.set(rx + dx, ry + dy, rz, mat);
          if (d > 2) world.set(rx + dx, ry + dy, rz + 1, mat);
        }
      }
    }
  }

  // Spawns
  const spawns: Vec2[] = [];
  const players = Math.max(2, maxPlayers);
  for (let i = 0; i < players; i++) {
    const left = i % 2 === 0;
    const slot = Math.floor(i / 2);
    const margin = 12 + slot * 14;
    const x = left ? margin : w - 1 - margin;
    flattenSpawnPad(world, x, midZ, 3, biomePick.biome);
    const y = world.surfaceY(x, midZ) + 1;
    spawns.push({ x, y: Math.max(1, y) });
  }

  return {
    world,
    spawns,
    seed,
    biome: biomePick.biome,
    theme,
    name: biomePick.name,
  };
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

function biomeProfile(biome: MapBiome, h: number) {
  switch (biome) {
    case "desert":
      return {
        base: h * 0.32,
        amp: h * 0.18,
        noiseScale: 3.2,
        octaves: 4,
        terrace: 0,
        edgeBoost: 0.4,
        pitDepth: 8,
      };
    case "canyon":
      return {
        base: h * 0.4,
        amp: h * 0.28,
        noiseScale: 5,
        octaves: 5,
        terrace: 5,
        edgeBoost: 0.5,
        pitDepth: 28,
      };
    case "volcanic":
      return {
        base: h * 0.3,
        amp: h * 0.26,
        noiseScale: 4.5,
        octaves: 5,
        terrace: 4,
        edgeBoost: 0.42,
        pitDepth: 22,
      };
    case "arctic":
      return {
        base: h * 0.38,
        amp: h * 0.16,
        noiseScale: 2.8,
        octaves: 3,
        terrace: 8,
        edgeBoost: 0.44,
        pitDepth: 6,
      };
    case "ruins":
      return {
        base: h * 0.34,
        amp: h * 0.2,
        noiseScale: 4.2,
        octaves: 4,
        terrace: 6,
        edgeBoost: 0.45,
        pitDepth: 12,
      };
    default:
      return {
        base: h * 0.35,
        amp: h * 0.22,
        noiseScale: 4,
        octaves: 5,
        terrace: 6,
        edgeBoost: 0.45,
        pitDepth: 18,
      };
  }
}

function surfaceMaterial(
  biome: MapBiome,
  y: number,
  colHeight: number,
  x: number,
  seed: number,
  rng: () => number,
): VoxelMaterial {
  if (y === 0) return VoxelMaterial.Bedrock;

  switch (biome) {
    case "desert":
      if (y < colHeight * 0.3) return VoxelMaterial.Rock;
      if (y < colHeight - 1) return VoxelMaterial.Sand;
      return VoxelMaterial.Sand;
    case "canyon":
      if (y < colHeight * 0.4) return VoxelMaterial.Rock;
      if (y < colHeight - 1) return VoxelMaterial.Dirt;
      return VoxelMaterial.Dirt;
    case "volcanic":
      if (y < colHeight * 0.5) return VoxelMaterial.Rock;
      if (y === colHeight) return VoxelMaterial.Rock;
      return fbm2D(x * 0.12, y * 0.12, seed + 11) > 0.55
        ? VoxelMaterial.Rock
        : VoxelMaterial.Dirt;
    case "arctic":
      if (y < colHeight * 0.25) return VoxelMaterial.Rock;
      if (y < colHeight - 1) return VoxelMaterial.Sand; // packed snow-ish
      return VoxelMaterial.Metal; // ice crust look via metal tint later
    case "ruins":
      if (y < colHeight * 0.35) return VoxelMaterial.Rock;
      if (y < colHeight - 1) {
        return fbm2D(x * 0.15, y * 0.1, seed + 3) > 0.65
          ? VoxelMaterial.Metal
          : VoxelMaterial.Dirt;
      }
      return rng() > 0.7 ? VoxelMaterial.Metal : VoxelMaterial.Grass;
    default:
      if (y < colHeight * 0.35) return VoxelMaterial.Rock;
      if (y < colHeight - 1) {
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
        if (y < targetY) {
          const mat =
            y === 0
              ? VoxelMaterial.Bedrock
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
