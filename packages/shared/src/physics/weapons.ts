import { VoxelMaterial, type WeaponDef } from "../types.js";
import type { VoxelWorld } from "../voxels.js";
import {
  computeDamage,
  muzzleOrigin,
  simulateBallistic,
  type ImpactResult,
} from "./ballistics.js";

export interface BlastPoint {
  x: number;
  y: number;
  z: number;
  radius: number;
  /** Fraction of weapon.damage for this blast (cluster submunitions < 1). */
  damageScale: number;
}

export interface WeaponFireInput {
  weapon: WeaponDef;
  tankX: number;
  tankY: number;
  midZ: number;
  facing: 1 | -1;
  angleDeg: number;
  power: number;
  wind: number;
  chassisSize?: number;
}

export interface WeaponFireResult {
  /** Path to animate (primary shell). */
  path: { x: number; y: number; z: number }[];
  /** All shell paths (Triple Threat = 3; others usually length 1). */
  paths: { x: number; y: number; z: number }[][];
  impact: ImpactResult;
  /** All crater/damage centers (primary + cluster submunitions). */
  blasts: BlastPoint[];
}

/**
 * Resolve a weapon shot into a primary trajectory + blast points.
 *
 * - ballistic / lob / drill / bounce: one shell, one blast at impact
 * - cluster (Scatter): one shell, then a pattern of blasts *around the impact*
 *   (NOT multiple muzzle arcs — those short-land and self-damage)
 * - multi-count non-cluster (Triple): tight parallel arcs, same range band
 */
export function simulateWeaponFire(
  world: VoxelWorld,
  input: WeaponFireInput,
): WeaponFireResult {
  const size = input.chassisSize ?? 1;
  const origin = muzzleOrigin(
    input.tankX,
    input.tankY,
    input.midZ,
    input.facing,
    input.angleDeg,
    size,
  );
  const weapon = input.weapon;

  // Cluster: single flight, split on impact
  if (weapon.trajectory === "cluster") {
    const impact = simulateBallistic(world, {
      origin,
      angleDeg: input.angleDeg,
      power: input.power,
      facing: input.facing,
      wind: input.wind,
      weapon,
    });
    const path = impact.steps.map((s) => ({ x: s.x, y: s.y, z: s.z }));
    const blasts = buildClusterBlasts(weapon, impact, input.facing);
    return { path, paths: [path], impact, blasts };
  }

  // Multi-shell tight spread (e.g. Triple Threat) — same power/angle, tiny fan
  const count = Math.max(1, weapon.projectileCount);
  if (count > 1) {
    const paths: { x: number; y: number; z: number }[][] = [];
    const blasts: BlastPoint[] = [];
    let primaryImpact: ImpactResult | null = null;

    for (let i = 0; i < count; i++) {
      const t = count === 1 ? 0 : i / (count - 1) - 0.5;
      // ±2° max — stays in the same range band, won't short-land at your feet
      const angleJitter = t * 4;
      const impact = simulateBallistic(world, {
        origin: {
          x: origin.x,
          y: origin.y,
          z: origin.z,
        },
        angleDeg: input.angleDeg + angleJitter,
        power: input.power,
        facing: input.facing,
        wind: input.wind,
        weapon,
      });
      if (!primaryImpact) primaryImpact = impact;
      paths.push(impact.steps.map((s) => ({ x: s.x, y: s.y, z: s.z })));
      if (impact.reason === "terrain" || impact.reason === "bounds") {
        blasts.push({
          x: impact.x,
          y: impact.y,
          z: impact.z,
          radius: weapon.blastRadius * 0.85,
          damageScale: 0.75,
        });
      }
    }

    return {
      path: paths[0] ?? [],
      paths,
      impact: primaryImpact!,
      blasts,
    };
  }

  // Single shell
  const impact = simulateBallistic(world, {
    origin,
    angleDeg: input.angleDeg,
    power: input.power,
    facing: input.facing,
    wind: input.wind,
    weapon,
  });
  const path = impact.steps.map((s) => ({ x: s.x, y: s.y, z: s.z }));
  const blasts: BlastPoint[] = [];
  if (impact.reason === "terrain" || impact.reason === "bounds") {
    blasts.push({
      x: impact.x,
      y: impact.y,
      z: impact.z,
      radius: weapon.blastRadius,
      damageScale: 1,
    });
  }
  return { path, paths: [path], impact, blasts };
}

/** Submunitions fan around the primary impact — all near the target, not the shooter. */
function buildClusterBlasts(
  weapon: WeaponDef,
  impact: ImpactResult,
  facing: 1 | -1,
): BlastPoint[] {
  if (impact.reason !== "terrain" && impact.reason !== "bounds") return [];

  const n = Math.max(3, weapon.projectileCount);
  const blasts: BlastPoint[] = [];
  // Center hit
  blasts.push({
    x: impact.x,
    y: impact.y,
    z: impact.z,
    radius: weapon.blastRadius * 1.1,
    damageScale: 0.9,
  });
  // Side pellets around impact (along ground plane)
  const spread = 3.5;
  for (let i = 0; i < n - 1; i++) {
    const t = (i / Math.max(1, n - 2)) * 2 - 1; // -1..1
    blasts.push({
      x: impact.x + t * spread * facing,
      y: impact.y + (Math.abs(t) < 0.2 ? 0.5 : -0.2),
      z: impact.z,
      radius: weapon.blastRadius * 0.75,
      damageScale: 0.55,
    });
  }
  return blasts;
}

export interface DamageTarget {
  id: string;
  x: number;
  y: number;
  armor: number;
  isShooter: boolean;
}

/**
 * Apply all blasts to targets. Returns total damage per target id.
 * Caps multi-blast stacking so scatter can't delete a tank in one volley unfairly.
 */
export function resolveBlastDamage(
  weapon: WeaponDef,
  blasts: BlastPoint[],
  targets: DamageTarget[],
): Map<string, number> {
  const totals = new Map<string, number>();

  for (const blast of blasts) {
    for (const t of targets) {
      const dist = Math.hypot(t.x - blast.x, t.y - blast.y);
      const dmg = computeDamage(
        weapon.damage * blast.damageScale,
        dist,
        blast.radius,
        t.armor,
        { selfHit: t.isShooter },
      );
      if (dmg <= 0) continue;
      totals.set(t.id, (totals.get(t.id) ?? 0) + dmg);
    }
  }

  // Soft cap: multi-blast weapons can't exceed a multiple of base damage
  const enemyCap = Math.round(weapon.damage * (weapon.projectileCount > 1 ? 1.6 : 1.15));
  const selfCap = Math.round(weapon.damage * 0.45);

  for (const [id, total] of totals) {
    const target = targets.find((t) => t.id === id);
    const cap = target?.isShooter ? selfCap : enemyCap;
    totals.set(id, Math.min(total, cap));
  }

  return totals;
}

export function blastsToTerrainOps(blasts: BlastPoint[]) {
  return blasts.map((b) => ({
    kind: "sphere" as const,
    x: b.x,
    y: b.y,
    z: b.z,
    radius: b.radius,
    material: VoxelMaterial.Air,
  }));
}
