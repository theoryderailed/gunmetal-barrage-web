import { Room, type Client } from "@colyseus/core";
import {
  DEFAULT_MATCH_CONFIG,
  ClientMsg,
  ServerMsg,
  buildRankings,
  generateBotIdentity,
  hashSeed,
  type MatchConfig,
  type AimPayload,
  type FirePayload,
  type MatchResultEntry,
  type MovePayload,
  type PilotIdentity,
} from "@gunmetal-barrage/shared";
import { MatchSimulation } from "../sim/MatchSimulation.js";
import { botAct, botThinkDelayMs } from "../ai/SimpleBot.js";
import { recordMatch } from "../db/leaderboard.js";
import { randomBytes } from "node:crypto";

interface CreateOptions {
  name?: string;
  isPrivate?: boolean;
  maxPlayers?: number;
  budget?: number;
  fillBots?: boolean;
  displayName?: string;
}

interface ClientData {
  name: string;
  ready: boolean;
}

export class MatchRoom extends Room {
  private sim: MatchSimulation | null = null;
  private joinCode = "";
  private hostId: string | null = null;
  private turnTimer: ReturnType<typeof setTimeout> | null = null;
  private botTimer: ReturnType<typeof setTimeout> | null = null;
  /** Post-shot / bot-fire delays must be tracked so they can be cancelled. */
  private resolveTimer: ReturnType<typeof setTimeout> | null = null;
  private botFireTimer: ReturnType<typeof setTimeout> | null = null;
  private config: MatchConfig = { ...DEFAULT_MATCH_CONFIG };
  private roomTitle = "Gun Metal Barrage";
  private botCount = 0;
  /** Unique pilots rolled when bots are added (before match). */
  private pendingBots: PilotIdentity[] = [];
  /** Monotonic token so stale bot/turn callbacks never act after the turn advanced. */
  private turnEpoch = 0;

  onCreate(options: CreateOptions): void {
    this.maxClients = options.maxPlayers ?? DEFAULT_MATCH_CONFIG.maxPlayers;
    this.config = {
      ...DEFAULT_MATCH_CONFIG,
      maxPlayers: options.maxPlayers ?? DEFAULT_MATCH_CONFIG.maxPlayers,
      budget: options.budget ?? DEFAULT_MATCH_CONFIG.budget,
      isPrivate: !!options.isPrivate,
      fillBots: options.fillBots !== false,
    };
    this.roomTitle = options.name?.slice(0, 40) || "Gun Metal Barrage";
    this.joinCode = randomBytes(3).toString("hex").toUpperCase();
    this.setMetadata({
      title: this.roomTitle,
      isPrivate: this.config.isPrivate,
      joinCode: this.config.isPrivate ? this.joinCode : "",
      players: 0,
      maxPlayers: this.maxClients,
      status: "lobby",
    });

    this.onMessage(ClientMsg.SetName, (client, message: { name?: string }) => {
      const p = this.sim?.players.get(client.sessionId);
      if (p && message.name) {
        p.name = String(message.name).slice(0, 20);
        this.broadcastState();
      } else {
        const data = getClientData(client);
        data.name = String(message.name ?? "Tank").slice(0, 20);
      }
    });

    this.onMessage(ClientMsg.SetReady, (client, message: { ready?: boolean }) => {
      const p = this.sim?.players.get(client.sessionId);
      if (this.sim && p) {
        p.ready = !!message.ready;
        this.broadcastState();
        return;
      }
      getClientData(client).ready = !!message.ready;
      this.broadcastLobby();
    });

    this.onMessage(ClientMsg.AddBot, (client) => {
      if (this.sim?.status === "playing") return;
      if (this.hostId && client.sessionId !== this.hostId) return;
      this.addBot();
      this.broadcastLobby();
    });

    this.onMessage(ClientMsg.StartMatch, (client) => {
      if (this.hostId && client.sessionId !== this.hostId) return;
      this.beginMatch();
    });

    this.onMessage(ClientMsg.Move, (client, message: MovePayload) => {
      if (!this.sim || this.sim.status !== "playing") return;
      const dt = typeof message.dt === "number" ? message.dt : 1 / 20;
      const p = this.sim.tryMove(client.sessionId, message.dir, dt);
      if (p) {
        this.broadcast(ServerMsg.PlayerMoved, {
          id: p.id,
          x: p.x,
          y: p.y,
          fuel: p.fuel,
          facing: p.facing,
        });
      }
    });

    this.onMessage(ClientMsg.Aim, (client, message: AimPayload) => {
      if (!this.sim || this.sim.status !== "playing") return;
      const p = this.sim.setAim(
        client.sessionId,
        message.angle,
        message.power,
        message.facing,
      );
      if (p) {
        this.broadcast(ServerMsg.PlayerAimed, {
          id: p.id,
          angle: p.angle,
          power: p.power,
          facing: p.facing,
        });
      }
    });

    this.onMessage(ClientMsg.Fire, (client, message: FirePayload) => {
      this.handleFire(client.sessionId, message);
    });

    this.onMessage(ClientMsg.Pass, (client) => {
      if (!this.sim || this.sim.status !== "playing") return;
      if (this.sim.currentPlayerId() !== client.sessionId) return;
      // Don't pass mid-shell (would skip resolve / double-advance)
      if (this.sim.phase !== "move" && this.sim.phase !== "aim") return;
      this.endTurn();
    });

    // Lobby-only sim placeholder not needed; players tracked via clients
    this.sim = null;
  }

  onJoin(client: Client, options: CreateOptions): void {
    if (!this.hostId) this.hostId = client.sessionId;
    const name =
      options.displayName?.slice(0, 20) ||
      `Tank-${client.sessionId.slice(0, 4)}`;
    (client as Client & { userData: ClientData }).userData = {
      name,
      ready: false,
    };

    if (this.sim && this.sim.status === "playing") {
      client.send(ServerMsg.Error, { message: "Match already in progress" });
      return;
    }

    this.updateMetaPlayers();
    this.broadcastLobby();
  }

  onLeave(client: Client): void {
    if (this.sim?.status === "playing") {
      const p = this.sim.players.get(client.sessionId);
      if (p && p.alive) {
        // Disconnect = forfeit, no kill credit
        this.sim.eliminate(client.sessionId, null, "disconnect");
        this.broadcast(ServerMsg.PlayerEliminated, {
          id: p.id,
          reason: "disconnect",
        });
        const alive = this.sim.getPlayerList().filter((x) => x.alive);
        if (alive.length <= 1) {
          this.finishMatch();
          return;
        }
        if (this.sim.currentPlayerId() === client.sessionId) {
          this.endTurn();
        }
      }
    }
    if (this.hostId === client.sessionId) {
      const next = this.clients.find((c) => c.sessionId !== client.sessionId);
      this.hostId = next?.sessionId ?? null;
    }
    this.updateMetaPlayers();
    this.broadcastLobby();
  }

  private updateMetaPlayers(): void {
    const total = this.clients.length + this.botCount;
    this.setMetadata({
      ...this.metadata,
      players: total,
      maxPlayers: this.maxClients,
      status: this.sim?.status ?? "lobby",
      title: this.roomTitle,
      isPrivate: this.config.isPrivate,
      joinCode: this.config.isPrivate ? this.joinCode : "",
    });
  }

  private broadcastLobby(): void {
    const humans = this.clients.map((c) => {
      const data = getClientData(c);
      return {
        id: c.sessionId,
        name: data.name,
        ready: data.ready,
        isBot: false,
        isHost: c.sessionId === this.hostId,
        title: null as string | null,
        persona: null as string | null,
        motto: null as string | null,
      };
    });
    const bots = this.pendingBots.map((id, i) => ({
      id: `bot-${i}`,
      name: id.displayName,
      ready: true,
      isBot: true,
      isHost: false,
      title: id.title,
      persona: id.persona,
      motto: id.motto,
    }));
    this.broadcast("lobby_state", {
      players: [...humans, ...bots],
      config: this.config,
      joinCode: this.joinCode,
      hostId: this.hostId,
      title: this.roomTitle,
    });
  }

  private broadcastState(): void {
    if (!this.sim) return;
    this.broadcast("match_state", {
      status: this.sim.status,
      phase: this.sim.phase,
      wind: this.sim.wind,
      turnIndex: this.sim.turnIndex,
      currentPlayerId: this.sim.currentPlayerId(),
      players: this.sim.getPlayerList(),
      matchSeed: this.sim.matchSeed,
      config: this.sim.config,
    });
  }

  private addBot(): void {
    const total = this.clients.length + this.botCount;
    if (total >= this.maxClients) return;
    const seed = hashSeed(
      this.joinCode,
      this.botCount,
      Date.now(),
      Math.random(),
    );
    // Avoid duplicate display names in the same lobby
    let identity = generateBotIdentity(seed);
    let guard = 0;
    while (
      this.pendingBots.some((b) => b.displayName === identity.displayName) &&
      guard++ < 12
    ) {
      identity = generateBotIdentity(seed + guard * 9973);
    }
    this.pendingBots.push(identity);
    this.botCount = this.pendingBots.length;
    this.updateMetaPlayers();
  }

  private beginMatch(): void {
    if (this.sim?.status === "playing") return;

    const humanCount = this.clients.length;
    if (humanCount + this.botCount < 1) return;

    // Auto-fill bots if enabled and only one human
    if (this.config.fillBots && humanCount + this.botCount < 2) {
      while (humanCount + this.botCount < 2) this.addBot();
    }

    const seed = (Date.now() ^ (Math.random() * 1e9)) >>> 0;
    this.sim = new MatchSimulation(seed, this.config);

    for (const c of this.clients) {
      const name = getClientData(c).name;
      this.sim.addPlayer({
        id: c.sessionId,
        sessionId: c.sessionId,
        name,
        isBot: false,
        identity: null,
      });
    }
    for (let i = 0; i < this.pendingBots.length; i++) {
      const identity = this.pendingBots[i]!;
      const id = `bot-${i}`;
      this.sim.addPlayer({
        id,
        sessionId: id,
        name: identity.displayName,
        isBot: true,
        identity,
      });
    }

    this.sim.start();
    // First player starts with full fuel (same as every subsequent turn)
    const firstId = this.sim.currentPlayerId();
    if (firstId) this.sim.refillFuelFor(firstId);
    this.updateMetaPlayers();

    this.broadcast(ServerMsg.MatchStarted, {
      matchSeed: this.sim.matchSeed,
      config: this.sim.config,
      players: this.sim.getPlayerList(),
      wind: this.sim.wind,
      firstPlayerId: firstId,
    });

    // Intro: full map → drop-ins → zoom to first pilot (~5.2s), then turn
    this.botTimer = setTimeout(() => this.startTurn(), 6200);
  }

  private startTurn(): void {
    if (!this.sim || this.sim.status !== "playing") return;
    // Skip dead current players (can happen after bad advance / disconnect races)
    let playerId = this.sim.currentPlayerId();
    let hops = 0;
    while (
      playerId &&
      !this.sim.players.get(playerId)?.alive &&
      hops < (this.sim.turnOrder.length || 1) + 2
    ) {
      const next = this.sim.advanceTurn();
      if (!next) {
        this.finishMatch();
        return;
      }
      playerId = next.playerId;
      hops++;
    }
    if (!playerId) {
      this.finishMatch();
      return;
    }
    const cur = this.sim.players.get(playerId);
    if (!cur?.alive) {
      this.finishMatch();
      return;
    }

    this.sim.refillFuelFor(playerId);
    // Bots never soft-lock for empty magazines mid-match
    if (cur.isBot) this.sim.ensureBotAmmo(playerId);

    this.clearTimers();
    this.turnEpoch += 1;
    const epoch = this.turnEpoch;

    this.broadcast(ServerMsg.TurnStart, {
      playerId,
      turnIndex: this.sim.turnIndex,
      wind: this.sim.wind,
      timeSec: this.config.turnTimeSec,
      phase: this.sim.phase,
    });
    this.broadcastState();

    this.turnTimer = setTimeout(() => {
      if (this.turnEpoch !== epoch) return;
      this.endTurn();
    }, this.config.turnTimeSec * 1000);

    if (cur.isBot) {
      const delay = botThinkDelayMs(cur.identity?.persona);
      this.botTimer = setTimeout(() => {
        if (this.turnEpoch !== epoch) return;
        this.runBotTurn(epoch);
      }, delay);
    }
  }

  private runBotTurn(epoch: number): void {
    if (this.turnEpoch !== epoch) return;
    if (!this.sim || this.sim.status !== "playing") return;
    const cur = this.sim.currentPlayer();
    if (!cur?.isBot || !cur.alive) {
      // Dead/stale current — advance so the match doesn't freeze
      this.endTurn();
      return;
    }

    try {
      this.sim.ensureBotAmmo(cur.id);
      const act = botAct(this.sim);

      // Spend a bit of fuel moving (several substeps) so bots actually reposition
      if (act.moveDir !== 0) {
        for (let i = 0; i < 8; i++) {
          const p = this.sim.tryMove(cur.id, act.moveDir, 1 / 20);
          if (!p) break;
          if (i === 7 || i === 0) {
            this.broadcast(ServerMsg.PlayerMoved, {
              id: p.id,
              x: p.x,
              y: p.y,
              fuel: p.fuel,
              facing: p.facing,
            });
          }
        }
        const after = this.sim.players.get(cur.id);
        if (after) {
          this.broadcast(ServerMsg.PlayerMoved, {
            id: after.id,
            x: after.x,
            y: after.y,
            fuel: after.fuel,
            facing: after.facing,
          });
        }
      }

      this.sim.setAim(cur.id, act.angle, act.power, act.facing);
      this.broadcast(ServerMsg.PlayerAimed, {
        id: cur.id,
        angle: act.angle,
        power: act.power,
        facing: act.facing,
      });

      this.botFireTimer = setTimeout(() => {
        if (this.turnEpoch !== epoch) return;
        this.handleFire(
          cur.id,
          {
            angle: act.angle,
            power: act.power,
            weaponSlot: act.weaponSlot,
            facing: act.facing,
          },
          epoch,
        );
      }, 550);
    } catch (err) {
      console.error("[bot] runBotTurn failed", err);
      // Never leave the match stuck on a bot that threw
      this.endTurn();
    }
  }

  private handleFire(
    playerId: string,
    message: FirePayload,
    epoch?: number,
  ): void {
    if (!this.sim || this.sim.status !== "playing") return;
    if (epoch !== undefined && this.turnEpoch !== epoch) return;

    // If bot asked for empty secondary, fall back to primary once
    let slot = message.weaponSlot;
    const shooter = this.sim.players.get(playerId);
    if (
      shooter &&
      slot === "secondary" &&
      (!shooter.loadout?.secondary || shooter.secondaryAmmo <= 0)
    ) {
      slot = "primary";
    }
    if (shooter && slot === "primary" && shooter.primaryAmmo <= 0) {
      this.sim.ensureBotAmmo(playerId);
    }

    const result = this.sim.fire(
      playerId,
      message.angle,
      message.power,
      slot,
      message.facing,
    );

    // Failed fire used to return silently — bots with 0 ammo froze the turn.
    if (!result) {
      if (this.sim.currentPlayerId() === playerId) {
        console.warn(
          `[match] fire failed for ${playerId} slot=${slot}; ending turn`,
        );
        this.endTurn();
      }
      return;
    }

    this.clearTimers();
    // Keep epoch so delayed endTurn is still valid for this resolution
    const resolveEpoch = this.turnEpoch;

    this.broadcast(ServerMsg.ProjectileSpawn, {
      ownerId: playerId,
      path: result.projectilePath,
      paths: result.projectilePaths,
      weaponId: result.weaponId,
    });

    if (result.terrainOps.length) {
      this.broadcast(ServerMsg.TerrainDelta, { ops: result.terrainOps });
    }
    for (const d of result.damages) {
      this.broadcast(ServerMsg.Damage, d);
    }
    for (const id of result.eliminated) {
      this.broadcast(ServerMsg.PlayerEliminated, { id, reason: "destroyed" });
    }

    this.broadcastState();

    if (result.rankings) {
      this.finishMatch(result.rankings);
      return;
    }

    // Let clients play projectile animation before next turn
    const delay = Math.min(
      4000,
      Math.max(700, 800 + result.projectilePath.length * 8),
    );
    this.resolveTimer = setTimeout(() => {
      if (this.turnEpoch !== resolveEpoch) return;
      this.endTurn();
    }, delay);
  }

  private endTurn(): void {
    if (!this.sim || this.sim.status !== "playing") return;
    this.clearTimers();
    this.turnEpoch += 1;
    this.broadcast(ServerMsg.TurnEnd, {
      playerId: this.sim.currentPlayerId(),
    });
    const next = this.sim.advanceTurn();
    if (!next) {
      this.finishMatch();
      return;
    }
    this.startTurn();
  }

  private matchFinished = false;

  private finishMatch(rankings?: MatchResultEntry[]): void {
    if (!this.sim || this.matchFinished) return;
    this.matchFinished = true;
    this.clearTimers();
    this.sim.status = "finished";
    this.sim.phase = "ended";
    const alive = this.sim.getPlayerList().filter((p) => p.alive);
    if (alive.length === 1) alive[0]!.place = 1;
    // Always rebuild from kill log + sim state (ignore any stale payload)
    this.sim.syncKillsFromLog();
    const finalRankings = buildRankings(this.sim.getPlayerList());
    void rankings;
    try {
      recordMatch(this.sim.matchSeed, finalRankings);
    } catch (err) {
      console.error("Failed to record match", err);
    }
    this.broadcast(ServerMsg.MatchEnd, { rankings: finalRankings });
    this.updateMetaPlayers();
  }

  private clearTimers(): void {
    if (this.turnTimer) clearTimeout(this.turnTimer);
    if (this.botTimer) clearTimeout(this.botTimer);
    if (this.resolveTimer) clearTimeout(this.resolveTimer);
    if (this.botFireTimer) clearTimeout(this.botFireTimer);
    this.turnTimer = null;
    this.botTimer = null;
    this.resolveTimer = null;
    this.botFireTimer = null;
  }

  onDispose(): void {
    this.clearTimers();
  }
}

function getClientData(client: Client): ClientData {
  const c = client as Client & { userData?: ClientData };
  if (!c.userData) {
    c.userData = { name: "Tank", ready: false };
  }
  return c.userData;
}
