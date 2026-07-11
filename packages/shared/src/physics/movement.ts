import type { VoxelWorld } from "../voxels.js";
import { MAX_CLIMB_PER_UNIT } from "../rules.js";

export interface MoveResult {
  x: number;
  y: number;
  /** Actual distance traveled along X */
  traveled: number;
  blocked: boolean;
}

/**
 * Continuous terrain-following move for the 2.5D side arena.
 * Uses substeps + interpolated ground height so tanks glide over voxel stairs
 * instead of snapping column-to-column.
 */
export function moveAlongTerrain(
  world: VoxelWorld,
  x: number,
  y: number,
  z: number,
  dir: -1 | 1,
  distance: number,
  opts?: {
    maxClimbPerUnit?: number;
    substep?: number;
    minX?: number;
    maxX?: number;
  },
): MoveResult {
  if (distance <= 0) {
    return { x, y, traveled: 0, blocked: false };
  }

  const maxClimb = opts?.maxClimbPerUnit ?? MAX_CLIMB_PER_UNIT;
  const sub = opts?.substep ?? 0.12;
  const minX = opts?.minX ?? 1;
  const maxX = opts?.maxX ?? world.width - 2;

  let cx = x;
  let cy = y;
  let remaining = distance;
  let traveled = 0;
  let blocked = false;

  while (remaining > 1e-4) {
    const step = Math.min(sub, remaining);
    const nx = cx + dir * step;
    if (nx < minX || nx > maxX) {
      blocked = true;
      break;
    }

    const ground = world.sampleGroundY(nx, z);
    if (ground < 0) {
      blocked = true;
      break;
    }

    const rise = ground - cy;
    // Gentle slopes: normal climb budget
    // After blasts, crater lips are steeper — allow short step-ups so tanks
    // don't get permanently trapped by a 1–2 voxel ledge between depths/columns.
    const softStep = maxClimb * step + 0.35;
    if (rise > softStep) {
      if (rise <= 2.25) {
        // Step onto the ledge over one frame
        cx = nx;
        cy = ground;
        traveled += step;
        remaining -= step;
        continue;
      }
      blocked = true;
      break;
    }

    cx = nx;
    cy = ground;
    traveled += step;
    remaining -= step;
  }

  return { x: cx, y: cy, traveled, blocked };
}
