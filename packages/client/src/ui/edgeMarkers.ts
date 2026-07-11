import type { PlayerState } from "@gunmetal-barrage/shared";
import type { GameRenderer } from "../render/GameRenderer";

export interface EdgeMarker {
  id: string;
  name: string;
  /** CSS color */
  color: string;
  /** Screen position (px) */
  x: number;
  y: number;
  /** Arrow rotation (radians) — points toward the player */
  angle: number;
  isTurn: boolean;
  isMe: boolean;
  hpRatio: number;
  /** Rough distance in world units (for label scale) */
  dist: number;
}

const EDGE_PAD = 36;
const VIEW_MARGIN = 48;

/**
 * Build edge-of-screen markers for tanks that are outside the current view.
 */
export function computeEdgeMarkers(
  renderer: GameRenderer,
  players: PlayerState[],
  meId: string | null,
  currentId: string | null,
): EdgeMarker[] {
  const midZ = renderer.getMidZ();
  const w = window.innerWidth;
  const h = window.innerHeight;
  const cx = w * 0.5;
  const cy = h * 0.5;

  // Camera focus as distance reference
  const focus = renderer.getCameraFocus();
  const out: EdgeMarker[] = [];

  for (const p of players) {
    if (!p.alive) continue;

    const projected = renderer.projectWorldToScreen(p.x, p.y + 1.2, midZ + 0.5);
    if (!projected) continue;

    const { sx, sy, behind } = projected;
    const onScreen =
      !behind &&
      sx >= VIEW_MARGIN &&
      sx <= w - VIEW_MARGIN &&
      sy >= VIEW_MARGIN &&
      sy <= h - VIEW_MARGIN;

    if (onScreen) continue;

    // Direction from screen center toward projected point (flip if behind camera)
    let dx = sx - cx;
    let dy = sy - cy;
    if (behind) {
      dx = -dx;
      dy = -dy;
    }
    // Degenerate: stack slightly so we still get a marker
    if (Math.abs(dx) < 0.001 && Math.abs(dy) < 0.001) {
      dx = p.x >= focus.x ? 1 : -1;
      dy = -0.2;
    }

    const edge = clampRayToRect(cx, cy, dx, dy, w, h, EDGE_PAD);
    const angle = Math.atan2(dy, dx);
    const palette = p.loadout?.palette ?? [0.5, 0.7, 1];
    const color = rgbCss(palette[0], palette[1], palette[2]);
    const maxHp = p.loadout?.chassis.maxHp ?? 100;

    out.push({
      id: p.id,
      name: p.name,
      color,
      x: edge.x,
      y: edge.y,
      angle,
      isTurn: p.id === currentId,
      isMe: p.id === meId,
      hpRatio: Math.max(0, Math.min(1, p.hp / maxHp)),
      dist: Math.hypot(p.x - focus.x, p.y - focus.y),
    });
  }

  return out;
}

/** Intersect ray from (ox,oy) along (dx,dy) with inset screen rect. */
function clampRayToRect(
  ox: number,
  oy: number,
  dx: number,
  dy: number,
  w: number,
  h: number,
  pad: number,
): { x: number; y: number } {
  const left = pad;
  const right = w - pad;
  const top = pad;
  const bottom = h - pad;

  // Normalize direction
  const len = Math.hypot(dx, dy) || 1;
  const nx = dx / len;
  const ny = dy / len;

  // Find smallest positive t hitting a side
  let bestT = Infinity;
  if (nx > 0.0001) bestT = Math.min(bestT, (right - ox) / nx);
  if (nx < -0.0001) bestT = Math.min(bestT, (left - ox) / nx);
  if (ny > 0.0001) bestT = Math.min(bestT, (bottom - oy) / ny);
  if (ny < -0.0001) bestT = Math.min(bestT, (top - oy) / ny);

  if (!Number.isFinite(bestT) || bestT < 0) {
    return {
      x: Math.max(left, Math.min(right, ox + dx)),
      y: Math.max(top, Math.min(bottom, oy + dy)),
    };
  }

  return {
    x: Math.max(left, Math.min(right, ox + nx * bestT)),
    y: Math.max(top, Math.min(bottom, oy + ny * bestT)),
  };
}

function rgbCss(r: number, g: number, b: number): string {
  // Boost saturation slightly so markers pop on the CRT overlay
  const boost = (c: number) => Math.min(255, Math.round(c * 255 * 1.15 + 20));
  return `rgb(${boost(r)}, ${boost(g)}, ${boost(b)})`;
}

let layer: HTMLElement | null = null;

export function ensureEdgeMarkerLayer(parent: HTMLElement): HTMLElement {
  if (layer && layer.isConnected) return layer;
  layer = document.createElement("div");
  layer.id = "edge-markers";
  layer.setAttribute("aria-hidden", "true");
  parent.appendChild(layer);
  return layer;
}

export function updateEdgeMarkerLayer(
  parent: HTMLElement,
  markers: EdgeMarker[],
  visible: boolean,
): void {
  const el = ensureEdgeMarkerLayer(parent);
  if (!visible || markers.length === 0) {
    el.classList.add("hidden");
    el.innerHTML = "";
    return;
  }
  el.classList.remove("hidden");
  el.innerHTML = markers
    .map((m) => {
      const deg = (m.angle * 180) / Math.PI;
      const label = m.name.length > 10 ? m.name.slice(0, 9) + "…" : m.name;
      const turn = m.isTurn ? " turn" : "";
      const me = m.isMe ? " me" : "";
      return `
      <div class="edge-marker${turn}${me}" style="left:${m.x}px;top:${m.y}px;--mk:${m.color}">
        <div class="edge-arrow" style="transform:rotate(${deg}rad)"></div>
        <div class="edge-label">
          <span class="edge-name">${escapeHtml(label)}</span>
          <span class="edge-hp"><i style="width:${m.hpRatio * 100}%"></i></span>
        </div>
      </div>`;
    })
    .join("");
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
