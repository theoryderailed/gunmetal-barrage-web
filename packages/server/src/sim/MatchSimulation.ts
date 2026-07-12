import {
  DEFAULT_MATCH_CONFIG,
  VoxelMaterial,
  applyIdentityToPalette,
  blastsToTerrainOps,
  buildRankings,
  clampAngle,
  clampPower,
  createRng,
  fuelCostPerUnit,
  generateLoadout,
  generateMap,
  getWeaponById,
  hashSeed,
  moveAlongTerrain,
  moveSpeed,
  resolveBlastDamage,
  simulateWeaponFire,
  type DamageEvent,
  type MatchConfig,
  type MatchResultEntry,
  type PilotIdentity,
  type PlayerState,
  type TerrainOp,
  type TurnPhase,
  type VoxelWorld,
} from "@gunmetal-barrage/shared";

export interface FireResult {
  terrainOps: TerrainOp[];
  damages: DamageEvent[];
  projectilePath: { x: number; y: number; z: number }[];
  /** All shell paths (Triple Threat sends 3). */
  projectilePaths: { x: number; y: number; z: number }[][];
  weaponId: string;
  eliminated: string[];
  winnerId: string | null;
  rankings: MatchResultEntry[] | null;
}

export class MatchSimulation {
  config: MatchConfig;
  matchSeed: number;
  world: VoxelWorld;
  players: Map<string, PlayerState> = new Map();
  turnOrder: string[] = [];
  turnIndex = 0;
  wind = 0;
  phase: TurnPhase = "waiting";
  status: "lobby" | "playing" | "finished" = "lobby";
  nextPlace: number;
  terrainOps: TerrainOp[] = [];
  /** Authoritative kill log — rankings count from this, not mutable counters alone */
  private killLog: { killerId: string; victimId: string }[] = [];
  private midZ: number;
  /** Precomputed spawn pads (shuffled); players claim random unused slots. */
  private spawns: { x: number; y: number }[];
  private spawnClaimOrder: number[] = [];
  private nextSpawnSlot = 0;

  constructor(matchSeed: number, config: Partial<MatchConfig> = {}) {
    this.config = { ...DEFAULT_MATCH_CONFIG, ...config };
    this.matchSeed = matchSeed;
    const map = generateMap(matchSeed, this.config);
    this.world = map.world;
    this.spawns = map.spawns;
    this.midZ = Math.floor(this.config.mapDepth / 2);
    this.nextPlace = this.config.maxPlayers; // reset in start() to live player count
    // Shuffle claim order so bots/humans don't always take left-to-right
    const rng = createRng(hashSeed(matchSeed, "spawn-order"));
    this.spawnClaimOrder = map.spawns.map((_, i) => i);
    for (let i = this.spawnClaimOrder.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      const tmp = this.spawnClaimOrder[i]!;
      this.spawnClaimOrder[i] = this.spawnClaimOrder[j]!;
      this.spawnClaimOrder[j] = tmp;
    }
  }

  private takeSpawn(): { x: number; y: number } {
    const n = this.spawns.length;
    if (n === 0) {
      return { x: 20 + this.players.size * 18, y: 40 };
    }
    const idx =
      this.spawnClaimOrder[this.nextSpawnSlot % this.spawnClaimOrder.length] ??
      this.nextSpawnSlot % n;
    this.nextSpawnSlot++;
    return this.spawns[idx] ?? this.spawns[0]!;
  }

  addPlayer(opts: {
    id: string;
    sessionId: string;
    name: string;
    isBot: boolean;
    identity?: PilotIdentity | null;
    /** Pre-selected lobby loadout (character select). */
    loadout?: import("@gunmetal-barrage/shared").Loadout;
  }): PlayerState {
    const loadoutSeed = hashSeed(this.matchSeed, opts.id, "loadout");
    const loadout =
      opts.loadout ?? generateLoadout(loadoutSeed, this.config.budget);
    const identity = opts.identity ?? null;

    // Bots: unique palette + display name from identity
    if (identity) {
      loadout.palette = applyIdentityToPalette(loadout.palette, identity);
      // Keep procgen tank callsign as chassis label; pilot name is identity.displayName
      loadout.name = `${identity.displayName}'s ${loadout.chassis.name.replace(/ Hull$/, "")}`;
    }

    const spawn = this.takeSpawn();
    // Small jitter so two tanks never stack perfectly on the same pad
    const jitterRng = createRng(hashSeed(this.matchSeed, opts.id, "jitter"));
    const jx = (jitterRng() - 0.5) * 2.4;

    const player: PlayerState = {
      id: opts.id,
      sessionId: opts.sessionId,
      name: identity?.displayName ?? opts.name,
      isBot: opts.isBot,
      ready: opts.isBot,
      loadout,
      identity,
      x: spawn.x + 0.5 + jx,
      y: spawn.y + 0.2,
      facing: spawn.x < this.config.mapWidth / 2 ? 1 : -1,
      hp: loadout.chassis.maxHp,
      fuel: loadout.chassis.fuel,
      angle: 45,
      power: 50,
      primaryAmmo: loadout.primary.maxAmmo,
      secondaryAmmo: loadout.secondary?.maxAmmo ?? 0,
      kills: 0,
      damageDealt: 0,
      alive: true,
      place: 0,
      lastAttackerId: null,
    };
    this.players.set(opts.id, player);
    return player;
  }

  getPlayerList(): PlayerState[] {
    return [...this.players.values()];
  }

  start(): void {
    const alive = this.getPlayerList().filter((p) => p.alive);
    const rng = createRng(this.matchSeed ^ 0xabc);
    this.turnOrder = alive.map((p) => p.id).sort(() => rng() - 0.5);
    this.turnIndex = 0;
    this.status = "playing";
    this.phase = "move";
    this.wind = this.rollWind();
    // Elimination places: first out gets N, countdown toward 2; survivor gets 1
    this.nextPlace = alive.length;
    this.killLog = [];
    for (const p of this.players.values()) {
      p.kills = 0;
      p.damageDealt = 0;
      p.place = 0;
      p.lastAttackerId = null;
      p.alive = true;
    }
    this.snapAllToGround();
  }

  /** Kills credited to each player from the authoritative log. */
  getKillCounts(): Map<string, number> {
    const counts = new Map<string, number>();
    for (const p of this.players.values()) counts.set(p.id, 0);
    for (const k of this.killLog) {
      if (k.killerId === k.victimId) continue;
      counts.set(k.killerId, (counts.get(k.killerId) ?? 0) + 1);
    }
    return counts;
  }

  /**
   * Eliminate a tank once. Awards a kill to `killerId` when it's a different player.
   * Returns true if this call performed the elimination.
   */
  eliminate(targetId: string, killerId: string | null, reason: string): boolean {
    const target = this.players.get(targetId);
    if (!target || !target.alive) return false;

    target.alive = false;
    target.hp = 0;
    // Assign place from the bottom (N, N-1, ... 2); winner keeps 0 until match end → 1
    if (this.nextPlace > 1) {
      target.place = this.nextPlace;
      this.nextPlace -= 1;
    } else {
      target.place = 2;
    }

    // Resolve kill credit:
    // - blast with explicit killer → that killer
    // - blast self (null) → no kill (don't blame earlier attacker for your suicide shot)
    // - fall/disconnect → last attacker if any
    let credit: string | null = null;
    if (reason === "blast") {
      credit = killerId && killerId !== targetId ? killerId : null;
    } else if (reason === "fall") {
      credit =
        killerId && killerId !== targetId
          ? killerId
          : target.lastAttackerId && target.lastAttackerId !== targetId
            ? target.lastAttackerId
            : null;
    } else {
      // disconnect / forfeit — no kill
      credit = null;
    }

    if (credit && credit !== targetId && this.players.has(credit)) {
      this.killLog.push({ killerId: credit, victimId: targetId });
      const counts = this.getKillCounts();
      for (const pl of this.players.values()) {
        pl.kills = counts.get(pl.id) ?? 0;
      }
    }
    return true;
  }

  /** Sync kill counters from log before building rankings. */
  syncKillsFromLog(): void {
    const counts = this.getKillCounts();
    for (const p of this.players.values()) {
      p.kills = counts.get(p.id) ?? 0;
    }
  }

  rollWind(): number {
    const rng = createRng(hashSeed(this.matchSeed, this.turnIndex, "wind"));
    return (rng() * 2 - 1) * 1.8;
  }

  currentPlayerId(): string | null {
    if (this.turnOrder.length === 0) return null;
    return this.turnOrder[this.turnIndex % this.turnOrder.length] ?? null;
  }

  currentPlayer(): PlayerState | null {
    const id = this.currentPlayerId();
    return id ? this.players.get(id) ?? null : null;
  }

  snapAllToGround(): void {
    for (const p of this.players.values()) {
      this.snapToGround(p);
    }
  }

  /**
   * Snap tank to walkable surface. Returns true if the tank fell into the void
   * (bedrock-only / no ground) and should be eliminated.
   */
  snapToGround(p: PlayerState): boolean {
    const ground = this.world.sampleGroundY(p.x, this.midZ);
    if (ground < 0 || this.world.isVoidColumn(p.x, this.midZ)) {
      // Drop through the kill floor
      p.y = -2;
      return true;
    }
    p.y = ground;
    // Standing on the absolute bottom strip is also lethal (dug down to bedrock)
    if (ground <= 1.2) {
      p.y = -2;
      return true;
    }
    return false;
  }

  /**
   * Continuous move along interpolated voxel surface.
   * `dtSec` is the client frame time so multiplayer matches sandbox feel.
   */
  tryMove(
    playerId: string,
    dir: -1 | 0 | 1,
    dtSec = 1 / 20,
  ): PlayerState | null {
    const p = this.players.get(playerId);
    if (!p || !p.alive) return null;
    if (this.phase !== "move" && this.phase !== "aim") return null;
    if (this.currentPlayerId() !== playerId) return null;
    if (dir === 0) return p;

    const loadout = p.loadout!;
    const speed = moveSpeed(loadout.chassis.mobility);
    const dt = Math.min(0.05, Math.max(0.008, dtSec));
    const distance = speed * dt;

    // Fuel check for full intended move (charge partial if low)
    const costPer = fuelCostPerUnit(loadout.chassis.mobility);
    const maxDist = p.fuel / Math.max(1e-4, costPer);
    const want = Math.min(distance, maxDist);
    if (want <= 1e-4) return p;

    const result = moveAlongTerrain(
      this.world,
      p.x,
      p.y,
      this.midZ,
      dir > 0 ? 1 : -1,
      want,
    );

    if (result.traveled > 0) {
      p.fuel -= costPer * result.traveled;
      p.x = result.x;
      p.y = result.y;
      p.facing = dir > 0 ? 1 : -1;
    }

    // Walked into a dig-through void / bedrock floor
    if (this.snapToGround(p)) {
      this.eliminate(
        playerId,
        p.lastAttackerId && p.lastAttackerId !== playerId
          ? p.lastAttackerId
          : null,
        "fall",
      );
    }

    return p;
  }

  setAim(playerId: string, angle: number, power: number, facing?: 1 | -1): PlayerState | null {
    const p = this.players.get(playerId);
    if (!p || !p.alive) return null;
    if (this.currentPlayerId() !== playerId) return null;
    if (this.phase !== "move" && this.phase !== "aim") return null;
    p.angle = clampAngle(angle);
    p.power = clampPower(power);
    if (facing) p.facing = facing;
    // Do not flip phase to "aim" here — that used to lock out movement.
    // Phase stays "move" until fire / resolve.
    return p;
  }

  fire(
    playerId: string,
    angle: number,
    power: number,
    weaponSlot: "primary" | "secondary",
    facing: 1 | -1,
  ): FireResult | null {
    const p = this.players.get(playerId);
    if (!p || !p.alive || !p.loadout) return null;
    if (this.currentPlayerId() !== playerId) return null;
    if (this.phase !== "move" && this.phase !== "aim") return null;

    // Always have a shootable primary: empty magazine → Peashooter (∞ ammo)
    this.ensureDefaultWeapon(playerId);

    let slot = weaponSlot;
    // Empty / missing secondary falls back to primary (possibly Peashooter)
    if (
      slot === "secondary" &&
      (!p.loadout.secondary || p.secondaryAmmo <= 0)
    ) {
      slot = "primary";
    }

    let weapon =
      slot === "secondary" && p.loadout.secondary
        ? p.loadout.secondary
        : p.loadout.primary;

    if (slot === "secondary") {
      if (p.secondaryAmmo <= 0) return null;
      p.secondaryAmmo -= 1;
    } else {
      // Peashooter never runs dry
      if (weapon.id === "peashooter") {
        p.primaryAmmo = Math.max(p.primaryAmmo, 99);
      } else {
        if (p.primaryAmmo <= 0) {
          this.ensureDefaultWeapon(playerId);
          weapon = p.loadout.primary;
        } else {
          p.primaryAmmo -= 1;
          if (p.primaryAmmo <= 0) {
            // Last shell of limited gun → equip Peashooter for next shot
            this.ensureDefaultWeapon(playerId);
          }
        }
      }
    }

    p.angle = clampAngle(angle);
    p.power = clampPower(power);
    p.facing = facing;
    this.phase = "resolving";

    const seekTargets = this.getPlayerList()
      .filter((t) => t.alive && t.id !== p.id)
      .map((t) => ({ x: t.x, y: t.y }));

    const fired = simulateWeaponFire(this.world, {
      weapon,
      tankX: p.x,
      tankY: p.y,
      midZ: this.midZ,
      facing,
      angleDeg: p.angle,
      power: p.power,
      wind: this.wind,
      chassisSize: p.loadout.chassis.size,
      seekTargets,
    });

    const allOps: TerrainOp[] = blastsToTerrainOps(fired.blasts, weapon);
    for (const op of allOps) {
      if (op.kind === "ellipsoid") {
        this.world.stampEllipsoid(
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
        this.world.stampSphere(
          Math.round(op.x),
          Math.round(op.y),
          Math.round(op.z),
          op.radius,
          VoxelMaterial.Air,
          true,
        );
      }
      this.terrainOps.push(op);
    }

    const damageByTarget = resolveBlastDamage(
      weapon,
      fired.blasts,
      this.getPlayerList()
        .filter((t) => t.alive)
        .map((t) => ({
          id: t.id,
          x: t.x,
          y: t.y,
          armor: t.loadout?.chassis.armor ?? 0,
          isShooter: t.id === p.id,
        })),
    );

    const mainPath = fired.path;
    const allPaths = fired.paths;
    const allDamage: DamageEvent[] = [];
    const eliminated: string[] = [];

    for (const [targetId, total] of damageByTarget) {
      const target = this.players.get(targetId);
      if (!target || !target.alive || total <= 0) continue;
      target.hp -= total;
      if (targetId !== p.id) {
        p.damageDealt += total;
        target.lastAttackerId = p.id;
      }
      allDamage.push({
        targetId,
        amount: total,
        sourceId: p.id,
        x: target.x,
        y: target.y,
      });
      if (target.hp <= 0) {
        // Direct blast kill — credit shooter (not self)
        if (this.eliminate(targetId, targetId === p.id ? null : p.id, "blast")) {
          eliminated.push(targetId);
        }
      }
    }

    // Fall damage / void death after terrain change — credit last attacker
    for (const t of this.players.values()) {
      if (!t.alive) continue;
      const beforeY = t.y;
      const voided = this.snapToGround(t);
      if (voided) {
        const killer =
          t.lastAttackerId && t.lastAttackerId !== t.id
            ? t.lastAttackerId
            : p.id !== t.id
              ? p.id
              : null;
        if (this.eliminate(t.id, killer, "fall")) {
          eliminated.push(t.id);
        }
        continue;
      }
      const fall = beforeY - t.y;
      if (fall > 4) {
        const fd = Math.floor((fall - 4) * 8);
        t.hp -= fd;
        if (t.hp <= 0) {
          const killer =
            t.lastAttackerId && t.lastAttackerId !== t.id
              ? t.lastAttackerId
              : null;
          if (this.eliminate(t.id, killer, "fall")) {
            eliminated.push(t.id);
          }
        }
      }
    }

    const alive = this.getPlayerList().filter((pl) => pl.alive);
    let winnerId: string | null = null;
    let rankings: MatchResultEntry[] | null = null;

    if (alive.length <= 1) {
      if (alive[0]) {
        alive[0].place = 1;
        winnerId = alive[0].id;
      }
      this.status = "finished";
      this.phase = "ended";
      this.syncKillsFromLog();
      rankings = buildRankings(this.getPlayerList());
    }

    return {
      terrainOps: allOps,
      damages: allDamage,
      projectilePath: mainPath,
      projectilePaths: allPaths,
      weaponId: weapon.id,
      eliminated: [...new Set(eliminated)],
      winnerId,
      rankings,
    };
  }

  advanceTurn(): { playerId: string; wind: number; turnIndex: number } | null {
    if (this.status !== "playing") return null;
    const aliveIds = this.turnOrder.filter((id) => this.players.get(id)?.alive);
    if (aliveIds.length <= 1) return null;

    // Always land on a living pilot (old loop could exit still on a corpse)
    const n = this.turnOrder.length;
    for (let guard = 0; guard < n + 2; guard++) {
      this.turnIndex += 1;
      const id = this.currentPlayerId();
      if (id && this.players.get(id)?.alive) break;
    }

    const curId = this.currentPlayerId();
    if (!curId || !this.players.get(curId)?.alive) return null;

    this.wind = this.rollWind();
    this.phase = "move";
    const cur = this.currentPlayer();
    if (cur?.loadout) {
      // Full fuel every turn
      cur.fuel = cur.loadout.chassis.fuel;
    }
    return {
      playerId: curId,
      wind: this.wind,
      turnIndex: this.turnIndex,
    };
  }

  /** Ensure active pilot starts the turn with a full tank. */
  refillFuelFor(playerId: string): void {
    const p = this.players.get(playerId);
    if (p?.loadout) p.fuel = p.loadout.chassis.fuel;
  }

  /**
   * When primary ammo is spent, equip Peashooter with unlimited ammo.
   * Everyone (human + bot) can always take a shot.
   */
  ensureDefaultWeapon(playerId: string): void {
    const p = this.players.get(playerId);
    if (!p?.loadout) return;
    if (p.primaryAmmo > 0 && p.loadout.primary.id === "peashooter") {
      // Keep the free gun topped up
      p.primaryAmmo = Math.max(p.primaryAmmo, 99);
      return;
    }
    if (p.primaryAmmo > 0) return;

    const pea = getWeaponById("peashooter");
    if (!pea) return;
    p.loadout = {
      ...p.loadout,
      primary: { ...pea },
    };
    p.primaryAmmo = 99;
  }

  /** @deprecated use ensureDefaultWeapon */
  ensureBotAmmo(playerId: string): void {
    this.ensureDefaultWeapon(playerId);
  }

}

/** @deprecated Prefer generateBotIdentity — kept for rare fallbacks */
export function createBotName(index: number): string {
  return `Pilot ${index + 1}`;
}
