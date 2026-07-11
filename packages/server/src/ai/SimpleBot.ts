import {
  clampAngle,
  clampPower,
  previewTrajectory,
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
 */
export function botAct(sim: MatchSimulation): BotAction {
  const self = sim.currentPlayer();
  if (!self || !self.loadout) {
    return { moveDir: 0, angle: 45, power: 50, facing: 1, weaponSlot: "primary" };
  }

  const persona: BotPersona = self.identity?.persona ?? "artillery";
  const skill = self.identity?.skill ?? 0.5;

  const enemies = sim
    .getPlayerList()
    .filter((p) => p.alive && p.id !== self.id);
  const target =
    enemies.sort(
      (a, b) => Math.abs(a.x - self.x) - Math.abs(b.x - self.x),
    )[0] ?? null;

  const moveDir = pickMove(self, target, persona);
  const facing: 1 | -1 = target
    ? target.x >= self.x
      ? 1
      : -1
    : self.facing;

  const weaponSlot = pickWeapon(self, persona);

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

function pickMove(
  self: PlayerState,
  target: PlayerState | null,
  persona: BotPersona,
): -1 | 0 | 1 {
  if (!target) return 0;
  const dx = target.x - self.x;
  const dist = Math.abs(dx);

  switch (persona) {
    case "camper":
      // Rarely move; only if very exposed (close)
      if (dist < 10) return dx > 0 ? -1 : 1;
      return Math.random() < 0.15 ? (dx > 0 ? 1 : -1) : 0;
    case "brawler":
      if (dist > 12) return dx > 0 ? 1 : -1;
      if (dist < 6) return dx > 0 ? -1 : 1;
      return dx > 0 ? 1 : -1;
    case "sniper":
      if (dist < 25) return dx > 0 ? -1 : 1;
      return Math.random() < 0.2 ? (dx > 0 ? 1 : -1) : 0;
    case "reckless":
      if (dist > 14) return dx > 0 ? 1 : -1;
      return Math.random() < 0.5 ? (dx > 0 ? 1 : -1) : 0;
    case "chaotic":
      return ([-1, 0, 0, 1] as const)[Math.floor(Math.random() * 4)]!;
    case "artillery":
    default:
      if (dist > 22) return dx > 0 ? 1 : -1;
      if (dist < 10) return dx > 0 ? -1 : 1;
      return 0;
  }
}

function pickWeapon(
  self: PlayerState,
  persona: BotPersona,
): "primary" | "secondary" {
  if (!self.loadout?.secondary || self.secondaryAmmo <= 0) return "primary";
  const sec = self.loadout.secondary;
  // Prefer secondary when it matches persona fantasy
  if (persona === "reckless" && sec.blastRadius >= 4 && self.secondaryAmmo > 0) {
    return Math.random() < 0.55 ? "secondary" : "primary";
  }
  if (persona === "artillery" && sec.trajectory === "lob") {
    return Math.random() < 0.45 ? "secondary" : "primary";
  }
  if (persona === "chaotic") {
    return Math.random() < 0.4 ? "secondary" : "primary";
  }
  return Math.random() < 0.2 ? "secondary" : "primary";
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

  // Persona aim preferences
  let angleMin = 12;
  let angleMax = 168;
  let powerMin = 18;
  let powerMax = 100;
  let stepA = 5;
  let stepP = 5;

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
      stepA = 3;
      stepP = 3;
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

  for (let angle = angleMin; angle <= angleMax; angle += stepA) {
    for (let power = powerMin; power <= powerMax; power += stepP) {
      const pts = previewTrajectory(world, {
        origin,
        angleDeg: angle,
        power,
        facing,
        wind,
        weapon,
      });
      const last = pts[pts.length - 1];
      if (!last) continue;
      let dist = Math.hypot(last.x - target.x, last.y - target.y);

      // Prefer not to detonate on ourselves (except reckless)
      const selfDist = Math.hypot(last.x - self.x, last.y - self.y);
      if (persona !== "reckless" && selfDist < weapon.blastRadius + 2) {
        dist += 40;
      }
      // Reckless likes big power
      if (persona === "reckless") dist -= power * 0.02;
      // Artillery likes higher arcs
      if (persona === "artillery" && angle > 50 && angle < 130) dist -= 1.5;

      const score = dist + Math.abs(power - 55) * (0.03 * (1 - skill));
      if (score < best.score) {
        best = { angle, power, score };
      }
    }
  }

  // Skill: lower skill → more aim noise
  const noiseA = (1 - skill) * 14 + (persona === "chaotic" ? 10 : 0);
  const noiseP = (1 - skill) * 18 + (persona === "chaotic" ? 12 : 0);

  return {
    angle: clampAngle(best.angle + (Math.random() * 2 - 1) * noiseA),
    power: clampPower(best.power + (Math.random() * 2 - 1) * noiseP),
  };
}

/** Thinking delay ms — snipers ponder, reckless snaps. */
export function botThinkDelayMs(persona: BotPersona | undefined): number {
  switch (persona) {
    case "sniper":
      return 1200 + Math.random() * 1000;
    case "camper":
      return 1000 + Math.random() * 900;
    case "artillery":
      return 900 + Math.random() * 800;
    case "reckless":
      return 400 + Math.random() * 400;
    case "chaotic":
      return 300 + Math.random() * 1200;
    case "brawler":
      return 500 + Math.random() * 600;
    default:
      return 700 + Math.random() * 900;
  }
}
