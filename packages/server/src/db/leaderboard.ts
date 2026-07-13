import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import type { LeaderboardEntry, MatchResultEntry } from "@gunmetal-barrage/shared";

/**
 * Persist leaderboard on a Railway volume by setting:
 *   DATA_DIR=/data   (mount volume at /data)
 * Falls back to ./data under the process cwd.
 */
const DATA_DIR = path.resolve(
  process.env.DATA_DIR ?? process.env.GMB_DATA_DIR ?? path.join(process.cwd(), "data"),
);
const DB_PATH = path.join(DATA_DIR, "gunmetal-barrage.db");

let db: Database.Database | null = null;

export function getDataDir(): string {
  return DATA_DIR;
}

export function getDbPath(): string {
  return DB_PATH;
}

export function getDb(): Database.Database {
  if (db) return db;
  fs.mkdirSync(DATA_DIR, { recursive: true });
  console.log(`[db] leaderboard sqlite → ${DB_PATH}`);
  db = new Database(DB_PATH);
  db.exec(`
    CREATE TABLE IF NOT EXISTS players (
      name TEXT PRIMARY KEY,
      wins INTEGER NOT NULL DEFAULT 0,
      kills INTEGER NOT NULL DEFAULT 0,
      damage INTEGER NOT NULL DEFAULT 0,
      matches INTEGER NOT NULL DEFAULT 0,
      score INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS matches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      played_at TEXT NOT NULL,
      seed INTEGER NOT NULL,
      player_count INTEGER NOT NULL
    );
  `);
  return db;
}

export function recordMatch(seed: number, rankings: MatchResultEntry[]): void {
  const database = getDb();
  const insertMatch = database.prepare(
    `INSERT INTO matches (played_at, seed, player_count) VALUES (?, ?, ?)`,
  );
  const upsert = database.prepare(`
    INSERT INTO players (name, wins, kills, damage, matches, score)
    VALUES (@name, @wins, @kills, @damage, 1, @score)
    ON CONFLICT(name) DO UPDATE SET
      wins = wins + @wins,
      kills = kills + @kills,
      damage = damage + @damage,
      matches = matches + 1,
      score = score + @score
  `);

  const tx = database.transaction(() => {
    insertMatch.run(new Date().toISOString(), seed, rankings.length);
    for (const r of rankings) {
      upsert.run({
        name: r.name,
        wins: r.place === 1 ? 1 : 0,
        kills: r.kills,
        damage: r.damageDealt,
        score: r.score,
      });
    }
  });
  tx();
}

export function topLeaderboard(limit = 20): LeaderboardEntry[] {
  const database = getDb();
  const rows = database
    .prepare(
      `SELECT name, wins, kills, damage, matches, score
       FROM players ORDER BY score DESC, wins DESC LIMIT ?`,
    )
    .all(limit) as LeaderboardEntry[];
  return rows;
}
