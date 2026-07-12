import type { LobbyPlayer } from "../net/Client";
import type {
  LeaderboardEntry,
  Loadout,
  MatchResultEntry,
  PlayerState,
} from "@gunmetal-barrage/shared";
import { personaLabel } from "@gunmetal-barrage/shared";

export function renderMenu(
  root: HTMLElement,
  opts: {
    name: string;
    onName: (n: string) => void;
    onCreatePublic: () => void;
    onCreatePrivate: () => void;
    onJoinCode: (code: string) => void;
    onRefreshRooms: () => void;
    onShowLeaderboard: () => void;
    onSandbox: () => void;
    rooms: {
      roomId: string;
      title: string;
      players: number;
      maxPlayers: number;
    }[];
    onJoinRoom: (id: string) => void;
  },
): void {
  root.innerHTML = `
    <div class="screen live-bg">
      <div class="panel live-panel menu-panel">
        <header class="menu-hero">
          <div class="menu-badge">ONLINE · DESTRUCTIBLE TERRAIN</div>
          <h1 class="menu-title">
            <span class="menu-title-line">GUN METAL</span>
            <span class="menu-title-line accent">BARRAGE</span>
          </h1>
          <p class="tagline">Procedural artillery · random biomes · questionable life choices</p>
          <div class="menu-keys">
            <span><kbd>Q</kbd><kbd>E</kbd> power</span>
            <span><kbd>SPACE</kbd> fire</span>
            <span><kbd>A</kbd><kbd>D</kbd> move</span>
            <span><kbd>W</kbd><kbd>S</kbd> angle</span>
          </div>
        </header>

        <div class="menu-grid">
          <section class="menu-card menu-card-callsign">
            <h3 class="menu-card-title">Your callsign</h3>
            <div class="callsign-row">
              <input id="name-input" type="text" maxlength="20" value="${escapeHtml(opts.name)}" placeholder="Commander" autocomplete="nickname" />
            </div>
          </section>

          <section class="menu-card menu-card-play">
            <h3 class="menu-card-title">Deploy</h3>
            <div class="menu-actions">
              <button id="btn-public" class="btn-wide">Public Match</button>
              <div class="menu-actions-split">
                <button id="btn-private" class="secondary">Private</button>
                <button id="btn-sandbox" class="secondary">Sandbox</button>
              </div>
            </div>
          </section>

          <section class="menu-card menu-card-join">
            <h3 class="menu-card-title">Join with code</h3>
            <div class="join-code-form">
              <input id="join-code" type="text" maxlength="8" placeholder="ABCD12" spellcheck="false" />
              <button id="btn-join-code" class="secondary">Join</button>
            </div>
          </section>

          <section class="menu-card menu-card-rooms">
            <div class="menu-card-head">
              <h3 class="menu-card-title">Public rooms</h3>
              <div class="menu-card-tools">
                <button id="btn-refresh" class="secondary btn-tiny">Refresh</button>
                <button id="btn-lb" class="secondary btn-tiny">Ranks</button>
              </div>
            </div>
            <ul class="room-list" id="room-list">
              ${
                opts.rooms.length === 0
                  ? `<li class="room-empty">
                      <span class="room-empty-icon">◈</span>
                      <span class="room-empty-title">No open rooms</span>
                      <span class="room-empty-sub">Host a public match or join with a code</span>
                    </li>`
                  : opts.rooms
                      .map(
                        (r) => `
                  <li class="room-item">
                    <div class="room-meta">
                      <span class="room-title">${escapeHtml(r.title)}</span>
                      <span class="room-slots">${r.players}<span class="room-slots-sep">/</span>${r.maxPlayers} pilots</span>
                    </div>
                    <button data-join="${r.roomId}" class="btn-join-room">Join</button>
                  </li>`,
                      )
                      .join("")
              }
            </ul>
          </section>
        </div>

        <footer class="menu-footer">
          <span>Sandbox · keys 1–7 weapons · [ ] cycle</span>
          <span class="menu-footer-dot">·</span>
          <span>F flip facing · P pass turn</span>
        </footer>
      </div>
    </div>
  `;

  root.querySelector("#name-input")?.addEventListener("change", (e) => {
    opts.onName((e.target as HTMLInputElement).value);
  });
  root.querySelector("#btn-public")?.addEventListener("click", opts.onCreatePublic);
  root.querySelector("#btn-private")?.addEventListener("click", opts.onCreatePrivate);
  root.querySelector("#btn-sandbox")?.addEventListener("click", opts.onSandbox);
  root.querySelector("#btn-refresh")?.addEventListener("click", opts.onRefreshRooms);
  root.querySelector("#btn-lb")?.addEventListener("click", opts.onShowLeaderboard);
  root.querySelector("#btn-join-code")?.addEventListener("click", () => {
    const code = (root.querySelector("#join-code") as HTMLInputElement).value;
    opts.onJoinCode(code);
  });
  root.querySelectorAll("[data-join]").forEach((btn) => {
    btn.addEventListener("click", () => {
      opts.onJoinRoom((btn as HTMLElement).dataset.join!);
    });
  });
}

export function renderLobby(
  root: HTMLElement,
  opts: {
    title: string;
    joinCode: string;
    isPrivate: boolean;
    players: LobbyPlayer[];
    isHost: boolean;
    onReady: (ready: boolean) => void;
    onAddBot: () => void;
    onStart: () => void;
    onLeave: () => void;
    ready: boolean;
    loadoutChoices: Loadout[];
    selectedLoadoutIndex: number;
    onSelectLoadout: (index: number) => void;
  },
): void {
  const allReady =
    opts.players.length >= 1 &&
    opts.players.every((p) => p.ready || p.isBot);
  const readyCount = opts.players.filter((p) => p.ready || p.isBot).length;
  const total = opts.players.length;
  const choices = opts.loadoutChoices ?? [];

  root.innerHTML = `
    <div class="screen live-bg">
      <div class="panel live-panel lobby-panel lobby-panel-wide">
        <header class="lobby-hero">
          <div class="lobby-badge">${opts.isPrivate ? "PRIVATE LOBBY" : "PUBLIC LOBBY"}</div>
          <h1 class="lobby-title">${escapeHtml(opts.title)}</h1>
          <p class="lobby-live-hint">Pick your tank, then ready up while the range fires</p>
          ${
            opts.isPrivate
              ? `<div class="join-code-plaque">
                  <span class="join-code-label">Share code</span>
                  <code class="join-code">${escapeHtml(opts.joinCode)}</code>
                  <button type="button" id="btn-copy-code" class="secondary btn-tiny">Copy</button>
                </div>`
              : ""
          }
          <div class="lobby-ready-meter" title="${readyCount}/${total} ready">
            <div class="lobby-ready-bar"><i style="width:${total ? (readyCount / total) * 100 : 0}%"></i></div>
            <span class="lobby-ready-label">${readyCount} / ${total} ready</span>
          </div>
        </header>

        <section class="char-select">
          <h3 class="char-select-title">Choose your tank</h3>
          <p class="char-select-sub">Three kits rolled for this lobby — inspect weapons before you ready</p>
          <div class="char-select-grid">
            ${
              choices.length === 0
                ? `<div class="char-select-empty">Rolling loadouts…</div>`
                : choices
                    .map((lo, i) => {
                      const selected = i === opts.selectedLoadoutIndex;
                      const alt = lo.secondary
                        ? escapeHtml(lo.secondary.name)
                        : "—";
                      const ammo =
                        lo.primary.id === "peashooter"
                          ? "∞"
                          : String(lo.primary.maxAmmo);
                      return `
              <button type="button" class="char-card ${selected ? "selected" : ""}" data-loadout="${i}">
                <div class="char-card-top">
                  <span class="char-slot">${i + 1}</span>
                  ${selected ? `<span class="char-selected-chip">SELECTED</span>` : `<span class="char-pick-chip">SELECT</span>`}
                </div>
                <div class="char-tank-name">${escapeHtml(lo.name)}</div>
                <div class="char-chassis">${escapeHtml(lo.chassis.name)}</div>
                <div class="char-stats">
                  <span>HP ${lo.chassis.maxHp}</span>
                  <span>ARM ${lo.chassis.armor}</span>
                  <span>FUEL ${lo.chassis.fuel}</span>
                </div>
                <div class="char-weapon">
                  <span class="char-wpn-label">PRIMARY</span>
                  <span class="char-wpn-name">${escapeHtml(lo.primary.name)}</span>
                  <span class="char-wpn-meta">DMG ${lo.primary.damage} · BLAST ${lo.primary.blastRadius} · AMMO ${ammo}</span>
                  <span class="char-wpn-sum">${escapeHtml(lo.primary.summary)}</span>
                </div>
                <div class="char-weapon alt">
                  <span class="char-wpn-label">ALT · R</span>
                  <span class="char-wpn-name">${alt}</span>
                  ${
                    lo.secondary
                      ? `<span class="char-wpn-meta">DMG ${lo.secondary.damage} · BLAST ${lo.secondary.blastRadius} · AMMO ${lo.secondary.maxAmmo}</span>
                         <span class="char-wpn-sum">${escapeHtml(lo.secondary.summary)}</span>`
                      : `<span class="char-wpn-meta muted">No alternate weapon</span>`
                  }
                </div>
              </button>`;
                    })
                    .join("")
            }
          </div>
        </section>

        <div class="pilot-grid">
          ${opts.players
            .map((p) => {
              const persona = p.persona
                ? personaLabel(p.persona as import("@gunmetal-barrage/shared").BotPersona)
                : null;
              const prev = p.loadoutPreview;
              return `
            <article class="pilot-card ${p.isBot ? "bot" : "human"} ${p.ready ? "is-ready" : ""}">
              <div class="pilot-card-top">
                <span class="pilot-avatar">${p.isBot ? "◆" : "●"}</span>
                <span class="pilot-ready-chip ${p.ready ? "on" : ""}">${p.ready ? "READY" : "WAIT"}</span>
              </div>
              <div class="pilot-name">${escapeHtml(p.name)}${p.isHost ? " <span class=\"host-star\" title=\"Host\">★</span>" : ""}</div>
              ${
                p.isBot
                  ? `<span class="pilot-tag">BOT · ${escapeHtml(persona ?? "AI")}</span>`
                  : `<span class="pilot-tag human-tag">HUMAN</span>`
              }
              ${p.title ? `<span class="pilot-title">${escapeHtml(p.title)}</span>` : ""}
              ${p.motto ? `<span class="pilot-motto">"${escapeHtml(p.motto)}"</span>` : ""}
              ${
                prev
                  ? `<div class="pilot-kit">
                      <span class="pilot-kit-tank">${escapeHtml(prev.chassisName)}</span>
                      <span class="pilot-kit-gun">${escapeHtml(prev.primaryName)}${prev.secondaryName ? ` · ${escapeHtml(prev.secondaryName)}` : ""}</span>
                    </div>`
                  : ""
              }
            </article>`;
            })
            .join("")}
          ${
            opts.players.length === 0
              ? `<div class="pilot-empty">Waiting for pilots…</div>`
              : ""
          }
        </div>

        <div class="lobby-actions">
          <button id="btn-ready" class="${opts.ready ? "good" : "btn-wide"}">${opts.ready ? "Unready" : "Ready up"}</button>
          ${opts.isHost ? `<button id="btn-bot" class="secondary">+ Bot</button>` : ""}
          ${
            opts.isHost
              ? `<button id="btn-start" class="good btn-start" ${allReady ? "" : "disabled"} title="${allReady ? "Start match" : "Everyone must ready"}">Start match</button>`
              : ""
          }
          <button id="btn-leave" class="secondary">Leave</button>
        </div>
        <p class="lobby-help">${
          opts.isHost
            ? allReady
              ? "All set — hit Start when ready."
              : "Everyone must pick a tank and ready (bots auto-ready)."
            : "Select a tank above, then ready up and wait for the host."
        }</p>
      </div>
    </div>
  `;
  root.querySelectorAll("[data-loadout]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const idx = Number((btn as HTMLElement).dataset.loadout);
      if (Number.isFinite(idx)) opts.onSelectLoadout(idx);
    });
  });
  root.querySelector("#btn-ready")?.addEventListener("click", () => {
    opts.onReady(!opts.ready);
  });
  root.querySelector("#btn-bot")?.addEventListener("click", opts.onAddBot);
  root.querySelector("#btn-start")?.addEventListener("click", () => {
    if (!allReady) return;
    opts.onStart();
  });
  root.querySelector("#btn-leave")?.addEventListener("click", opts.onLeave);
  root.querySelector("#btn-copy-code")?.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(opts.joinCode);
      const btn = root.querySelector("#btn-copy-code");
      if (btn) btn.textContent = "Copied!";
    } catch {
      /* ignore */
    }
  });
}

/** Full-screen cards for every pilot + kit at match start. */
export function renderLoadoutReveal(
  root: HTMLElement,
  players: PlayerState[],
  meId: string | null,
): void {
  root.innerHTML = `
    <div class="screen reveal-screen">
      <div class="panel reveal-panel">
        <h1>PILOTS &amp; KITS</h1>
        <p class="help">Rolled for this match — know your enemies.</p>
        <div class="reveal-grid">
          ${players
            .map((p) => {
              const lo = p.loadout;
              const id = p.identity;
              const accent = id
                ? `rgb(${Math.round(id.accent[0] * 255)},${Math.round(id.accent[1] * 255)},${Math.round(id.accent[2] * 255)})`
                : lo
                  ? `rgb(${Math.round(lo.palette[0] * 255)},${Math.round(lo.palette[1] * 255)},${Math.round(lo.palette[2] * 255)})`
                  : "#888";
              const me = p.id === meId ? " me-card" : "";
              return `
              <div class="reveal-card${me}${p.isBot ? " bot-card" : ""}" style="--accent:${accent}">
                <div class="reveal-head">
                  <strong>${escapeHtml(p.name)}</strong>
                  <span class="reveal-badge">${p.isBot ? `BOT · ${escapeHtml(id ? personaLabel(id.persona) : "AI")}` : "YOU / HUMAN"}</span>
                </div>
                ${id ? `<div class="reveal-title">${escapeHtml(id.title)}</div>` : ""}
                ${id ? `<div class="reveal-motto">"${escapeHtml(id.motto)}"</div>` : ""}
                ${
                  lo
                    ? `<div class="reveal-kit">
                        <div><span class="k">Hull</span> ${escapeHtml(lo.chassis.name)}</div>
                        <div><span class="k">Gun</span> ${escapeHtml(lo.primary.name)}</div>
                        ${lo.secondary ? `<div><span class="k">Alt</span> ${escapeHtml(lo.secondary.name)}</div>` : ""}
                        <div class="reveal-stats">HP ${lo.chassis.maxHp} · ARM ${lo.chassis.armor} · DMG ${lo.primary.damage} · BLAST ${lo.primary.blastRadius}</div>
                      </div>`
                    : ""
                }
              </div>`;
            })
            .join("")}
        </div>
        <p class="help reveal-wait">Deploying to the arena…</p>
      </div>
    </div>
  `;
}

export function renderHud(
  root: HTMLElement,
  opts: {
    players: PlayerState[];
    meId: string | null;
    currentId: string | null;
    wind: number;
    turnTimeLeft: number;
    turnTimeMax?: number;
    phase: string;
    sandbox?: boolean;
    weaponIndex?: number;
    weaponCount?: number;
    mapName?: string;
    spectating?: boolean;
  },
): void {
  const me = opts.players.find((p) => p.id === opts.meId);
  const current = opts.players.find((p) => p.id === opts.currentId);
  const isMyTurn = !!(opts.meId && opts.currentId === opts.meId);
  const power = me?.power ?? 0;
  const powerPct = Math.max(0, Math.min(100, power));
  const maxT = opts.turnTimeMax ?? 30;
  const tLeft = Math.max(0, opts.turnTimeLeft);
  const tPct = Math.max(0, Math.min(100, (tLeft / maxT) * 100));
  const urgent = tLeft <= 8;
  const critical = tLeft <= 4;
  const timerClass = critical
    ? "timer critical"
    : urgent
      ? "timer urgent"
      : "timer";
  const amDead = !!me && !me.alive && !opts.sandbox;
  const spectating = !!opts.spectating || amDead;
  const canAct =
    (opts.sandbox || isMyTurn) &&
    opts.phase !== "resolving" &&
    !!me?.alive &&
    !spectating;
  const phaseLabel =
    opts.phase === "resolving"
      ? "SHELL IN FLIGHT"
      : opts.phase === "aim"
        ? "AIM"
        : opts.phase === "move"
          ? "MOVE / AIM"
          : opts.phase.toUpperCase();

  const w = me?.loadout?.primary;
  const alt = me?.loadout?.secondary;
  const altAmmo = me?.secondaryAmmo ?? 0;
  const weaponCard = w
    ? `
      <div class="hud-box weapon-card">
        <strong>WEAPON${opts.sandbox ? ` [${(opts.weaponIndex ?? 0) + 1}/${opts.weaponCount ?? 1}]` : ""}</strong>
        <div class="weapon-name">${escapeHtml(w.name)}</div>
        <div class="weapon-stats">DMG ${w.damage} · BLAST ${w.blastRadius} · SHELLS ${w.projectileCount} · AMMO ${
          w.id === "peashooter" || (me?.primaryAmmo ?? 0) >= 99
            ? "∞"
            : `${me?.primaryAmmo ?? "—"}/${w.maxAmmo}`
        }</div>
        <div class="weapon-behavior">${escapeHtml(formatBehavior(w))}</div>
        <div class="weapon-summary">${escapeHtml(w.summary ?? "")}</div>
        ${
          opts.sandbox
            ? `<div class="weapon-test">${escapeHtml(w.howToTest ?? "")}</div>
               <div class="weapon-keys">1–8 select · [ ] cycle · SPACE fire · R alt</div>`
            : alt
              ? `<div class="weapon-secondary ${altAmmo <= 0 ? "spent" : ""}">
                   <span class="weapon-secondary-label">ALT · R</span>
                   <span class="weapon-secondary-name">${escapeHtml(alt.name)}</span>
                   <span class="weapon-secondary-ammo">${altAmmo}/${alt.maxAmmo}</span>
                   ${altAmmo > 0 ? `<button type="button" class="btn-alt-fire" id="btn-fire-alt">FIRE ALT</button>` : `<span class="weapon-secondary-gone">SPENT</span>`}
                 </div>`
              : ""
        }
      </div>`
    : "";

  const turnTitle = opts.sandbox
    ? "SANDBOX"
    : isMyTurn
      ? "YOUR TURN"
      : `${escapeHtml(current?.name ?? "…")}'S TURN`;

  root.innerHTML = `
    <div class="hud">
      <div class="crt-overlay"></div>
      <div class="hud-top">
        <div class="hud-box wind-box">
          <strong>WIND</strong>
          <div class="wind-visual">
            <span class="wind-dir">${windArrow(opts.wind)}</span>
            <div class="wind-meter">
              <i style="width:${Math.min(100, Math.abs(opts.wind) / 1.8 * 100)}%;margin-left:${opts.wind >= 0 ? "50%" : "auto"};margin-right:${opts.wind < 0 ? "50%" : "auto"};transform:${opts.wind < 0 ? "scaleX(-1) translateX(100%)" : "none"}"></i>
            </div>
            <span class="wind-val">${opts.wind >= 0 ? "+" : ""}${opts.wind.toFixed(2)}</span>
          </div>
          <div class="muted wind-hint">Debris drifts with the wind</div>
          ${opts.mapName ? `<div class="map-chip">${escapeHtml(opts.mapName)}</div>` : ""}
        </div>
        <div class="hud-box ${timerClass}">
          <strong>${turnTitle}</strong>
          <div class="phase-label">${phaseLabel}</div>
          <div class="timer-row">
            <span class="timer-num">${Math.ceil(tLeft)}s</span>
            <div class="timer-bar"><i style="width:${tPct}%"></i></div>
          </div>
          ${
            isMyTurn && !opts.sandbox && !spectating
              ? `<button type="button" class="btn-pass" id="btn-pass">Pass (P)</button>`
              : ""
          }
        </div>
        <div class="hud-box player-list">
          <strong>TANKS</strong>
          ${opts.players
            .map((p) => {
              const cls = [
                p.id === opts.meId ? "me" : "",
                !p.alive ? "dead" : "",
                p.id === opts.currentId ? "turn" : "",
              ]
                .filter(Boolean)
                .join(" ");
              const wpn = p.loadout?.primary.name ?? "";
              const persona = p.identity
                ? personaLabel(p.identity.persona)
                : p.isBot
                  ? "Bot"
                  : "";
              return `<div class="${cls}">${escapeHtml(p.name)} ${Math.max(0, Math.ceil(p.hp))}hp <span class="muted">${escapeHtml(wpn)}${persona ? ` · ${escapeHtml(persona)}` : ""}</span></div>`;
            })
            .join("")}
        </div>
      </div>
      <div class="hud-bottom">
        ${
          spectating
            ? `<div class="hud-box spectate-box">
                <strong>SPECTATING</strong>
                <p class="spectate-copy">You're out — watch the rest of the match or leave.</p>
                <div class="spectate-actions">
                  <button type="button" class="btn-wide good" id="btn-spectate-stay">Keep watching</button>
                  <button type="button" class="secondary" id="btn-spectate-leave">Leave match</button>
                </div>
              </div>`
            : `
        <div class="hud-box">
          <strong>${escapeHtml(me?.loadout?.name ?? "Tank")}</strong>
          HP
          <div class="bar"><i style="width:${me ? (me.hp / (me.loadout?.chassis.maxHp ?? 1)) * 100 : 0}%"></i></div>
          Fuel
          <div class="bar fuel"><i style="width:${me ? (me.fuel / (me.loadout?.chassis.fuel ?? 1)) * 100 : 0}%"></i></div>
        </div>
        ${weaponCard}
        <div class="hud-box aim-box">
          <strong>AIM</strong>
          Angle ${me?.angle.toFixed(0) ?? "—"}° · Facing ${me?.facing === 1 ? "→" : "←"}
          <div class="power-label">POWER ${power.toFixed(0)}</div>
          <div class="power-bar live">
            <i style="width:${powerPct}%"></i>
          </div>
          <div class="power-controls">
            <button type="button" class="btn-power" id="btn-power-down" ${canAct ? "" : "disabled"} title="Lower power (Q)">−</button>
            <button type="button" class="btn-fire" id="btn-fire" ${canAct ? "" : "disabled"}>FIRE</button>
            <button type="button" class="btn-power" id="btn-power-up" ${canAct ? "" : "disabled"} title="Raise power (E)">+</button>
          </div>
          <div class="muted power-hint">Q/E set power · SPACE or FIRE to shoot</div>
          <span class="muted">A/D move · W/S angle · F flip${
            opts.sandbox ? " · Esc menu" : " · P pass"
          }</span>
        </div>`
        }
      </div>
    </div>
  `;
  // Buttons: pointerdown on #ui-root in main.ts (HUD rebuilds ~10×/s).
}

function formatBehavior(w: {
  behavior?: string;
  trajectory: string;
  projectileCount: number;
}): string {
  switch (w.behavior) {
    case "single":
      return "BEHAVIOR: 1 shell → 1 blast";
    case "lob":
      return "BEHAVIOR: high lob → 1 blast";
    case "drill":
      return "BEHAVIOR: low-G drill → deep shaft + undercut";
    case "homing":
      return "BEHAVIOR: rocket steers toward nearest enemy";
    case "special":
      return "BEHAVIOR: ALT special · usually 1 shot";
    case "bounce":
      return "BEHAVIOR: bounce ×2 → blast";
    case "cluster":
      return "BEHAVIOR: 1 flight → multi-blast at impact";
    case "triple":
      return "BEHAVIOR: 3 tight shells → 3 blasts";
    default:
      return `BEHAVIOR: ${w.trajectory} ×${w.projectileCount}`;
  }
}

export function renderResults(
  root: HTMLElement,
  rankings: MatchResultEntry[],
  onMenu: () => void,
): void {
  // Prefer explicit winner flag; fall back to place 1
  const winner =
    rankings.find((r) => r.isWinner) ??
    rankings.find((r) => r.place === 1) ??
    rankings[0];

  root.innerHTML = `
    <div class="screen results-screen">
      <div class="panel results-panel">
        <h1>MATCH OVER</h1>
        ${
          winner
            ? `<div class="winner-banner">
                <div class="winner-label">WINNER</div>
                <div class="winner-name">${escapeHtml(winner.name)}</div>
                <div class="winner-stats">
                  <div class="winner-stat">
                    <span class="winner-stat-val">${winner.kills}</span>
                    <span class="winner-stat-lbl">Kill${winner.kills === 1 ? "" : "s"}</span>
                  </div>
                  <div class="winner-stat">
                    <span class="winner-stat-val">${winner.damageDealt}</span>
                    <span class="winner-stat-lbl">Damage</span>
                  </div>
                  <div class="winner-stat">
                    <span class="winner-stat-val">${winner.score}</span>
                    <span class="winner-stat-lbl">Score</span>
                  </div>
                </div>
                <div class="winner-meta">${winner.isBot ? "CPU pilot" : "Human pilot"}</div>
              </div>`
            : ""
        }
        <h2>Final Standings</h2>
        <table class="results-table">
          <thead>
            <tr><th></th><th>Pilot</th><th>Kills</th><th>Damage</th><th>Score</th></tr>
          </thead>
          <tbody>
            ${rankings
              .map((r) => {
                const isWin = r.isWinner || r.place === 1;
                const medal =
                  r.place === 1 ? "🥇" : r.place === 2 ? "🥈" : r.place === 3 ? "🥉" : `${r.place}.`;
                return `
              <tr class="${isWin ? "winner-row" : ""}">
                <td class="place-cell">${medal}</td>
                <td>
                  <div class="results-name">${escapeHtml(r.name)}${isWin ? " 👑" : ""}</div>
                  ${r.isBot ? `<div class="results-sub">Bot</div>` : `<div class="results-sub">Human</div>`}
                </td>
                <td class="num-cell kills-cell">${r.kills}</td>
                <td class="num-cell">${r.damageDealt}</td>
                <td class="num-cell">${r.score}</td>
              </tr>`;
              })
              .join("")}
          </tbody>
        </table>
        <p class="help">Kills = opponents you eliminated (direct hit or crater/fall). Winner = last tank standing (or most kills if everyone is out).</p>
        <button id="btn-menu" class="good">Main Menu</button>
      </div>
    </div>
  `;
  root.querySelector("#btn-menu")?.addEventListener("click", onMenu);
}

export function renderLeaderboard(
  root: HTMLElement,
  entries: LeaderboardEntry[],
  onBack: () => void,
): void {
  root.innerHTML = `
    <div class="screen live-bg">
      <div class="panel live-panel">
        <h1>LEADERBOARD</h1>
        <table class="results-table">
          <thead>
            <tr><th>Name</th><th>W</th><th>K</th><th>Dmg</th><th>Score</th></tr>
          </thead>
          <tbody>
            ${
              entries.length === 0
                ? `<tr><td colspan="5">No matches recorded yet</td></tr>`
                : entries
                    .map(
                      (e) => `
              <tr>
                <td>${escapeHtml(e.name)}</td>
                <td>${e.wins}</td>
                <td>${e.kills}</td>
                <td>${e.damage}</td>
                <td>${e.score}</td>
              </tr>`,
                    )
                    .join("")
            }
          </tbody>
        </table>
        <button id="btn-back">Back</button>
      </div>
    </div>
  `;
  root.querySelector("#btn-back")?.addEventListener("click", onBack);
}

function windArrow(wind: number): string {
  if (Math.abs(wind) < 0.12) return "≈ calm";
  const n = Math.min(4, Math.max(1, Math.ceil(Math.abs(wind) * 1.6)));
  return wind > 0 ? "→".repeat(n) : "←".repeat(n);
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
