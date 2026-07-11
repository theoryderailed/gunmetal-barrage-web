import { VoxelMaterial } from "./types.js";

export const CHUNK_SIZE = 16;

export function materialColor(mat: VoxelMaterial): [number, number, number] {
  switch (mat) {
    case VoxelMaterial.Dirt:
      return [0.45, 0.28, 0.14];
    case VoxelMaterial.Sand:
      return [0.82, 0.72, 0.42];
    case VoxelMaterial.Rock:
      return [0.45, 0.48, 0.52];
    case VoxelMaterial.Metal:
      return [0.55, 0.58, 0.65];
    case VoxelMaterial.Bedrock:
      return [0.18, 0.16, 0.2];
    case VoxelMaterial.Grass:
      return [0.28, 0.55, 0.22];
    default:
      return [0, 0, 0];
  }
}

export function isSolid(mat: number): boolean {
  return mat !== VoxelMaterial.Air;
}

export function isDestructible(mat: number): boolean {
  return (
    mat !== VoxelMaterial.Air &&
    mat !== VoxelMaterial.Bedrock
  );
}

/** Flat voxel grid: index = x + z * width + y * width * depth */
export class VoxelWorld {
  readonly width: number;
  readonly height: number;
  readonly depth: number;
  readonly data: Uint8Array;

  constructor(width: number, height: number, depth: number, data?: Uint8Array) {
    this.width = width;
    this.height = height;
    this.depth = depth;
    this.data = data ?? new Uint8Array(width * height * depth);
  }

  index(x: number, y: number, z: number): number {
    return x + z * this.width + y * this.width * this.depth;
  }

  inBounds(x: number, y: number, z: number): boolean {
    return (
      x >= 0 &&
      y >= 0 &&
      z >= 0 &&
      x < this.width &&
      y < this.height &&
      z < this.depth
    );
  }

  get(x: number, y: number, z: number): VoxelMaterial {
    if (!this.inBounds(x, y, z)) return VoxelMaterial.Air;
    return this.data[this.index(x, y, z)] as VoxelMaterial;
  }

  set(x: number, y: number, z: number, mat: VoxelMaterial): void {
    if (!this.inBounds(x, y, z)) return;
    this.data[this.index(x, y, z)] = mat;
  }

  /** Highest solid Y at (x, z), or -1 if empty column. */
  surfaceY(x: number, z: number): number {
    for (let y = this.height - 1; y >= 0; y--) {
      if (isSolid(this.get(x, y, z))) return y;
    }
    return -1;
  }

  /**
   * Continuous surface height (top of solid) with horizontal lerp between columns.
   * Returns the Y a tank should rest at, or -1 if no ground.
   */
  sampleGroundY(x: number, z: number, hover = 1.05): number {
    const z0 = Math.floor(z);
    const x0 = Math.floor(x);
    const fx = x - x0; // 0..1 across column
    const h0 = this.surfaceY(x0, z0);
    const h1 = this.surfaceY(x0 + 1, z0);
    if (h0 < 0 && h1 < 0) return -1;
    const left = h0 < 0 ? h1 : h0;
    const right = h1 < 0 ? h0 : h1;
    // surfaceY is voxel index of top solid; top face is at y+1
    const top = left + (right - left) * fx + 1;
    return top + (hover - 1); // hover 1.05 → sit just above top face
  }

  /**
   * Carve or fill a sphere. Returns list of dirty chunk keys "cx,cy,cz".
   */
  stampSphere(
    cx: number,
    cy: number,
    cz: number,
    radius: number,
    material: VoxelMaterial,
    onlyDestructible = true,
  ): Set<string> {
    const dirty = new Set<string>();
    const r = Math.ceil(radius);
    const r2 = radius * radius;
    for (let y = cy - r; y <= cy + r; y++) {
      for (let z = cz - r; z <= cz + r; z++) {
        for (let x = cx - r; x <= cx + r; x++) {
          if (!this.inBounds(x, y, z)) continue;
          const dx = x - cx;
          const dy = y - cy;
          const dz = z - cz;
          if (dx * dx + dy * dy + dz * dz > r2) continue;
          const current = this.get(x, y, z);
          if (material === VoxelMaterial.Air) {
            if (onlyDestructible && !isDestructible(current)) continue;
            if (current === VoxelMaterial.Air) continue;
          }
          this.set(x, y, z, material);
          dirty.add(chunkKey(x, y, z));
        }
      }
    }
    return dirty;
  }

  clone(): VoxelWorld {
    return new VoxelWorld(
      this.width,
      this.height,
      this.depth,
      new Uint8Array(this.data),
    );
  }
}

export function chunkKey(x: number, y: number, z: number): string {
  const cx = Math.floor(x / CHUNK_SIZE);
  const cy = Math.floor(y / CHUNK_SIZE);
  const cz = Math.floor(z / CHUNK_SIZE);
  return `${cx},${cy},${cz}`;
}

export function parseChunkKey(key: string): [number, number, number] {
  const [cx, cy, cz] = key.split(",").map(Number);
  return [cx!, cy!, cz!];
}
