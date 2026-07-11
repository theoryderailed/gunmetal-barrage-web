/**
 * Turn banner + toast live outside the HUD rebuild loop.
 * Rebuilding HUD every ~100ms was re-mounting the banner and replaying
 * CSS enter animations → flash in/out.
 */

let layer: HTMLElement | null = null;
let lastBanner = "";
let lastToast = "";
let lastMine = false;

function ensureLayer(parent: HTMLElement): HTMLElement {
  if (layer && layer.isConnected) return layer;
  layer = document.createElement("div");
  layer.id = "notify-layer";
  layer.setAttribute("aria-live", "polite");
  parent.appendChild(layer);
  lastBanner = "";
  lastToast = "";
  return layer;
}

export function updateNotifications(
  parent: HTMLElement,
  opts: {
    banner?: string;
    toast?: string;
    isMyTurn?: boolean;
    visible: boolean;
  },
): void {
  const el = ensureLayer(parent);

  if (!opts.visible) {
    if (lastBanner || lastToast) {
      el.innerHTML = "";
      el.classList.add("hidden");
      lastBanner = "";
      lastToast = "";
    }
    return;
  }

  el.classList.remove("hidden");

  const banner = opts.banner ?? "";
  const toast = opts.toast ?? "";
  const mine = !!opts.isMyTurn;

  // Only touch the DOM when content actually changes
  if (banner === lastBanner && toast === lastToast && mine === lastMine) {
    return;
  }

  const prevBanner = lastBanner;
  lastBanner = banner;
  lastToast = toast;
  lastMine = mine;

  // Banner: animate only when the message text is new (not on every HUD tick)
  const bannerAnimate = banner && banner !== prevBanner;

  el.innerHTML = `
    ${
      banner
        ? `<div class="turn-banner ${mine ? "mine" : ""}${bannerAnimate ? " anim" : ""}">${escapeHtml(banner)}</div>`
        : ""
    }
    ${toast ? `<div class="toast">${escapeHtml(toast)}</div>` : ""}
  `;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
