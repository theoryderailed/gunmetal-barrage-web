import { Client, Room } from "colyseus.js";
import {
  ClientMsg,
  ServerMsg,
  type AimPayload,
  type FirePayload,
  type Loadout,
  type MatchConfig,
  type MatchEndPayload,
  type MatchStartedPayload,
  type MovePayload,
  type PlayerState,
  type ReconnectedPayload,
  type SuddenDeathPayload,
  type TerrainOp,
  type TurnStartPayload,
} from "@gunmetal-barrage/shared";

/**
 * WebSocket endpoint for Colyseus.
 * - VITE_SERVER_URL: explicit override (dev split deploy / debugging)
 * - production build: same-origin (ws/wss) — Railway serves client + server together
 * - local Vite dev: Colyseus on :2567
 */
function resolveDefaultWs(): string {
  if (import.meta.env.VITE_SERVER_URL) {
    return import.meta.env.VITE_SERVER_URL;
  }
  if (import.meta.env.PROD) {
    const proto = location.protocol === "https:" ? "wss:" : "ws:";
    return `${proto}//${location.host}`;
  }
  return `ws://${location.hostname}:2567`;
}

const DEFAULT_WS = resolveDefaultWs();

const PLAYER_ID_KEY = "tdw-player-id";

/** Stable pilot id across tab refresh / mid-match reconnect. */
export function getStablePlayerId(): string {
  try {
    let id = localStorage.getItem(PLAYER_ID_KEY);
    if (!id) {
      id =
        typeof crypto !== "undefined" && "randomUUID" in crypto
          ? `h-${crypto.randomUUID()}`
          : `h-${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
      localStorage.setItem(PLAYER_ID_KEY, id);
    }
    return id.slice(0, 48);
  } catch {
    return `h-session-${Date.now().toString(36)}`;
  }
}

export interface LoadoutPreview {
  tankName: string;
  chassisName: string;
  primaryName: string;
  secondaryName: string | null;
  hp: number;
  armor: number;
  fuel: number;
}

export interface LobbyPlayer {
  id: string;
  name: string;
  ready: boolean;
  isBot: boolean;
  isHost: boolean;
  title?: string | null;
  persona?: string | null;
  motto?: string | null;
  loadoutPreview?: LoadoutPreview | null;
  selectedLoadoutIndex?: number;
}

export interface GameNetHandlers {
  onLobby?: (data: {
    players: LobbyPlayer[];
    config: MatchConfig;
    joinCode: string;
    hostId: string | null;
    title: string;
    myLoadoutChoices?: Loadout[];
    mySelectedLoadoutIndex?: number;
  }) => void;
  onMatchStarted?: (data: MatchStartedPayload) => void;
  onTurnStart?: (data: TurnStartPayload) => void;
  onPlayerMoved?: (data: {
    id: string;
    x: number;
    y: number;
    fuel: number;
    facing: 1 | -1;
  }) => void;
  onPlayerAimed?: (data: {
    id: string;
    angle: number;
    power: number;
    facing: 1 | -1;
  }) => void;
  onProjectile?: (data: {
    ownerId: string;
    path: { x: number; y: number; z: number }[];
    paths?: { x: number; y: number; z: number }[][];
    weaponId?: string;
  }) => void;
  onTerrain?: (data: { ops: TerrainOp[] }) => void;
  onDamage?: (data: {
    targetId: string;
    amount: number;
    sourceId: string;
  }) => void;
  onEliminated?: (data: { id: string; reason: string }) => void;
  onMatchState?: (data: {
    status: string;
    phase: string;
    wind: number;
    turnIndex: number;
    currentPlayerId: string | null;
    players: PlayerState[];
    matchSeed: number;
    config: MatchConfig;
  }) => void;
  onMatchEnd?: (data: MatchEndPayload) => void;
  onSuddenDeath?: (data: SuddenDeathPayload) => void;
  onReconnected?: (data: ReconnectedPayload) => void;
  onError?: (data: { message: string }) => void;
  onLeave?: () => void;
}

export class GameClient {
  private client: Client;
  room: Room | null = null;
  sessionId: string | null = null;
  /** Seat id once known (from match players / reconnect). */
  playerId: string | null = null;

  constructor(private handlers: GameNetHandlers = {}) {
    this.client = new Client(DEFAULT_WS);
  }

  private joinOptions(extra: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      playerId: getStablePlayerId(),
      ...extra,
    };
  }

  async createMatch(options: {
    name?: string;
    isPrivate?: boolean;
    displayName?: string;
    maxPlayers?: number;
    fillBots?: boolean;
    botDifficulty?: "easy" | "normal" | "hard";
  }): Promise<Room> {
    const room = await this.client.create("match", this.joinOptions(options));
    this.bindRoom(room);
    return room;
  }

  async joinById(roomId: string, displayName?: string): Promise<Room> {
    const room = await this.client.joinById(
      roomId,
      this.joinOptions({ displayName }),
    );
    this.bindRoom(room);
    return room;
  }

  /** Join private room by scanning listing for join code (metadata). */
  async joinByCode(code: string, displayName?: string): Promise<Room> {
    const rooms = await this.client.getAvailableRooms("match");
    const found = rooms.find(
      (r) =>
        String(r.metadata?.joinCode ?? "").toUpperCase() ===
        code.trim().toUpperCase(),
    );
    if (!found) throw new Error("No room found with that code");
    return this.joinById(found.roomId, displayName);
  }

  private bindRoom(room: Room): void {
    this.room = room;
    this.sessionId = room.sessionId;
    try {
      sessionStorage.setItem("tdw-last-room", room.roomId);
    } catch {
      /* ignore */
    }

    room.onMessage("lobby_state", (data) => this.handlers.onLobby?.(data));
    room.onMessage(ServerMsg.MatchStarted, (data) =>
      this.handlers.onMatchStarted?.(data),
    );
    room.onMessage(ServerMsg.TurnStart, (data) =>
      this.handlers.onTurnStart?.(data),
    );
    room.onMessage(ServerMsg.PlayerMoved, (data) =>
      this.handlers.onPlayerMoved?.(data),
    );
    room.onMessage(ServerMsg.PlayerAimed, (data) =>
      this.handlers.onPlayerAimed?.(data),
    );
    room.onMessage(ServerMsg.ProjectileSpawn, (data) =>
      this.handlers.onProjectile?.(data),
    );
    room.onMessage(ServerMsg.TerrainDelta, (data) =>
      this.handlers.onTerrain?.(data),
    );
    room.onMessage(ServerMsg.Damage, (data) => this.handlers.onDamage?.(data));
    room.onMessage(ServerMsg.PlayerEliminated, (data) =>
      this.handlers.onEliminated?.(data),
    );
    room.onMessage("match_state", (data) => this.handlers.onMatchState?.(data));
    room.onMessage(ServerMsg.MatchEnd, (data) =>
      this.handlers.onMatchEnd?.(data),
    );
    room.onMessage(ServerMsg.SuddenDeath, (data) =>
      this.handlers.onSuddenDeath?.(data),
    );
    room.onMessage(ServerMsg.Reconnected, (data) =>
      this.handlers.onReconnected?.(data),
    );
    room.onMessage(ServerMsg.Error, (data) => this.handlers.onError?.(data));
    room.onLeave(() => this.handlers.onLeave?.());
  }

  sendReady(ready: boolean): void {
    this.room?.send(ClientMsg.SetReady, { ready });
  }

  sendSelectLoadout(index: number): void {
    this.room?.send(ClientMsg.SelectLoadout, { index });
  }

  sendName(name: string): void {
    this.room?.send(ClientMsg.SetName, { name });
  }

  addBot(): void {
    this.room?.send(ClientMsg.AddBot, {});
  }

  startMatch(): void {
    this.room?.send(ClientMsg.StartMatch, {});
  }

  move(dir: -1 | 0 | 1, dt = 1 / 20): void {
    const payload: MovePayload = { dir, dt };
    this.room?.send(ClientMsg.Move, payload);
  }

  aim(payload: AimPayload): void {
    this.room?.send(ClientMsg.Aim, payload);
  }

  fire(payload: FirePayload): void {
    this.room?.send(ClientMsg.Fire, payload);
  }

  pass(): void {
    this.room?.send(ClientMsg.Pass, {});
  }

  leave(): void {
    this.room?.leave();
    this.room = null;
  }
}

export async function fetchPublicRooms(): Promise<
  {
    roomId: string;
    title: string;
    players: number;
    maxPlayers: number;
    status: string;
  }[]
> {
  const res = await fetch("/api/rooms");
  const data = await res.json();
  return data.rooms ?? [];
}

export async function fetchLeaderboard(): Promise<
  {
    name: string;
    wins: number;
    kills: number;
    damage: number;
    matches: number;
    score: number;
  }[]
> {
  const res = await fetch("/api/leaderboard");
  const data = await res.json();
  return data.entries ?? [];
}
