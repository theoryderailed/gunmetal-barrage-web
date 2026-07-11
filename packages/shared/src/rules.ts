import type { MatchResultEntry, PlayerState } from "./types.js";

export function scorePlayer(p: PlayerState): number {
  const place = p.place > 0 ? p.place : 99;
  const placeBonus = Math.max(0, 5 - place) * 100;
  return (
    Math.max(0, p.kills) * 300 +
    Math.max(0, Math.floor(p.damageDealt)) +
    placeBonus +
    (p.alive ? 50 : 0)
  );
}

/**
 * Build final standings.
 * - Winner = last tank alive, else highest kills, then damage
 * - Places normalized to 1..N
 * - Kills come from player.kills (synced from server kill log before call)
 */
export function buildRankings(players: PlayerState[]): MatchResultEntry[] {
  const list = players.map((p) => ({ ...p }));

  const alive = list.filter((p) => p.alive);

  if (alive.length === 1) {
    // Clear winner place; others keep elimination order for secondary sort
    for (const p of list) {
      if (p.id === alive[0]!.id) p.place = 1;
    }
  }

  // Sort for standings:
  // 1) Still alive first
  // 2) More kills
  // 3) More damage
  // 4) Better elimination place (lower number = survived longer)
  list.sort((a, b) => {
    if (a.alive !== b.alive) return a.alive ? -1 : 1;
    if (b.kills !== a.kills) return b.kills - a.kills;
    if (b.damageDealt !== a.damageDealt) return b.damageDealt - a.damageDealt;
    const pa = a.place > 0 ? a.place : 1000;
    const pb = b.place > 0 ? b.place : 1000;
    return pa - pb;
  });

  return list.map((p, i) => {
    const place = i + 1;
    const kills = Math.max(0, Math.floor(Number(p.kills) || 0));
    const damageDealt = Math.max(0, Math.floor(Number(p.damageDealt) || 0));
    return {
      playerId: p.id,
      name: p.name,
      place,
      kills,
      damageDealt,
      score: scorePlayer({ ...p, place, kills, damageDealt }),
      isWinner: place === 1,
      isBot: !!p.isBot,
    };
  });
}

export function clampAngle(angle: number): number {
  return Math.max(0, Math.min(180, angle));
}

export function clampPower(power: number): number {
  return Math.max(5, Math.min(100, power));
}

export function moveSpeed(mobility: number): number {
  return 14 * mobility;
}

export function fuelCostPerUnit(mobility: number): number {
  return 2.5 / Math.max(0.5, mobility);
}

export const MAX_CLIMB_PER_UNIT = 1.15;
