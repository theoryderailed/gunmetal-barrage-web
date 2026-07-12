/** Voxel material IDs (0 = empty/air). */
export enum VoxelMaterial {
  Air = 0,
  Dirt = 1,
  Sand = 2,
  Rock = 3,
  Metal = 4,
  Bedrock = 5,
  Grass = 6,
}

export type TurnPhase = "waiting" | "move" | "aim" | "resolving" | "ended";

export type MatchStatus = "lobby" | "playing" | "finished";

export interface Vec2 {
  x: number;
  y: number;
}

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface MatchConfig {
  maxPlayers: number;
  budget: number;
  turnTimeSec: number;
  mapWidth: number;
  mapHeight: number;
  mapDepth: number;
  isPrivate: boolean;
  fillBots: boolean;
  suddenDeathTurns: number;
}

export const DEFAULT_MATCH_CONFIG: MatchConfig = {
  maxPlayers: 4,
  budget: 1000,
  turnTimeSec: 30,
  mapWidth: 192,
  mapHeight: 96,
  mapDepth: 12,
  isPrivate: false,
  fillBots: true,
  suddenDeathTurns: 20,
};

export type TrajectoryType =
  | "ballistic"
  | "lob"
  | "drill"
  | "bounce"
  | "cluster"
  | "homing";

/** Human-readable trajectory family for HUD / testing. */
export type WeaponBehavior =
  | "single"
  | "triple"
  | "cluster"
  | "bounce"
  | "drill"
  | "lob"
  | "homing"
  | "tornado"
  | "special";

export interface WeaponDef {
  id: string;
  name: string;
  /** One-line blurb for HUD */
  summary: string;
  /** How to verify it in sandbox */
  howToTest: string;
  cost: number;
  damage: number;
  blastRadius: number;
  projectileCount: number;
  trajectory: TrajectoryType;
  behavior: WeaponBehavior;
  maxAmmo: number;
  powerMultiplier: number;
  /** RNG weight when rolling loadouts */
  weight: number;
  /** Shell / VFX tint 0xRRGGBB */
  color: number;
  /**
   * Only equipped as secondary (one-shot specials). Never rolled as primary.
   */
  secondaryOnly?: boolean;
  /**
   * Infinite-ammo fallback when primary is empty (Peashooter). Never rolled as
   * primary or secondary — swapped in at fire time only.
   */
  backupOnly?: boolean;
}
export interface ChassisDef {
  id: string;
  name: string;
  cost: number;
  maxHp: number;
  armor: number;
  mobility: number;
  fuel: number;
  size: number;
  weight: number;
}

export interface Loadout {
  seed: number;
  budget: number;
  spent: number;
  chassis: ChassisDef;
  primary: WeaponDef;
  secondary: WeaponDef | null;
  palette: [number, number, number];
  name: string;
}

/** Bot (or flair) identity — makes pilots feel unique. */
export type { BotPersona, TankFlair, PilotIdentity } from "./procgen/identity.js";

export interface PlayerState {
  id: string;
  sessionId: string;
  name: string;
  isBot: boolean;
  ready: boolean;
  loadout: Loadout | null;
  /** Present for bots (and optionally humans later). */
  identity: import("./procgen/identity.js").PilotIdentity | null;
  x: number;
  y: number;
  facing: 1 | -1;
  hp: number;
  fuel: number;
  angle: number;
  power: number;
  primaryAmmo: number;
  secondaryAmmo: number;
  kills: number;
  damageDealt: number;
  alive: boolean;
  /** Elimination order: 1 = winner, higher = out earlier. 0 = still active. */
  place: number;
  /** Last player who damaged this tank (for fall / crater kill credit). */
  lastAttackerId: string | null;
}

export interface TerrainOp {
  kind: "sphere" | "ellipsoid";
  x: number;
  y: number;
  z: number;
  radius: number;
  radiusY?: number;
  radiusZ?: number;
  material: VoxelMaterial;
}

export interface ProjectileState {
  id: string;
  ownerId: string;
  weaponId: string;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  alive: boolean;
}

export interface DamageEvent {
  targetId: string;
  amount: number;
  sourceId: string;
  x: number;
  y: number;
}

export interface MatchResultEntry {
  playerId: string;
  name: string;
  /** 1 = winner */
  place: number;
  kills: number;
  damageDealt: number;
  score: number;
  isWinner: boolean;
  isBot: boolean;
}

export interface LeaderboardEntry {
  name: string;
  wins: number;
  kills: number;
  damage: number;
  matches: number;
  score: number;
}
