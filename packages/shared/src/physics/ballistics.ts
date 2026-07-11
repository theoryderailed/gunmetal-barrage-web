import { isSolid, type VoxelWorld } from "../voxels.js";
import type { Vec3, WeaponDef } from "../types.js";

export const GRAVITY = -28;
export const DEFAULT_DT = 1 / 60;
export const MAX_POWER = 100;
export const MIN_POWER = 5;
export const MIN_ANGLE = 0;
export const MAX_ANGLE = 180;

export interface BallisticInput {
  origin: Vec3;
  /** Degrees from +X axis in the X–Y plane; 0 = right, 90 = straight up. */
  angleDeg: number;
  /** 0–100 power. */
  power: number;
  facing: 1 | -1;
  wind: number;
  weapon: Pick<WeaponDef, "powerMultiplier" | "trajectory">;
}

export interface BallisticStep {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
}

export interface ImpactResult {
  hit: boolean;
  x: number;
  y: number;
  z: number;
  steps: BallisticStep[];
  reason: "terrain" | "bounds" | "timeout" | "none";
}

function powerToSpeed(power: number, mult: number): number {
  const p = Math.max(MIN_POWER, Math.min(MAX_POWER, power)) / MAX_POWER;
  return (18 + p * 52) * mult;
}

export function initialVelocity(input: BallisticInput): Vec3 {
  const speed = powerToSpeed(input.power, input.weapon.powerMultiplier);
  const rad = (input.angleDeg * Math.PI) / 180;
  const dir = input.facing;
  // Angle 0 = horizontal in facing direction; 90 = up
  const vx = Math.cos(rad) * speed * dir;
  const vy = Math.sin(rad) * speed;
  const vz = 0;
  return { x: vx, y: vy, z: vz };
}

/** Travel distance before terrain collisions count (avoids muzzle clipping). */
export const MUZZLE_CLEARANCE = 2.8;

/**
 * Integrate a ballistic arc until impact or timeout.
 * Wind applies as horizontal acceleration on X.
 */
export function simulateBallistic(
  world: VoxelWorld,
  input: BallisticInput,
  opts?: { dt?: number; maxSteps?: number; bounceLeft?: number; muzzleClearance?: number },
): ImpactResult {
  const dt = opts?.dt ?? DEFAULT_DT;
  const maxSteps = opts?.maxSteps ?? 600;
  const clearance = opts?.muzzleClearance ?? MUZZLE_CLEARANCE;
  let bounceLeft =
    opts?.bounceLeft ?? (input.weapon.trajectory === "bounce" ? 2 : 0);

  const vel = initialVelocity(input);
  let x = input.origin.x;
  let y = input.origin.y;
  let z = input.origin.z;
  let vx = vel.x;
  let vy = vel.y;
  let vz = vel.z;

  // Lob: extra loft
  if (input.weapon.trajectory === "lob") {
    vy *= 1.15;
    vx *= 0.92;
  }

  let traveled = 0;

  const steps: BallisticStep[] = [{ x, y, z, vx, vy, vz }];
  const windAccel = input.wind * 4;

  for (let i = 0; i < maxSteps; i++) {
    // Drill: slightly reduced gravity (flatter arc / a bit more range — not a rocket)
    const g = input.weapon.trajectory === "drill" ? GRAVITY * 0.82 : GRAVITY;
    vx += windAccel * dt;
    vy += g * dt;
    const px = x;
    const py = y;
    const pz = z;
    x += vx * dt;
    y += vy * dt;
    z += vz * dt;
    traveled += Math.hypot(x - px, y - py, z - pz);

    steps.push({ x, y, z, vx, vy, vz });

    if (
      x < -2 ||
      x > world.width + 2 ||
      y < -5 ||
      y > world.height + 30
    ) {
      return { hit: true, x, y, z, steps, reason: "bounds" };
    }

    // Skip solid checks near the barrel so the shell doesn't detonate on your hull/slope
    if (traveled < clearance) continue;

    const ix = Math.floor(x);
    const iy = Math.floor(y);
    const iz = Math.floor(z);

    if (world.inBounds(ix, iy, iz) && isSolid(world.get(ix, iy, iz))) {
      if (bounceLeft > 0) {
        bounceLeft--;
        // Reflect roughly on vertical surface preference
        const below = world.inBounds(ix, iy - 1, iz) && isSolid(world.get(ix, iy - 1, iz));
        if (below && vy < 0) {
          vy = Math.abs(vy) * 0.65;
          vx *= 0.85;
        } else {
          vx = -vx * 0.7;
          vy *= 0.85;
        }
        // Nudge out of block
        y += 0.6;
        continue;
      }
      return { hit: true, x, y, z, steps, reason: "terrain" };
    }
  }

  return { hit: false, x, y, z, steps, reason: "timeout" };
}

/**
 * Lightweight preview polyline for aim UI.
 * Respects bounce / lob / drill via the weapon trajectory type.
 */
export function previewTrajectory(
  world: VoxelWorld,
  input: BallisticInput,
  maxPoints = 80,
): Vec3[] {
  const bounceLeft = input.weapon.trajectory === "bounce" ? 2 : 0;
  const result = simulateBallistic(world, input, {
    maxSteps: Math.max(maxPoints * 3, 240),
    bounceLeft,
  });
  const pts: Vec3[] = [];
  const stride = Math.max(1, Math.floor(result.steps.length / maxPoints));
  for (let i = 0; i < result.steps.length; i += stride) {
    const s = result.steps[i]!;
    pts.push({ x: s.x, y: s.y, z: s.z });
  }
  // Always include final impact sample
  const last = result.steps[result.steps.length - 1];
  if (last && pts.length > 0) {
    const prev = pts[pts.length - 1]!;
    if (prev.x !== last.x || prev.y !== last.y) {
      pts.push({ x: last.x, y: last.y, z: last.z });
    }
  }
  return pts;
}

/**
 * Splash damage with distance falloff.
 * Self-hits use a reduced multiplier (classic artillery friendly-fire, not full suicide).
 */
export function computeDamage(
  baseDamage: number,
  distance: number,
  blastRadius: number,
  armor: number,
  opts?: { selfHit?: boolean },
): number {
  if (blastRadius <= 0 || distance > blastRadius) return 0;
  // Soft edge: outer 15% of radius deals very little
  const falloff = 1 - distance / blastRadius;
  if (falloff <= 0) return 0;
  const raw = baseDamage * (0.2 + 0.8 * falloff * falloff);
  const reduction = armor / (armor + 20);
  let dmg = raw * (1 - reduction * 0.7);
  // Self-splash is intentional (Gunbound/Worms) but not full damage
  if (opts?.selfHit) dmg *= 0.4;
  dmg = Math.round(dmg);
  return dmg > 0 ? dmg : 0;
}

/** Muzzle point slightly ahead/up of the tank so shells clear the hull. */
export function muzzleOrigin(
  tankX: number,
  tankY: number,
  midZ: number,
  facing: 1 | -1,
  angleDeg: number,
  size = 1,
): Vec3 {
  const rad = (angleDeg * Math.PI) / 180;
  const barrel = 1.6 * size;
  return {
    x: tankX + facing * (0.9 * size + Math.cos(rad) * barrel * 0.35),
    y: tankY + 0.95 * size + Math.sin(rad) * barrel * 0.35,
    z: midZ + 0.5,
  };
}
