import {
  clampAngle,
  clampPower,
  previewTrajectory,
  type BotDifficulty,
  type BotPersona,
  type PlayerState,
  type VoxelWorld,
} from "@gunmetal-barrage/shared";
import type { MatchSimulation } from "../sim/MatchSimulation.js";

export interface BotAction {
  moveDir: -1 | 0 | 1;
  angle: number;
  power: number;
  facing: 1 | -1;
  weaponSlot: "primary" | "secondary";
}

/**
 * Persona-aware heuristic bot. Same action API as humans.
 * Difficulty scales aim noise, think delay, and movement caution.
 */
export function botAct(
  sim: MatchSimulation,
  difficulty: BotDifficulty = "normal",
): BotAction {
  const self = sim.currentPlayer();
  if (!self || !self.loadout) {
    return { moveDir: 0, angle: 45, power: 50, facing: 1, weaponSlot: "primary" };
  }

  const persona: BotPersona = self.identity?.persona ?? "artillery";
  const skill = effectiveSkill(self.identity?.skill ?? 0.5, difficulty);

  const enemies = sim
    .getPlayerList()
    .filter((p) => p.alive && p.id !== self.id);
  const target =
    enemies.sort(
      (a, b) => Math.abs(a.x - self.x) - Math.abs(b.x - self.x),
    )[0] ?? null;

  const midZ = Math.floor(sim.world.depth / 2);
  const moveDir = pickMove(sim.world, self, target, persona, midZ, skill);
  const facing: 1 | -1 = target
    ? target.x >= self.x
      ? 1
      : -1
    : self.facing;

  const weaponSlot = pickWeapon(self, persona, skill);

  const weapon =
    weaponSlot === "secondary" && self.loadout.secondary
      ? self.loadout.secondary
      : self.loadout.primary;

  const solution = findAim(
    sim.world,
    self,
    target,
    facing,
    sim.wind,
    weapon,
    persona,
    skill,
  );

  return {
    moveDir,
    angle: solution.angle,
    power: solution.power,
    facing,
    weaponSlot,
  };
}

function effectiveSkill(base: number, difficulty: BotDifficulty): number {
  switch (difficulty) {
    case "easy":
      return Math.min(0.32, base * 0.45 + 0.05);
    case "hard":
      return Math.min(1, Math.max(0.78, base * 1.15 + 0.22));
    default:
      return Math.min(1, Math.max(0.35, base));
  }
}

/**
 * Prefer solid ground. Avoid walking into void / thin island edges when skill is high.
 */
function isSafeStep(
  world: VoxelWorld,
  x: number,
  midZ: number,
): boolean {
  if (world.isVoidColumn(x, midZ)) return false;
  const g = world.sampleGroundY(x, midZ);
  if (g < 0) return false;
  // Peek one unit further so we don't step onto a one-voxel ledge over the void
  const g2 = world.sampleGroundY(x + (x >= 0 ? 0.6 : -0.6), midZ);
  if (g2 < 0 || world.isVoidColumn(x + 0.8, midZ) || world.isVoidColumn(x - 0.8, midZ)) {
    // Allow if current column is solid enough
    return g >= 2;
  }
  return true;
}

function pickMove(
  world: VoxelWorld,
  self: PlayerState,
  target: PlayerState | null,
  persona: BotPersona,
  midZ: number,
  skill: number,
): -1 | 0 | 1 {
  if (!target) return 0;
  const dx = target.x - self.x;
  const dist = Math.abs(dx);

  let desired: -1 | 0 | 1 = 0;
  switch (persona) {
    case "camper":
      if (dist < 10) desired = dx > 0 ? -1 : 1;
      else desired = Math.random() < 0.15 ? (dx > 0 ? 1 : -1) : 0;
      break;
    case "brawler":
      if (dist > 12) desired = dx > 0 ? 1 : -1;
      else if (dist < 6) desired = dx > 0 ? -1 : 1;
      else desired = dx > 0 ? 1 : -1;
      break;
    case "sniper":
      if (dist < 25) desired = dx > 0 ? -1 : 1;
      else desired = Math.random() < 0.2 ? (dx > 0 ? 1 : -1) : 0;
      break;
    case "reckless":
      if (dist > 14) desired = dx > 0 ? 1 : -1;
      else desired = Math.random() < 0.5 ? (dx > 0 ? 1 : -1) : 0;
      break;
    case "chaotic":
      desired = ([-1, 0, 0, 1] as const)[Math.floor(Math.random() * 4)]!;
      break;
    case "artillery":
    default:
      if (dist > 22) desired = dx > 0 ? 1 : -1;
      else if (dist < 10) desired = dx > 0 ? -1 : 1;
      else desired = 0;
      break;
  }

  if (desired === 0) return 0;

  // Probe a few units ahead for void / island edge
  const step = desired * (2.5 + skill * 2);
  const probeX = self.x + step;
  const safe = isSafeStep(world, probeX, midZ);
  // Also check intermediate point
  const midSafe = isSafeStep(world, self.x + desired * 1.2, midZ);

  if (!safe || !midSafe) {
    // Reckless / chaotic may still risk it on easy skill
    if (persona === "reckless" && skill < 0.5 && Math.random() < 0.35) {
      return desired;
    }
    // Try reverse if that looks safer (retreat from cliff)
    const reverse: -1 | 0 | 1 = desired === 1 ? -1 : 1;
    if (isSafeStep(world, self.x + reverse * 2.5, midZ)) {
      // Only reverse if we're near a void underfoot or target is away
      if (
        world.isVoidColumn(self.x + desired * 1.5, midZ) ||
        world.sampleGroundY(self.x + desired * 1.5, midZ) < 0
      ) {
        return reverse;
      }
    }
    // Stand still rather than walk into the void
    return 0;
  }

  // High skill: if current footing is thin, prefer not advancing further out
  if (skill > 0.7) {
    const under = world.sampleGroundY(self.x, midZ);
    const ahead = world.sampleGroundY(self.x + desired * 3, midZ);
    if (under >= 0 && ahead >= 0 && Math.abs(ahead - under) > 10) {
      // Big drop ahead — snipers/campers hold; brawlers still push sometimes
      if (persona === "sniper" || persona === "camper" || persona === "artillery") {
        return 0;
      }
    }
  }

  return desired;
}

function pickWeapon(
  self: PlayerState,
  persona: BotPersona,
  skill: number,
): "primary" | "secondary" {
  const canSecondary =
    !!self.loadout?.secondary && (self.secondaryAmmo ?? 0) > 0;

  if (!canSecondary) return "primary";

  const sec = self.loadout!.secondary!;
  // One-shot specials (Mini Nuke): use when it could decide the fight
  if (sec.secondaryOnly || sec.id === "nuke_lite") {
    const hpRatio = self.hp / Math.max(1, self.loadout!.chassis.maxHp);
    if (persona === "reckless") return Math.random() < 0.65 ? "secondary" : "primary";
    if (hpRatio < 0.4) return Math.random() < 0.7 + skill * 0.15 ? "secondary" : "primary";
    return Math.random() < 0.2 + skill * 0.1 ? "secondary" : "primary";
  }
  if (persona === "reckless" && sec.blastRadius >= 4) {
    return Math.random() < 0.55 ? "secondary" : "primary";
  }
  if (persona === "artillery" && sec.trajectory === "lob") {
    return Math.random() < 0.45 ? "secondary" : "primary";
  }
  if (persona === "chaotic") {
    return Math.random() < 0.4 ? "secondary" : "primary";
  }
  return Math.random() < 0.15 + skill * 0.12 ? "secondary" : "primary";
}

function findAim(
  world: VoxelWorld,
  self: PlayerState,
  target: PlayerState | null,
  facing: 1 | -1,
  wind: number,
  weapon: NonNullable<PlayerState["loadout"]>["primary"],
  persona: BotPersona,
  skill: number,
): { angle: number; power: number } {
  if (!target) {
    return { angle: 50, power: 55 };
  }

  const origin = {
    x: self.x + facing * 1.2,
    y: self.y + 1.0,
    z: Math.floor(world.depth / 2) + 0.5,
  };

  let angleMin = 12;
  let angleMax = 168;
  let powerMin = 18;
  let powerMax = 100;
  // Finer grid at higher skill
  let stepA = skill > 0.75 ? 3 : skill > 0.45 ? 5 : 8;
  let stepP = skill > 0.75 ? 3 : skill > 0.45 ? 5 : 10;

  switch (persona) {
    case "artillery":
      angleMin = 40;
      angleMax = 140;
      powerMin = 30;
      break;
    case "brawler":
      angleMin = 10;
      angleMax = 70;
      powerMin = 25;
      powerMax = 85;
      break;
    case "sniper":
      stepA = Math.min(stepA, 3);
      stepP = Math.min(stepP, 3);
      break;
    case "reckless":
      powerMin = 55;
      powerMax = 100;
      break;
    case "camper":
      angleMin = 35;
      angleMax = 130;
      break;
    case "chaotic":
      stepA = 8;
      stepP = 10;
      break;
  }

  let best = { angle: 45, power: 50, score: Infinity };

  if (weapon.trajectory === "homing") {
    const dx = target.x - self.x;
    const dy = target.y - self.y;
    const dist = Math.hypot(dx, dy);
    const baseAngle = clampAngle(
      (Math.atan2(Math.max(4, dy + dist * 0.15), Math.abs(dx) + 0.01) * 180) /
        Math.PI,
    );
    const basePower = clampPower(35 + dist * 0.55);
    return {
      angle: clampAngle(baseAngle + (Math.random() * 2 - 1) * (1 - skill) * 10),
      power: clampPower(basePower + (Math.random() * 2 - 1) * (1 - skill) * 12),
    };
  }

  for (let angle = angleMin; angle <= angleMax; angle += stepA) {
    for (let power = powerMin; power <= powerMax; power += stepP) {
      let pts;
      try {
        pts = previewTrajectory(world, {
          origin,
          angleDeg: angle,
          power,
          facing,
          wind,
          weapon,
        });
      } catch {
        continue;
      }
      const last = pts[pts.length - 1];
      if (!last) continue;
      let dist = Math.hypot(last.x - target.x, last.y - target.y);

      const selfDist = Math.hypot(last.x - self.x, last.y - self.y);
      if (persona !== "reckless" && selfDist < weapon.blastRadius + 2) {
        dist += 40;
      }
      if (persona === "reckless") dist -= power * 0.02;
      if (persona === "artillery" && angle > 50 && angle < 130) dist -= 1.5;

      const score = dist + Math.abs(power - 55) * (0.03 * (1 - skill));
      if (score < best.score) {
        best = { angle, power, score };
      }
    }
  }

  const noiseA = (1 - skill) * 14 + (persona === "chaotic" ? 10 : 0);
  const noiseP = (1 - skill) * 18 + (persona === "chaotic" ? 12 : 0);

  return {
    angle: clampAngle(best.angle + (Math.random() * 2 - 1) * noiseA),
    power: clampPower(best.power + (Math.random() * 2 - 1) * noiseP),
  };
}

/** Thinking delay ms — snipers ponder, reckless snaps; difficulty scales. */
export function botThinkDelayMs(
  persona: BotPersona | undefined,
  difficulty: BotDifficulty = "normal",
): number {
  let base: number;
  switch (persona) {
    case "sniper":
      base = 1200 + Math.random() * 1000;
      break;
    case "camper":
      base = 1000 + Math.random() * 900;
      break;
    case "artillery":
      base = 900 + Math.random() * 800;
      break;
    case "reckless":
      base = 400 + Math.random() * 400;
      break;
    case "chaotic":
      base = 300 + Math.random() * 1200;
      break;
    case "brawler":
      base = 500 + Math.random() * 600;
      break;
    default:
      base = 700 + Math.random() * 900;
  }
  switch (difficulty) {
    case "easy":
      return base * 0.75 + 200;
    case "hard":
      return base * 0.55 + 150;
    default:
      return base;
  }
}
