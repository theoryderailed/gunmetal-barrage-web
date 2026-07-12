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
  // Floating islands: every solid is diggable so a deep enough blast opens sky below.
  return mat !== VoxelMaterial.Air;
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

  /** Highest solid Y at (x, z), or -1 if empty column (open sky). */
  surfaceY(x: number, z: number): number {
    if (x < 0 || x >= this.width || z < 0 || z >= this.depth) return -1;
    for (let y = this.height - 1; y >= 0; y--) {
      if (isSolid(this.get(x, y, z))) return y;
    }
    return -1;
  }

  /**
   * Highest walkable solid. Maps are floating islands — any remaining solid
   * counts (bedrock is no longer a special floor). Empty column = void.
   */
  surfaceYWalkable(x: number, z: number): number {
    return this.surfaceY(x, z);
  }

  /**
   * Continuous surface height for tanks on the play plane.
   * Returns -1 when the island underfoot is gone (fall into open sky).
   *
   * Uses the mid-Z play plane only (full-depth digs keep depths consistent).
   * A hole under either supporting column drops you if you're mostly over it.
   */
  sampleGroundY(x: number, z: number, hover = 1.05): number {
    const z0 = Math.max(0, Math.min(this.depth - 1, Math.floor(z)));
    const x0 = Math.floor(x);
    const fx = x - x0; // 0..1 across column
    const h0 = this.surfaceY(x0, z0);
    const h1 = this.surfaceY(x0 + 1, z0);

    // Fully open sky under the footprint
    if (h0 < 0 && h1 < 0) return -1;

    // Mostly over a void column → fall through the island
    if (h0 < 0 && fx < 0.55) return -1;
    if (h1 < 0 && fx > 0.45) return -1;

    const left = h0 < 0 ? h1 : h0;
    const right = h1 < 0 ? h0 : h1;
    // surfaceY is voxel index of top solid; top face is at y+1
    const top = left + (right - left) * fx + 1;
    return top + (hover - 1); // hover 1.05 → sit just above top face
  }

  /** True when no solid remains under this X on the play plane (void / open sky). */
  isVoidColumn(x: number, z: number): boolean {
    const z0 = Math.max(0, Math.min(this.depth - 1, Math.floor(z)));
    const x0 = Math.floor(x);
    return this.surfaceY(x0, z0) < 0 && this.surfaceY(x0 + 1, z0) < 0;
  }

  /**
   * Carve or fill a sphere. Returns list of dirty chunk keys "cx,cy,cz".
   * Air carves default to full map depth (2.5D play plane — see stampEllipsoid).
   */
  stampSphere(
    cx: number,
    cy: number,
    cz: number,
    radius: number,
    material: VoxelMaterial,
    onlyDestructible = true,
  ): Set<string> {
    return this.stampEllipsoid(
      cx,
      cy,
      cz,
      radius,
      radius,
      radius,
      material,
      onlyDestructible,
    );
  }

  /**
   * Carve or fill an axis-aligned ellipsoid.
   *
   * **Air / destruction:** by default carves the full Z depth for every (x,y)
   * in the 2D ellipse. The arena is 2.5D — tanks only sample the mid plane, so
   * partial-depth spheres left "walls between depths" that snagged movement.
   * Pass `fullDepth: false` for true 3D stamps (props, etc.).
   */
  stampEllipsoid(
    cx: number,
    cy: number,
    cz: number,
    radiusX: number,
    radiusY: number,
    radiusZ: number,
    material: VoxelMaterial,
    onlyDestructible = true,
    opts?: { fullDepth?: boolean },
  ): Set<string> {
    const dirty = new Set<string>();
    const rx = Math.max(0.5, radiusX);
    const ry = Math.max(0.5, radiusY);
    const rz = Math.max(0.5, radiusZ);
    const ix = Math.ceil(rx);
    const iy = Math.ceil(ry);
    const iz = Math.ceil(rz);
    const invRx2 = 1 / (rx * rx);
    const invRy2 = 1 / (ry * ry);
    const invRz2 = 1 / (rz * rz);
    // Default: full-depth air carve for consistent 2.5D surfaces
    const fullDepth =
      opts?.fullDepth ?? material === VoxelMaterial.Air;

    if (fullDepth) {
      for (let y = cy - iy; y <= cy + iy; y++) {
        for (let x = cx - ix; x <= cx + ix; x++) {
          if (x < 0 || x >= this.width || y < 0 || y >= this.height) continue;
          const dx = x - cx;
          const dy = y - cy;
          // 2D ellipse in X–Y (play plane); ignore Z so every depth matches
          if (dx * dx * invRx2 + dy * dy * invRy2 > 1) continue;
          for (let z = 0; z < this.depth; z++) {
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

    for (let y = cy - iy; y <= cy + iy; y++) {
      for (let z = cz - iz; z <= cz + iz; z++) {
        for (let x = cx - ix; x <= cx + ix; x++) {
          if (!this.inBounds(x, y, z)) continue;
          const dx = x - cx;
          const dy = y - cy;
          const dz = z - cz;
          if (dx * dx * invRx2 + dy * dy * invRy2 + dz * dz * invRz2 > 1) {
            continue;
          }
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
