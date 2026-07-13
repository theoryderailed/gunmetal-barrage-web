/** Client → server message types */
export const ClientMsg = {
  SetName: "set_name",
  SetReady: "set_ready",
  SelectLoadout: "select_loadout",
  AddBot: "add_bot",
  StartMatch: "start_match",
  Move: "move",
  Aim: "aim",
  Fire: "fire",
  Pass: "pass",
} as const;

/** Server → client message types */
export const ServerMsg = {
  MatchStarted: "match_started",
  TurnStart: "turn_start",
  PlayerMoved: "player_moved",
  PlayerAimed: "player_aimed",
  ProjectileSpawn: "projectile_spawn",
  ProjectileUpdate: "projectile_update",
  TerrainDelta: "terrain_delta",
  Damage: "damage",
  PlayerEliminated: "player_eliminated",
  TurnEnd: "turn_end",
  MatchEnd: "match_end",
  SuddenDeath: "sudden_death",
  Chat: "chat",
  Error: "error",
  /** Full resync after reconnect mid-match */
  Reconnected: "reconnected",
} as const;

export type ClientMsgType = (typeof ClientMsg)[keyof typeof ClientMsg];
export type ServerMsgType = (typeof ServerMsg)[keyof typeof ServerMsg];

export interface MovePayload {
  dir: -1 | 0 | 1;
  /** Client frame delta (seconds) so server moves match local feel */
  dt?: number;
}

export interface AimPayload {
  angle: number;
  power: number;
  facing?: 1 | -1;
}

export interface FirePayload {
  angle: number;
  power: number;
  weaponSlot: "primary" | "secondary";
  facing: 1 | -1;
}

export interface MatchStartedPayload {
  matchSeed: number;
  config: import("./types.js").MatchConfig;
  players: import("./types.js").PlayerState[];
  wind: number;
  /** First pilot to act — used for intro zoom */
  firstPlayerId: string | null;
}

export interface TurnStartPayload {
  playerId: string;
  turnIndex: number;
  wind: number;
  timeSec: number;
  phase: import("./types.js").TurnPhase;
  suddenDeath?: import("./types.js").SuddenDeathState | null;
}

export interface MatchEndPayload {
  rankings: import("./types.js").MatchResultEntry[];
}

export interface SuddenDeathPayload {
  state: import("./types.js").SuddenDeathState;
  /** Optional terrain digs from this SD tick */
  terrainOps?: import("./types.js").TerrainOp[];
  damages?: {
    targetId: string;
    amount: number;
    sourceId: string;
  }[];
  eliminated?: { id: string; reason: string }[];
  message: string;
}

export interface ReconnectedPayload {
  matchSeed: number;
  config: import("./types.js").MatchConfig;
  players: import("./types.js").PlayerState[];
  wind: number;
  turnIndex: number;
  currentPlayerId: string | null;
  phase: import("./types.js").TurnPhase;
  status: string;
  suddenDeath: import("./types.js").SuddenDeathState | null;
}
