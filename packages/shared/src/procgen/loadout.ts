import { createRng, pickWeighted, randInt } from "../rng.js";
import type { ChassisDef, Loadout, WeaponDef } from "../types.js";

export const CHASSIS_POOL: ChassisDef[] = [
  {
    id: "scout",
    name: "Scout Hull",
    cost: 120,
    maxHp: 80,
    armor: 2,
    mobility: 1.4,
    // Longest legs, still not a free map cross
    fuel: 85,
    size: 0.85,
    weight: 3,
  },
  {
    id: "standard",
    name: "Standard Hull",
    cost: 200,
    maxHp: 120,
    armor: 5,
    mobility: 1.0,
    fuel: 70,
    size: 1.0,
    weight: 5,
  },
  {
    id: "heavy",
    name: "Heavy Hull",
    cost: 320,
    maxHp: 180,
    armor: 10,
    mobility: 0.7,
    fuel: 55,
    size: 1.25,
    weight: 4,
  },
  {
    id: "fortress",
    name: "Fortress Hull",
    cost: 420,
    maxHp: 240,
    armor: 14,
    mobility: 0.5,
    fuel: 40,
    size: 1.4,
    weight: 2,
  },
];

/**
 * Primary weapon catalog (sandbox keys 1–7). Mini Nuke is a secondary special.
 */
export const WEAPON_POOL: WeaponDef[] = [
  {
    id: "peashooter",
    name: "Peashooter",
    summary: "Basic single shell. Baseline for aim / wind tests.",
    howToTest: "Hit dummy with one crater. No multi-blast. No bounce.",
    cost: 80,
    damage: 28,
    blastRadius: 3.6,
    projectileCount: 1,
    trajectory: "ballistic",
    behavior: "single",
    maxAmmo: 99,
    powerMultiplier: 1.0,
    weight: 5,
    color: 0xffdd44,
  },
  {
    id: "howitzer",
    name: "Howitzer",
    summary: "High lob arc, medium blast. Slower shell (0.9× power).",
    howToTest: "Same aim as Peashooter should land shorter/higher. Bigger crater.",
    cost: 180,
    damage: 55,
    blastRadius: 5.8,
    projectileCount: 1,
    trajectory: "lob",
    behavior: "lob",
    maxAmmo: 12,
    powerMultiplier: 0.9,
    weight: 4,
    color: 0xff6622,
  },
  {
    id: "scatter",
    name: "Scatter Shot",
    summary: "One shell → submunitions explode around the impact point.",
    howToTest: "One flight path. On hit: several craters clustered near impact, not at your feet.",
    cost: 220,
    damage: 22,
    blastRadius: 3.4,
    projectileCount: 5,
    trajectory: "cluster",
    behavior: "cluster",
    maxAmmo: 8,
    powerMultiplier: 1.0,
    weight: 3,
    color: 0xff22aa,
  },
  {
    id: "bunker_buster",
    name: "Bunker Buster",
    summary: "Drill shell: flatter arc, high damage, deep shaft that collapses cover.",
    howToTest: "Hit a ridge/bunker — tall vertical hole + undercut. Tanks above should drop.",
    cost: 280,
    damage: 78,
    blastRadius: 4.8,
    projectileCount: 1,
    trajectory: "drill",
    behavior: "drill",
    maxAmmo: 5,
    powerMultiplier: 1.05,
    weight: 2,
    color: 0xbb44ff,
  },
  {
    id: "ricochet",
    name: "Ricochet Shell",
    summary: "Bounces up to 2 times before detonating.",
    howToTest: "Aim at a slope/wall — shell should skip, then explode on final contact.",
    cost: 200,
    damage: 40,
    blastRadius: 4.6,
    projectileCount: 1,
    trajectory: "bounce",
    behavior: "bounce",
    maxAmmo: 8,
    powerMultiplier: 1.05,
    weight: 2,
    color: 0x22ffcc,
  },
  {
    id: "heat_seeker",
    name: "Heat Seeker",
    summary: "Homing rocket that steers toward the nearest enemy after launch.",
    howToTest: "Aim roughly at a target — missile should curve toward them mid-flight.",
    cost: 240,
    damage: 48,
    blastRadius: 4.0,
    projectileCount: 1,
    trajectory: "homing",
    behavior: "homing",
    maxAmmo: 6,
    powerMultiplier: 1.0,
    weight: 3,
    color: 0xff3366,
  },
  {
    id: "triple",
    name: "Triple Threat",
    summary: "Three tight shells (±2°). Same range band.",
    howToTest: "Three nearby impact craters in a line near the target — not at the muzzle.",
    cost: 260,
    damage: 30,
    blastRadius: 3.6,
    projectileCount: 3,
    trajectory: "ballistic",
    behavior: "triple",
    maxAmmo: 6,
    powerMultiplier: 1.0,
    weight: 3,
    color: 0xffff00,
  },
];

/**
 * One-shot (or very limited) alternate weapons — only roll as secondary.
 */
export const SECONDARY_SPECIALS: WeaponDef[] = [
  {
    id: "nuke_lite",
    name: "Mini Nuke",
    summary: "Once-per-match panic button. Huge lob blast — use carefully.",
    howToTest: "Equip as alt (R). One shot only. Massive crater + self-splash risk.",
    cost: 160,
    damage: 70,
    blastRadius: 6.8,
    projectileCount: 1,
    trajectory: "lob",
    behavior: "special",
    maxAmmo: 1,
    powerMultiplier: 0.88,
    weight: 4,
    color: 0xff1100,
    secondaryOnly: true,
  },
];

/** Primaries + specials (sandbox catalog). */
export function allWeapons(): WeaponDef[] {
  return [...WEAPON_POOL, ...SECONDARY_SPECIALS];
}

const NAME_PREFIX = [
  "Rusty",
  "Iron",
  "Thunder",
  "Dusty",
  "Crimson",
  "Ghost",
  "Bolt",
  "Siege",
  "Pixel",
  "Neon",
];
const NAME_SUFFIX = [
  "Toad",
  "Badger",
  "Mantis",
  "Hog",
  "Viper",
  "Crab",
  "Wasp",
  "Golem",
  "Scout",
  "Titan",
];

export function getWeaponById(id: string): WeaponDef | undefined {
  return allWeapons().find((w) => w.id === id);
}

/** Sandbox catalog index into primaries + specials. */
export function getWeaponByIndex(index: number): WeaponDef {
  const pool = allWeapons();
  const i = ((index % pool.length) + pool.length) % pool.length;
  return pool[i]!;
}

/** Compact stats line for HUD. */
export function formatWeaponStats(w: WeaponDef): string {
  const ammo =
    w.maxAmmo <= 1 ? "×1" : `×${w.projectileCount}`;
  return `DMG ${w.damage} · BLAST ${w.blastRadius} · ${ammo} · ${w.trajectory.toUpperCase()}`;
}

export function formatWeaponBehavior(w: WeaponDef): string {
  switch (w.behavior) {
    case "single":
      return "1 shell → 1 blast at impact";
    case "lob":
      return "1 high-arc shell → 1 blast";
    case "drill":
      return "1 flatter shell → deep shaft + undercut (drop cover)";
    case "bounce":
      return "1 shell, up to 2 bounces → blast";
    case "cluster":
      return "1 shell → submunitions at impact";
    case "triple":
      return "3 tight shells → 3 nearby blasts";
    case "homing":
      return "1 rocket → steers toward nearest enemy";
    case "special":
      return "ALT only · 1 shot per match · huge blast";
    default:
      return w.summary;
  }
}

/** Fixed test loadout: standard hull + chosen weapon (sandbox). */
export function makeTestLoadout(weapon: WeaponDef, budget = 1000): Loadout {
  const chassis = CHASSIS_POOL.find((c) => c.id === "standard") ?? CHASSIS_POOL[0]!;
  // Specials test as primary in sandbox so you can fire them with Space
  return {
    seed: 0,
    budget,
    spent: chassis.cost + weapon.cost,
    chassis: { ...chassis },
    primary: { ...weapon },
    secondary: null,
    palette: [0.35, 0.75, 0.45],
    name: `Test ${weapon.name}`,
  };
}

/**
 * Generate a tank + weapons loadout within budget. Deterministic for seed.
 * Primary = regular pool. Secondary = often a one-shot special (Mini Nuke) or alt gun.
 */
export function generateLoadout(seed: number, budget: number): Loadout {
  const rng = createRng(seed);

  const chassisCandidates = CHASSIS_POOL.filter((c) => c.cost + 80 <= budget).map(
    (c) => ({ ...c, weight: c.weight }),
  );
  const chassis =
    chassisCandidates.length > 0
      ? pickWeighted(rng, chassisCandidates)
      : CHASSIS_POOL[0]!;

  let remaining = budget - chassis.cost;

  const primaryCandidates = WEAPON_POOL.filter(
    (w) => !w.secondaryOnly && w.cost <= remaining,
  ).map((w) => ({ ...w, weight: w.weight }));
  const primary =
    primaryCandidates.length > 0
      ? pickWeighted(rng, primaryCandidates)
      : WEAPON_POOL[0]!;
  remaining -= primary.cost;

  let secondary: WeaponDef | null = null;
  if (remaining >= 80 && rng() > 0.22) {
    const specials = SECONDARY_SPECIALS.filter((w) => w.cost <= remaining).map(
      (w) => ({ ...w, weight: w.weight }),
    );
    // Bias toward one-shot specials when they fit (~60% of secondary rolls)
    if (specials.length > 0 && rng() < 0.6) {
      secondary = pickWeighted(rng, specials);
      remaining -= secondary.cost;
    } else {
      const secCandidates = WEAPON_POOL.filter(
        (w) => !w.secondaryOnly && w.cost <= remaining && w.id !== primary.id,
      ).map((w) => ({ ...w, weight: w.weight }));
      if (secCandidates.length > 0) {
        secondary = pickWeighted(rng, secCandidates);
        remaining -= secondary.cost;
      } else if (specials.length > 0) {
        secondary = pickWeighted(rng, specials);
        remaining -= secondary.cost;
      }
    }
  }

  const palette: [number, number, number] = [
    0.2 + rng() * 0.7,
    0.2 + rng() * 0.7,
    0.2 + rng() * 0.7,
  ];

  const name = `${NAME_PREFIX[randInt(rng, 0, NAME_PREFIX.length - 1)]} ${NAME_SUFFIX[randInt(rng, 0, NAME_SUFFIX.length - 1)]}`;

  return {
    seed,
    budget,
    spent: budget - remaining,
    chassis: { ...chassis },
    primary: { ...primary },
    secondary: secondary ? { ...secondary } : null,
    palette,
    name,
  };
}
