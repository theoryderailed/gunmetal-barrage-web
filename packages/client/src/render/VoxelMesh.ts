import * as THREE from "three";
import {
  CHUNK_SIZE,
  materialColor,
  isSolid,
  parseChunkKey,
  type VoxelWorld,
} from "@gunmetal-barrage/shared";

const FACES: {
  dir: [number, number, number];
  corners: [number, number, number][];
  normal: [number, number, number];
  shade: number;
}[] = [
  {
    // +Y
    dir: [0, 1, 0],
    corners: [
      [0, 1, 1],
      [1, 1, 1],
      [1, 1, 0],
      [0, 1, 0],
    ],
    normal: [0, 1, 0],
    shade: 1.0,
  },
  {
    // -Y
    dir: [0, -1, 0],
    corners: [
      [0, 0, 0],
      [1, 0, 0],
      [1, 0, 1],
      [0, 0, 1],
    ],
    normal: [0, -1, 0],
    shade: 0.45,
  },
  {
    // +X
    dir: [1, 0, 0],
    corners: [
      [1, 0, 1],
      [1, 1, 1],
      [1, 1, 0],
      [1, 0, 0],
    ],
    normal: [1, 0, 0],
    shade: 0.75,
  },
  {
    // -X
    dir: [-1, 0, 0],
    corners: [
      [0, 0, 0],
      [0, 1, 0],
      [0, 1, 1],
      [0, 0, 1],
    ],
    normal: [-1, 0, 0],
    shade: 0.7,
  },
  {
    // +Z
    dir: [0, 0, 1],
    corners: [
      [0, 0, 1],
      [0, 1, 1],
      [1, 1, 1],
      [1, 0, 1],
    ],
    normal: [0, 0, 1],
    shade: 0.85,
  },
  {
    // -Z
    dir: [0, 0, -1],
    corners: [
      [1, 0, 0],
      [1, 1, 0],
      [0, 1, 0],
      [0, 0, 0],
    ],
    normal: [0, 0, -1],
    shade: 0.65,
  },
];

export class VoxelMeshManager {
  readonly group = new THREE.Group();
  private chunks = new Map<string, THREE.Mesh>();
  private world: VoxelWorld | null = null;
  private material = new THREE.MeshLambertMaterial({
    vertexColors: true,
    flatShading: true,
  });

  setWorld(world: VoxelWorld): void {
    this.clear();
    this.world = world;
    const cxMax = Math.ceil(world.width / CHUNK_SIZE);
    const cyMax = Math.ceil(world.height / CHUNK_SIZE);
    const czMax = Math.ceil(world.depth / CHUNK_SIZE);
    for (let cy = 0; cy < cyMax; cy++) {
      for (let cz = 0; cz < czMax; cz++) {
        for (let cx = 0; cx < cxMax; cx++) {
          this.rebuildChunk(`${cx},${cy},${cz}`);
        }
      }
    }
  }

  rebuildDirty(keys: Iterable<string>): void {
    for (const key of keys) {
      this.rebuildChunk(key);
    }
  }

  private rebuildChunk(key: string): void {
    if (!this.world) return;
    const existing = this.chunks.get(key);
    if (existing) {
      this.group.remove(existing);
      existing.geometry.dispose();
      this.chunks.delete(key);
    }

    const [cx, cy, cz] = parseChunkKey(key);
    const geometry = buildChunkGeometry(this.world, cx, cy, cz);
    if (!geometry) return;

    const mesh = new THREE.Mesh(geometry, this.material);
    mesh.castShadow = false;
    mesh.receiveShadow = true;
    mesh.position.set(0, 0, 0);
    this.chunks.set(key, mesh);
    this.group.add(mesh);
  }

  clear(): void {
    for (const mesh of this.chunks.values()) {
      this.group.remove(mesh);
      mesh.geometry.dispose();
    }
    this.chunks.clear();
  }

  dispose(): void {
    this.clear();
    this.material.dispose();
  }
}

function buildChunkGeometry(
  world: VoxelWorld,
  cx: number,
  cy: number,
  cz: number,
): THREE.BufferGeometry | null {
  const positions: number[] = [];
  const normals: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];
  let vertexCount = 0;

  const x0 = cx * CHUNK_SIZE;
  const y0 = cy * CHUNK_SIZE;
  const z0 = cz * CHUNK_SIZE;
  const x1 = Math.min(x0 + CHUNK_SIZE, world.width);
  const y1 = Math.min(y0 + CHUNK_SIZE, world.height);
  const z1 = Math.min(z0 + CHUNK_SIZE, world.depth);

  for (let y = y0; y < y1; y++) {
    for (let z = z0; z < z1; z++) {
      for (let x = x0; x < x1; x++) {
        const mat = world.get(x, y, z);
        if (!isSolid(mat)) continue;
        const [cr, cg, cb] = materialColor(mat);

        for (const face of FACES) {
          const nx = x + face.dir[0];
          const ny = y + face.dir[1];
          const nz = z + face.dir[2];
          if (isSolid(world.get(nx, ny, nz))) continue;

          const base = vertexCount;
          for (const c of face.corners) {
            positions.push(x + c[0], y + c[1], z + c[2]);
            normals.push(...face.normal);
            colors.push(cr * face.shade, cg * face.shade, cb * face.shade);
            vertexCount++;
          }
          indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
        }
      }
    }
  }

  if (vertexCount === 0) return null;

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
  geo.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  geo.setIndex(indices);
  return geo;
}
