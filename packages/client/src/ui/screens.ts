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
    /** Audio mute */
    muted: boolean;
    onMuteChange: (muted: boolean) => void;
    /** Bot skill for new matches */
    botDifficulty: "easy" | "normal" | "hard";
    onBotDifficulty: (d: "easy" | "normal" | "hard") => void;
    /** Resume mid-match if we still have a room id */
    resumeRoomId?: string | null;
    onResumeMatch?: () => void;
  },
): void {
  const diff = opts.botDifficulty;
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
              ${
                opts.resumeRoomId && opts.onResumeMatch
                  ? `<button id="btn-resume" class="btn-wide btn-resume" type="button">Resume last match</button>`
                  : ""
              }
            </div>
          </section>

          <section class="menu-card menu-card-join">
            <h3 class="menu-card-title">Join with code</h3>
            <div class="join-code-form">
              <input id="join-code" type="text" maxlength="8" placeholder="ABCD12" spellcheck="false" />
              <button id="btn-join-code" class="secondary">Join</button>
            </div>
          </section>

          <section class="menu-card menu-card-settings">
            <h3 class="menu-card-title">Settings</h3>
            <div class="settings-row">
              <label class="settings-toggle">
                <input type="checkbox" id="chk-mute" ${opts.muted ? "checked" : ""} />
                <span>Mute sound</span>
              </label>
            </div>
            <div class="settings-row">
              <span class="settings-label">Bot difficulty</span>
              <div class="diff-pills" role="group" aria-label="Bot difficulty">
                <button type="button" class="diff-pill ${diff === "easy" ? "active" : ""}" data-diff="easy">Easy</button>
                <button type="button" class="diff-pill ${diff === "normal" ? "active" : ""}" data-diff="normal">Normal</button>
                <button type="button" class="diff-pill ${diff === "hard" ? "active" : ""}" data-diff="hard">Hard</button>
              </div>
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
          <span>Q/E power · Space fire · A/D move · W/S angle · M mute</span>
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
  root.querySelector("#btn-resume")?.addEventListener("click", () => {
    opts.onResumeMatch?.();
  });
  root.querySelector("#chk-mute")?.addEventListener("change", (e) => {
    opts.onMuteChange((e.target as HTMLInputElement).checked);
  });
  root.querySelectorAll("[data-diff]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const d = (btn as HTMLElement).dataset.diff as "easy" | "normal" | "hard";
      opts.onBotDifficulty(d);
    });
  });
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
                        : "Mini Nuke";
                      const ammo = String(lo.primary.maxAmmo);
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
                  <span class="char-wpn-label">ALT · R · ×1</span>
                  <span class="char-wpn-name">${alt}</span>
                  ${
                    lo.secondary
                      ? `<span class="char-wpn-meta">DMG ${lo.secondary.damage} · BLAST ${lo.secondary.blastRadius} · ONCE</span>
                         <span class="char-wpn-sum">${escapeHtml(lo.secondary.summary)}</span>`
                      : `<span class="char-wpn-meta">Once per match · huge lob blast</span>`
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
      ? "FIRING"
      : opts.phase === "aim"
        ? "AIM"
        : opts.phase === "move"
          ? "MOVE"
          : opts.phase.toUpperCase();

  const w = me?.loadout?.primary;
  const alt = me?.loadout?.secondary;
  const altAmmo = me?.secondaryAmmo ?? 0;
  // Ammo only when finite — skip ∞ noise in the dock
  const primaryAmmo =
    w && w.id !== "peashooter" && (me?.primaryAmmo ?? 0) < 99
      ? `${me?.primaryAmmo ?? "—"}/${w.maxAmmo}`
      : null;
  const hpPct = me
    ? (me.hp / (me.loadout?.chassis.maxHp ?? 1)) * 100
    : 0;
  const fuelPct = me
    ? (me.fuel / (me.loadout?.chassis.fuel ?? 1)) * 100
    : 0;
  const hpVal = me ? Math.max(0, Math.ceil(me.hp)) : "—";

  const turnTitle = opts.sandbox
    ? "SANDBOX"
    : isMyTurn
      ? "YOUR TURN"
      : `${escapeHtml(current?.name ?? "…")}'S TURN`;
  const showPass = isMyTurn && !opts.sandbox && !spectating;
  const dockTone = isMyTurn ? " dock-mine" : "";
  const gunTitle = w
    ? `${w.name}${w.summary ? ` — ${w.summary}` : ""}`
    : "";

  // Compact dock: no DMG/BLAST (known at kit select). Weapon once: name + ammo.
  // Players panel is name/HP only (no gun list).
  const dock = spectating
    ? `
    <div class="dock ${timerClass}">
      <div class="dock-main">
        <div class="dock-turn">
          <span class="dock-turn-who">${turnTitle}</span>
          <span class="dock-turn-meta">
            <span class="dock-phase">${phaseLabel}</span>
            <span class="dock-clock">${Math.ceil(tLeft)}s</span>
          </span>
          <div class="dock-clock-bar"><i style="width:${tPct}%"></i></div>
        </div>
        <div class="dock-spectate">
          <span class="dock-spectate-label">SPECTATING</span>
          <div class="dock-spectate-actions">
            <button type="button" class="dock-btn dock-btn-good" id="btn-spectate-stay">Watch</button>
            <button type="button" class="dock-btn dock-btn-ghost" id="btn-spectate-leave">Leave</button>
          </div>
        </div>
      </div>
    </div>`
    : `
    <div class="dock ${timerClass}${dockTone}">
      <div class="dock-main">
        <div class="dock-turn">
          <span class="dock-turn-who">${turnTitle}</span>
          <span class="dock-turn-meta">
            <span class="dock-phase">${phaseLabel}</span>
            <span class="dock-clock">${Math.ceil(tLeft)}s</span>
          </span>
          <div class="dock-clock-bar"><i style="width:${tPct}%"></i></div>
        </div>

        <div class="dock-vitals" title="${escapeHtml(me?.loadout?.name ?? "Tank")}">
          <div class="dock-meter">
            <span class="dock-meter-lbl">HP</span>
            <div class="dock-meter-track"><i style="width:${hpPct}%"></i></div>
            <span class="dock-meter-val">${hpVal}</span>
          </div>
          <div class="dock-meter">
            <span class="dock-meter-lbl">FUEL</span>
            <div class="dock-meter-track fuel"><i style="width:${fuelPct}%"></i></div>
          </div>
        </div>

        <div class="dock-gun" title="${escapeHtml(gunTitle)}">
          <span class="dock-gun-name">${
            w ? escapeHtml(w.name) : "—"
          }${
            opts.sandbox
              ? ` <span class="dock-gun-idx">${(opts.weaponIndex ?? 0) + 1}/${opts.weaponCount ?? 1}</span>`
              : ""
          }</span>
          ${primaryAmmo ? `<span class="dock-gun-ammo">${primaryAmmo}</span>` : ""}
          ${
            !opts.sandbox && alt
              ? altAmmo > 0
                ? `<button type="button" class="dock-btn dock-btn-alt" id="btn-fire-alt" title="${escapeHtml(alt.name)} · ${altAmmo}/${alt.maxAmmo}">R ${escapeHtml(alt.name)}</button>`
                : `<span class="dock-gun-spent" title="${escapeHtml(alt.name)}">R —</span>`
              : ""
          }
        </div>

        <div class="dock-aim-readout">
          <span class="dock-angle">${me?.angle.toFixed(0) ?? "—"}°</span>
          <span class="dock-facing">${me?.facing === 1 ? "→" : "←"}</span>
        </div>

        <div class="dock-power">
          <span class="dock-power-val">${power.toFixed(0)}</span>
          <div class="dock-power-track"><i style="width:${powerPct}%"></i></div>
        </div>

        <div class="dock-fire-group">
          <button type="button" class="dock-btn dock-btn-pwr" id="btn-power-down" ${canAct ? "" : "disabled"} title="Lower power (Q)">−</button>
          <button type="button" class="dock-btn dock-btn-fire" id="btn-fire" ${canAct ? "" : "disabled"}>FIRE</button>
          <button type="button" class="dock-btn dock-btn-pwr" id="btn-power-up" ${canAct ? "" : "disabled"} title="Raise power (E)">+</button>
        </div>

        ${
          opts.sandbox
            ? `<div class="dock-util">
                 <button type="button" class="dock-btn dock-btn-respawn" id="btn-sandbox-respawn" title="Respawn tanks at pads">RESPAWN</button>
               </div>`
            : showPass
              ? `<div class="dock-util">
                   <button type="button" class="dock-btn dock-btn-pass" id="btn-pass">PASS</button>
                 </div>`
              : ""
        }
      </div>
    </div>`;

  const windMag = Math.min(100, (Math.abs(opts.wind) / 1.8) * 100);
  const windMeterStyle = `width:${windMag}%;margin-left:${
    opts.wind >= 0 ? "50%" : "auto"
  };margin-right:${opts.wind < 0 ? "50%" : "auto"};transform:${
    opts.wind < 0 ? "scaleX(-1) translateX(100%)" : "none"
  }`;

  const sandboxCard = opts.sandbox
    ? `
    <aside class="sandbox-card" aria-label="Sandbox controls">
      <strong class="sandbox-card-title">SANDBOX</strong>
      <ul class="sandbox-card-list">
        <li><kbd>1</kbd>–<kbd>8</kbd> weapons</li>
        <li><kbd>[</kbd> <kbd>]</kbd> cycle gun</li>
        <li><kbd>Space</kbd> fire · <kbd>R</kbd> alt</li>
        <li><kbd>Q</kbd>/<kbd>E</kbd> power</li>
        <li><kbd>A</kbd>/<kbd>D</kbd> move · <kbd>W</kbd>/<kbd>S</kbd> angle</li>
        <li><kbd>F</kbd> flip · click dig</li>
        <li><kbd>Esc</kbd> menu</li>
      </ul>
      <p class="sandbox-card-hint">∞ ammo · RESPAWN in dock</p>
    </aside>`
    : "";

  root.innerHTML = `
    <div class="hud">
      <div class="crt-overlay"></div>
      <div class="hud-top">
        <div class="hud-top-left">
          <div class="hud-box wind-box">
            <div class="wind-row">
              <strong>WIND</strong>
              <span class="wind-dir">${windArrow(opts.wind)}</span>
              <div class="wind-meter">
                <i style="${windMeterStyle}"></i>
              </div>
              <span class="wind-val">${opts.wind >= 0 ? "+" : ""}${opts.wind.toFixed(2)}</span>
            </div>
          </div>
          ${sandboxCard}
        </div>
        <div class="hud-box player-list">
          <div class="player-list-head">
            <strong>PLAYERS</strong>
            ${opts.mapName ? `<span class="map-chip">${escapeHtml(opts.mapName)}</span>` : ""}
          </div>
          ${opts.players
            .map((p) => {
              const cls = [
                "player-row",
                p.id === opts.meId ? "me" : "",
                !p.alive ? "dead" : "",
                p.id === opts.currentId ? "turn" : "",
              ]
                .filter(Boolean)
                .join(" ");
              return `<div class="${cls}"><span class="player-name">${escapeHtml(p.name)}</span><span class="player-hp">${Math.max(0, Math.ceil(p.hp))}</span></div>`;
            })
            .join("")}
        </div>
      </div>
      <div class="hud-bottom">
        ${dock}
      </div>
    </div>
  `;
  // Buttons: pointerdown on #ui-root in main.ts (HUD rebuilds ~10×/s).
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
