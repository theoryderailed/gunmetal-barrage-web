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
    // Open sky underfoot (dug through floating island): step in and fall
    if (ground < 0) {
      cx = nx;
      cy = -4;
      traveled += step;
      remaining = 0;
      blocked = false;
      break;
    }

    const rise = ground - cy;
    // Climb limit: smooth slopes follow maxClimb/unit; absolute max is ~1 voxel
    // so tanks cannot leap onto 2-high neighboring pillars.
    // (Old code allowed free 2.25-unit step-ups which felt like jumps.)
    const slopeBudget = maxClimb * step + 0.28;
    const maxStepHeight = 1.05;
    const maxRise = Math.min(maxStepHeight, Math.max(slopeBudget, 0.95));
    if (rise > maxRise) {
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
