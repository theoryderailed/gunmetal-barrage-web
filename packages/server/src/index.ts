import { Server, matchMaker } from "@colyseus/core";
import { WebSocketTransport } from "@colyseus/ws-transport";
import express from "express";
import cors from "cors";
import { createServer } from "node:http";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { MatchRoom } from "./rooms/MatchRoom.js";
import { topLeaderboard } from "./db/leaderboard.js";

const PORT = Number(process.env.PORT ?? 2567);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
/** Built Vite client — monorepo: packages/server/dist → packages/client/dist */
const CLIENT_DIST = path.resolve(__dirname, "../../client/dist");

const app = express();
app.use(cors());
app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "gunmetal-barrage" });
});

app.get("/api/leaderboard", (_req, res) => {
  try {
    res.json({ entries: topLeaderboard(25) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ entries: [], error: "db_error" });
  }
});

app.get("/api/rooms", async (_req, res) => {
  try {
    const rooms = await matchMaker.query({ name: "match" });
    const publicRooms = rooms
      .filter((r) => !r.metadata?.isPrivate && r.metadata?.status !== "playing")
      .map((r) => ({
        roomId: r.roomId,
        title: r.metadata?.title ?? "Match",
        players: r.metadata?.players ?? r.clients,
        maxPlayers: r.metadata?.maxPlayers ?? r.maxClients,
        status: r.metadata?.status ?? "lobby",
      }));
    res.json({ rooms: publicRooms });
  } catch (err) {
    console.error(err);
    res.json({ rooms: [] });
  }
});

// Production (Railway): serve the Vite client from the same origin as Colyseus.
// Dev still uses Vite on :5173 with API proxy; this only runs when dist exists.
if (existsSync(CLIENT_DIST)) {
  app.use(express.static(CLIENT_DIST, { index: false }));
  app.get("*", (req, res, next) => {
    // Leave API, health, and Colyseus matchmake HTTP routes alone.
    if (
      req.path.startsWith("/api") ||
      req.path.startsWith("/matchmake") ||
      req.path === "/health"
    ) {
      return next();
    }
    res.sendFile(path.join(CLIENT_DIST, "index.html"), (err) => {
      if (err) next(err);
    });
  });
  console.log(`[gunmetal-barrage] serving client from ${CLIENT_DIST}`);
}

const httpServer = createServer(app);

const gameServer = new Server({
  transport: new WebSocketTransport({
    server: httpServer,
  }),
});

gameServer.define("match", MatchRoom).enableRealtimeListing();

httpServer.listen(PORT, "0.0.0.0", () => {
  console.log(`[gunmetal-barrage] server listening on http://0.0.0.0:${PORT}`);
});
