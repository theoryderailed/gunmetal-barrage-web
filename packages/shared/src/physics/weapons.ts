import { createRng, hashSeed } from "../rng.js";
import { VoxelMaterial, type TerrainOp, type WeaponDef } from "../types.js";
import { isSolid, type VoxelWorld } from "../voxels.js";
import {
  computeDamage,
  muzzleOrigin,
  simulateBallistic,
  simulateHoming,
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
  /** Enemy positions for homing weapons (exclude the shooter). */
  seekTargets?: { x: number; y: number }[];
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

  // Homing rocket — steers toward nearest seek target after launch
  if (weapon.trajectory === "homing") {
    const impact = simulateHoming(
      world,
      {
        origin,
        angleDeg: input.angleDeg,
        power: input.power,
        facing: input.facing,
        wind: input.wind,
        weapon,
      },
      input.seekTargets ?? [],
    );
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
 * Tornado weapons deal no impact damage — HP comes from the toss only.
 */
export function resolveBlastDamage(
  weapon: WeaponDef,
  blasts: BlastPoint[],
  targets: DamageTarget[],
): Map<string, number> {
  const totals = new Map<string, number>();
  if (isTornadoWeapon(weapon)) return totals;

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

/**
 * Terrain craters are intentionally larger than damage radius so maps
 * reshape more like classic artillery (Worms / Gunbound).
 */
export const TERRAIN_BLAST_SCALE = 1.45;

export function isTornadoWeapon(
  weapon?: Pick<WeaponDef, "trajectory" | "behavior" | "id"> | null,
): boolean {
  return (
    weapon?.behavior === "tornado" ||
    weapon?.id === "dust_devil"
  );
}

/**
 * Convert blasts to terrain stamps.
 * Drill (Bunker Buster): deep shaft + undercut to strip cover and drop tanks.
 * Dust Devil: almost no dig — tornado flings tanks, doesn't excavate the map.
 */
export function blastsToTerrainOps(
  blasts: BlastPoint[],
  weapon?: Pick<WeaponDef, "trajectory" | "behavior" | "id">,
) {
  const isDrill =
    weapon?.trajectory === "drill" ||
    weapon?.behavior === "drill" ||
    weapon?.id === "bunker_buster";

  if (isDrill) {
    return drillTerrainOps(blasts);
  }

  if (isTornadoWeapon(weapon)) {
    return tornadoTerrainOps(blasts);
  }

  return blasts.map((b) => {
    const radius = Math.max(2.2, b.radius * TERRAIN_BLAST_SCALE);
    // Sink the stamp slightly so more ground under the impact is scooped out
    const dig = radius * 0.22;
    return {
      kind: "sphere" as const,
      x: b.x,
      y: b.y - dig,
      z: b.z,
      radius,
      material: VoxelMaterial.Air,
    };
  });
}

/**
 * Dust Devil terrain: tiny surface scuff only.
 * Real damage is knockback (resolveTornadoThrows), not craters.
 */
function tornadoTerrainOps(blasts: BlastPoint[]): TerrainOp[] {
  return blasts.map((b) => ({
    kind: "sphere" as const,
    // Slightly above impact so we barely nick grass/dust, not carve a pit
    x: b.x,
    y: b.y + 0.4,
    z: b.z,
    radius: 1.35,
    material: VoxelMaterial.Air,
  }));
}

export interface TornadoTarget {
  id: string;
  x: number;
  y: number;
  /** Shooter can still be flung (self-risk). */
  isShooter?: boolean;
}

export interface TornadoThrowResult {
  id: string;
  x: number;
  y: number;
  /** HP loss from fling + wall smash / hard landing. */
  tossDamage: number;
  /** True if path ends in open sky (caller should eliminate as fall). */
  intoVoid: boolean;
  /** Hit a solid wall/cliff mid-flight (digs terrain). */
  hitTerrain: boolean;
  /** Horizontal fling: left (−1) or right (+1). Independent of blast center. */
  dir: -1 | 1;
  /** Horizontal distance actually traveled. */
  distance: number;
  /** Peak loft above start height. */
  loft: number;
  /** Combined fling magnitude (for pick-strongest + UI). */
  impulse: number;
  /** Craters carved when the body smashes into dirt. */
  digOps: TerrainOp[];
}

export interface TornadoThrowBatch {
  throws: TornadoThrowResult[];
  /** All collision digs (apply to world + broadcast). */
  terrainOps: TerrainOp[];
}

/**
 * Fling tanks with a random ballistic toss (left/right + up).
 * Steps the path so bodies don't phase through islands — mid-air hits dig
 * a crater, deal smash damage, and stop short of clipping through.
 */
export function resolveTornadoThrows(
  world: VoxelWorld,
  blasts: BlastPoint[],
  targets: TornadoTarget[],
  midZ: number,
  weapon?: Pick<WeaponDef, "damage" | "blastRadius" | "id">,
): TornadoThrowBatch {
  if (blasts.length === 0 || targets.length === 0) {
    return { throws: [], terrainOps: [] };
  }

  const throwRadius = Math.max(9, (weapon?.blastRadius ?? 5.2) * 1.75);
  const baseDmg = weapon?.damage ?? 34;
  const byId = new Map<string, TornadoThrowResult>();
  const terrainOps: TerrainOp[] = [];
  const z0 = Math.max(0, Math.min(world.depth - 1, Math.floor(midZ)));

  for (const blast of blasts) {
    for (const t of targets) {
      const dist = Math.hypot(t.x - blast.x, t.y - blast.y);
      if (dist > throwRadius) continue;

      const rng = createRng(
        hashSeed(
          "tornado",
          weapon?.id ?? "dust_devil",
          Math.round(blast.x * 10),
          Math.round(blast.y * 10),
          t.id,
        ),
      );

      const proximity = 1 - dist / throwRadius;
      const dir: -1 | 1 = rng() < 0.5 ? -1 : 1;

      // Launch speeds — random horizontal + upward (chaotic, not away-from-blast)
      const hSpeed = (7 + proximity * 7 + rng() * 7) * (0.9 + rng() * 0.25);
      const vSpeed = 9 + proximity * 9 + rng() * 10;
      const impulse = Math.hypot(hSpeed, vSpeed);

      const sim = simulateTankToss(world, {
        x: t.x,
        y: t.y,
        z: z0,
        vx: dir * hSpeed,
        vy: vSpeed,
        dir,
      });

      // Base fling damage + bonus for smashing into a wall or hard fall
      let tossDamage = Math.max(
        10,
        Math.round(baseDmg * (0.45 + proximity * 0.5) + impulse * 0.35),
      );
      if (sim.hitTerrain) {
        tossDamage += Math.round(
          12 + impulse * 0.25 + Math.min(18, sim.impactSpeed * 0.35),
        );
      }
      if (sim.fallDrop > 3) {
        tossDamage += Math.round(Math.min(20, (sim.fallDrop - 3) * 1.4));
      }
      tossDamage = Math.min(72, tossDamage);

      const next: TornadoThrowResult = {
        id: t.id,
        x: sim.x,
        y: sim.y,
        tossDamage,
        intoVoid: sim.intoVoid,
        hitTerrain: sim.hitTerrain,
        dir,
        distance: Math.abs(sim.x - t.x),
        loft: sim.peakLoft,
        impulse,
        digOps: sim.digOps,
      };
      const prev = byId.get(t.id);
      if (!prev || next.impulse > prev.impulse) {
        // If replacing a previous toss, drop its digs from the batch list
        if (prev) {
          for (const op of prev.digOps) {
            const idx = terrainOps.indexOf(op);
            if (idx >= 0) terrainOps.splice(idx, 1);
          }
        }
        byId.set(t.id, next);
        for (const op of next.digOps) terrainOps.push(op);
      }
    }
  }

  // Stamp collision digs into the live world so later tanks hit open path
  for (const op of terrainOps) {
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
  }

  return { throws: [...byId.values()], terrainOps };
}

interface TossSim {
  x: number;
  y: number;
  intoVoid: boolean;
  hitTerrain: boolean;
  peakLoft: number;
  fallDrop: number;
  impactSpeed: number;
  digOps: TerrainOp[];
}

/**
 * Integrate a tank body through the air. Collides with solid voxels mid-flight
 * (no phasing through islands). On hit: dig a smash crater and stop.
 */
function simulateTankToss(
  world: VoxelWorld,
  opts: {
    x: number;
    y: number;
    z: number;
    vx: number;
    vy: number;
    dir: -1 | 1;
  },
): TossSim {
  const g = 28;
  const dt = 0.04;
  const maxT = 2.4;
  const maxHoriz = 26;
  const bodyR = 0.55;
  let x = opts.x;
  let y = opts.y + 1.05;
  let vx = opts.vx;
  let vy = opts.vy;
  let peakY = y;
  const startY = y;
  const startX = opts.x;
  const digOps: TerrainOp[] = [];
  let impactSpeed = 0;

  const solidAt = (px: number, py: number): boolean => {
    const ix = Math.floor(px);
    const iy = Math.floor(py);
    if (!world.inBounds(ix, iy, opts.z)) return false;
    return isSolid(world.get(ix, iy, opts.z));
  };

  // Clear of own starting footprint briefly
  const freeUntil = 0.12;

  for (let t = 0; t < maxT; t += dt) {
    const nx = x + vx * dt;
    const ny = y + vy * dt;
    const nvy = vy - g * dt;

    // Sub-step the segment for reliable collision
    const sub = 4;
    let cx = x;
    let cy = y;
    let blocked = false;
    for (let s = 1; s <= sub; s++) {
      const u = s / sub;
      const sx = x + (nx - x) * u;
      const sy = y + (ny - y) * u;

      if (sx < 1 || sx > world.width - 2) {
        cx = Math.max(1.5, Math.min(world.width - 2.5, sx));
        cy = sy;
        blocked = true;
        impactSpeed = Math.hypot(vx, vy);
        digOps.push({
          kind: "sphere",
          x: cx,
          y: cy,
          z: opts.z,
          radius: 2.0,
          material: VoxelMaterial.Air,
        });
        break;
      }

      // Sample a few points on the body (center + lower hull)
      const samples = [
        [sx, sy],
        [sx, sy - bodyR * 0.7],
        [sx + opts.dir * bodyR * 0.5, sy],
        [sx - opts.dir * bodyR * 0.35, sy - bodyR * 0.3],
      ] as const;

      let hit = false;
      for (const [hx, hy] of samples) {
        if (solidAt(hx, hy)) {
          hit = true;
          break;
        }
      }

      // Don't collide with the ground column we launched from in the first frames
      if (hit && (t > freeUntil || Math.hypot(sx - opts.x, sy - startY) > 1.8)) {
        const surface = world.sampleGroundY(sx, opts.z);
        // Soft landing on top of terrain (falling onto a roof) — no smash dig
        if (
          surface >= 0 &&
          nvy <= 1.5 &&
          sy <= surface + 1.35 &&
          sy >= surface - 0.2
        ) {
          return {
            x: Math.max(1.5, Math.min(world.width - 2.5, sx)),
            y: surface,
            intoVoid: false,
            hitTerrain: false,
            peakLoft: Math.max(peakY, sy) - startY,
            fallDrop: Math.max(0, Math.max(peakY, sy) - surface),
            impactSpeed: Math.abs(nvy),
            digOps,
          };
        }

        // Wall / cliff / underside smash — dig and stop
        cx = sx - opts.dir * 0.35;
        cy = sy + 0.25;
        blocked = true;
        impactSpeed = Math.hypot(vx, nvy);
        const smashR = Math.min(2.8, 1.5 + Math.min(22, impactSpeed) * 0.05);
        digOps.push({
          kind: "sphere",
          x: sx,
          y: sy - 0.2,
          z: opts.z,
          radius: smashR,
          material: VoxelMaterial.Air,
        });
        digOps.push({
          kind: "sphere",
          x: sx + opts.dir * smashR * 0.4,
          y: sy - 0.35,
          z: opts.z,
          radius: smashR * 0.65,
          material: VoxelMaterial.Air,
        });
        break;
      }

      cx = sx;
      cy = sy;
    }

    x = cx;
    y = cy;
    if (y > peakY) peakY = y;

    if (blocked) {
      const ground = world.sampleGroundY(x, opts.z);
      if (ground < 0) {
        return {
          x,
          y: -6,
          intoVoid: true,
          hitTerrain: true,
          peakLoft: peakY - startY,
          fallDrop: peakY + 6,
          impactSpeed,
          digOps,
        };
      }
      return {
        x: Math.max(1.5, Math.min(world.width - 2.5, x)),
        y: ground,
        intoVoid: false,
        hitTerrain: true,
        peakLoft: peakY - startY,
        fallDrop: Math.max(0, peakY - ground),
        impactSpeed,
        digOps,
      };
    }

    vy = nvy;

    // Soft land on top of terrain while falling
    const ground = world.sampleGroundY(x, opts.z);
    if (ground >= 0 && vy <= 0 && y <= ground + 0.45 && t > freeUntil) {
      return {
        x: Math.max(1.5, Math.min(world.width - 2.5, x)),
        y: ground,
        intoVoid: false,
        hitTerrain: false,
        peakLoft: peakY - startY,
        fallDrop: Math.max(0, peakY - ground),
        impactSpeed: Math.abs(vy),
        digOps,
      };
    }

    // Cap runaway horizontal flings on open flats
    if (Math.abs(x - startX) >= maxHoriz && vy <= 0) {
      const g2 = world.sampleGroundY(x, opts.z);
      if (g2 < 0) {
        return {
          x,
          y: -6,
          intoVoid: true,
          hitTerrain: false,
          peakLoft: peakY - startY,
          fallDrop: peakY + 6,
          impactSpeed: Math.abs(vy),
          digOps,
        };
      }
      return {
        x: Math.max(1.5, Math.min(world.width - 2.5, x)),
        y: g2,
        intoVoid: false,
        hitTerrain: false,
        peakLoft: peakY - startY,
        fallDrop: Math.max(0, peakY - g2),
        impactSpeed: Math.abs(vy),
        digOps,
      };
    }

    // Fell off the world
    if (y < -2 || (ground < 0 && y < 2 && vy < 0 && t > 0.35)) {
      return {
        x: Math.max(1.5, Math.min(world.width - 2.5, x)),
        y: -6,
        intoVoid: true,
        hitTerrain: false,
        peakLoft: peakY - startY,
        fallDrop: peakY + 6,
        impactSpeed: Math.abs(vy),
        digOps,
      };
    }
  }

  // Timeout: snap to ground under final x
  const ground = world.sampleGroundY(x, opts.z);
  if (ground < 0) {
    return {
      x,
      y: -6,
      intoVoid: true,
      hitTerrain: false,
      peakLoft: peakY - startY,
      fallDrop: peakY + 6,
      impactSpeed: Math.abs(vy),
      digOps,
    };
  }
  return {
    x: Math.max(1.5, Math.min(world.width - 2.5, x)),
    y: ground,
    intoVoid: false,
    hitTerrain: false,
    peakLoft: peakY - startY,
    fallDrop: Math.max(0, peakY - ground),
    impactSpeed: Math.abs(vy),
    digOps,
  };
}

/**
 * Bunker Buster terrain: narrow mouth, deep vertical shaft, modest undercut.
 * Deeper than a normal shell of the same blast radius, but not Mini-Nuke wide.
 */
function drillTerrainOps(blasts: BlastPoint[]) {
  const ops: {
    kind: "sphere" | "ellipsoid";
    x: number;
    y: number;
    z: number;
    radius: number;
    radiusY?: number;
    radiusZ?: number;
    material: VoxelMaterial;
  }[] = [];

  for (const b of blasts) {
    // Tight surface punch (slightly larger than raw blast for dig, not a crater lake)
    const mouthR = Math.max(2.5, b.radius * 1.05);
    // Depth stays "above average" even with a small blast radius
    const depth = Math.max(13, b.radius * 4.6 + 4);
    const shaftRx = Math.max(1.85, b.radius * 0.72);
    const shaftRz = Math.max(1.6, b.radius * 0.58);
    // Undercut enough to drop cover, not erase the hillside
    const undercutR = Math.max(3.0, b.radius * 1.35);

    // 1) Surface mouth — open the roof of cover
    ops.push({
      kind: "sphere",
      x: b.x,
      y: b.y - mouthR * 0.12,
      z: b.z,
      radius: mouthR,
      material: VoxelMaterial.Air,
    });

    // 2) Deep vertical shaft (tall, relatively thin ellipsoid)
    const shaftCy = b.y - depth * 0.5;
    ops.push({
      kind: "ellipsoid",
      x: b.x,
      y: shaftCy,
      z: b.z,
      radius: shaftRx,
      radiusY: depth * 0.52,
      radiusZ: shaftRz,
      material: VoxelMaterial.Air,
    });

    // 3) Bottom undercut — hollow footing so the ledge can drop
    ops.push({
      kind: "sphere",
      x: b.x,
      y: b.y - depth + undercutR * 0.3,
      z: b.z,
      radius: undercutR,
      material: VoxelMaterial.Air,
    });
  }

  return ops;
}
