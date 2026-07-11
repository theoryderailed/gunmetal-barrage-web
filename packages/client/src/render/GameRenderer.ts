import * as THREE from "three";
import {
  generateMap,
  simulateWeaponFire,
  type MatchConfig,
  type PlayerState,
  type TerrainOp,
  type VoxelWorld,
  type WeaponDef,
  VoxelMaterial,
} from "@gunmetal-barrage/shared";
import { VoxelMeshManager } from "./VoxelMesh";
import { TankMesh } from "./TankMesh";
import { Environment } from "./Environment";
import {
  createShellMesh,
  explosionProfileFor,
  shellStyleFor,
  trailProfileFor,
  type ShellStyle,
} from "./WeaponVisuals";

type FlightShell = {
  mesh: THREE.Group;
  path: { x: number; y: number; z: number }[];
};

/** Fraction of the simulated path shown while aiming (direction hint only). */
const AIM_PREVIEW_FRACTION = 0.28;
/** Cap preview length in world units so long shots don't leak the landing. */
const AIM_PREVIEW_MAX_DIST = 26;

/**
 * Keep only the early arc so players read angle/power without a free reticle.
 */
function clipAimPreview(
  path: { x: number; y: number; z: number }[],
): { x: number; y: number; z: number }[] {
  if (path.length < 2) return path;
  const byFrac = Math.max(6, Math.floor(path.length * AIM_PREVIEW_FRACTION));
  let dist = 0;
  let byDist = 1;
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1]!;
    const b = path[i]!;
    dist += Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
    byDist = i + 1;
    if (dist >= AIM_PREVIEW_MAX_DIST) break;
  }
  const n = Math.min(path.length, byFrac, byDist);
  return path.slice(0, Math.max(2, n));
}

export class GameRenderer {
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly renderer: THREE.WebGLRenderer;
  private voxels = new VoxelMeshManager();
  private tanks = new Map<string, TankMesh>();
  private trajectoryLine: THREE.Line;
  private trajectoryMarkers = new THREE.Group();
  private projectileRoot = new THREE.Group();
  private trail: THREE.Points;
  private trailPositions: Float32Array;
  private trailIndex = 0;
  private world: VoxelWorld | null = null;
  private midZ = 6;
  private cameraTarget = new THREE.Vector3();
  /** Desired camera distance from target (Z offset); grows for high arcs. */
  private cameraDistance = 75;
  private idleCameraDistance = 75;
  private animProjectile: {
    shells: FlightShell[];
    t0: number;
    duration: number;
    onImpact?: () => void;
    peakY: number;
    style: ShellStyle;
    color: number;
    lastBounceSparkAt: number;
    trailEvery: number;
    frame: number;
  } | null = null;
  private floatingTexts: {
    sprite: THREE.Sprite;
    t0: number;
    duration: number;
    startY: number;
  }[] = [];
  private shakeUntil = 0;
  private shakeAmp = 0;
  /** Hold focus on impact point briefly after landing. */
  private impactHoldUntil = 0;
  private env: Environment;
  private hemiLight: THREE.HemisphereLight;
  private sunLight: THREE.DirectionalLight;
  private clock = new THREE.Clock();
  private mapWidth = 192;
  private mapHeight = 96;
  private mapName = "";
  /** Match intro: wide shot → tank drops → zoom to first pilot */
  private intro: {
    t0: number;
    firstPlayerId: string | null;
    drops: { id: string; x: number; groundY: number; fromY: number }[];
    done: boolean;
  } | null = null;
  private cameraLockedByIntro = false;

  constructor(canvas: HTMLCanvasElement) {
    this.camera = new THREE.PerspectiveCamera(40, 1, 0.1, 500);
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: false,
      powerPreference: "high-performance",
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setClearColor(0x87b5d9);
    this.renderer.shadowMap.enabled = true;

    this.scene.fog = new THREE.Fog(0x87b5d9, 80, 220);
    this.scene.add(this.voxels.group);

    this.hemiLight = new THREE.HemisphereLight(0xb8d4ff, 0x3a2a18, 0.85);
    this.scene.add(this.hemiLight);
    this.sunLight = new THREE.DirectionalLight(0xfff0d0, 1.1);
    this.sunLight.position.set(40, 80, 30);
    this.sunLight.castShadow = true;
    this.scene.add(this.sunLight);

    this.env = new Environment(this.scene);
    this.env.attachLights(this.hemiLight, this.sunLight);

    const trajGeo = new THREE.BufferGeometry();
    const trajMat = new THREE.LineDashedMaterial({
      color: 0xffe066,
      transparent: true,
      opacity: 0.9,
      dashSize: 1.2,
      gapSize: 0.7,
    });
    this.trajectoryLine = new THREE.Line(trajGeo, trajMat);
    this.trajectoryLine.visible = false;
    this.scene.add(this.trajectoryLine);
    this.scene.add(this.trajectoryMarkers);

    this.projectileRoot.visible = false;
    this.scene.add(this.projectileRoot);

    // Flight trail buffer (resized per weapon)
    const trailCount = 64;
    this.trailPositions = new Float32Array(trailCount * 3);
    const trailGeo = new THREE.BufferGeometry();
    trailGeo.setAttribute(
      "position",
      new THREE.BufferAttribute(this.trailPositions, 3),
    );
    this.trail = new THREE.Points(
      trailGeo,
      new THREE.PointsMaterial({
        color: 0xffaa44,
        size: 0.45,
        transparent: true,
        opacity: 0.9,
        depthWrite: false,
        sizeAttenuation: true,
      }),
    );
    this.trail.visible = false;
    this.scene.add(this.trail);

    this.resize();
    window.addEventListener("resize", () => this.resize());
  }

  resize(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h, false);
  }

  loadMatch(seed: number, config: MatchConfig, players: PlayerState[]): void {
    const map = generateMap(seed, config);
    this.world = map.world;
    this.midZ = Math.floor(config.mapDepth / 2);
    this.mapWidth = config.mapWidth;
    this.mapHeight = config.mapHeight;
    this.mapName = map.name;
    this.voxels.setWorld(this.world);
    this.intro = null;
    this.cameraLockedByIntro = false;

    // Theme sky / hills / fog / lights
    this.renderer.setClearColor(map.theme.fog);
    if (this.scene.fog instanceof THREE.Fog) {
      this.scene.fog.color.setHex(map.theme.fog);
      this.scene.fog.near = 80;
      this.scene.fog.far = 240;
    }
    this.env.configure(
      config.mapWidth,
      config.mapHeight,
      this.midZ,
      map.theme,
    );

    for (const tank of this.tanks.values()) {
      this.scene.remove(tank.group);
      tank.dispose();
    }
    this.tanks.clear();

    for (const p of players) {
      if (!p.loadout) continue;
      const tank = new TankMesh(p);
      tank.setDepth(this.midZ);
      this.tanks.set(p.id, tank);
      this.scene.add(tank.group);
    }

    this.syncPlayers(players, { hardSnap: true });

    // Full-map establishing shot
    this.frameFullMap(true);
  }

  getMapName(): string {
    return this.mapName;
  }

  setWind(wind: number): void {
    this.env.setWind(wind);
  }

  /** Distance needed to fit the full arena in view (with padding). */
  private fullMapCameraDistance(): number {
    const aspect = Math.max(0.5, this.camera.aspect || 16 / 9);
    const vFov = (this.camera.fov * Math.PI) / 180;
    const hFov = 2 * Math.atan(Math.tan(vFov / 2) * aspect);
    const pad = 1.2; // margin so edges aren't clipped
    const distW = (this.mapWidth * pad) / 2 / Math.tan(hFov / 2);
    const distH = (this.mapHeight * pad) / 2 / Math.tan(vFov / 2);
    return Math.max(distW, distH, 120);
  }

  /** Wide camera covering the whole arena. */
  frameFullMap(instant = false): void {
    const cx = this.mapWidth / 2;
    const cy = Math.max(28, this.mapHeight * 0.42);
    this.cameraTarget.set(cx, cy, this.midZ);
    this.cameraDistance = this.fullMapCameraDistance();
    // Keep idle separate — do NOT overwrite with wide distance permanently
    if (instant) {
      this.camera.position.set(
        cx,
        cy + 10,
        this.midZ + this.cameraDistance,
      );
      this.camera.lookAt(this.cameraTarget);
      this.camera.updateProjectionMatrix();
    }
  }

  /**
   * Soft pan used by the menu/lobby ambient demo.
   * Keeps a wide framing while drifting across the arena.
   */
  panAmbient(x: number, y: number, dt: number): void {
    if (this.animProjectile || this.isIntroPlaying()) return;
    const k = 1 - Math.exp(-2.2 * dt);
    this.cameraTarget.x += (x - this.cameraTarget.x) * k;
    this.cameraTarget.y += (y - this.cameraTarget.y) * k;
    this.cameraTarget.z = this.midZ;
    const wide = this.fullMapCameraDistance() * 0.88;
    this.cameraDistance += (wide - this.cameraDistance) * k;
  }

  /**
   * Intro sequence: hold wide shot → tanks drop from sky → zoom to first pilot.
   * Returns total duration in ms.
   */
  playMatchIntro(
    players: PlayerState[],
    firstPlayerId: string | null,
  ): number {
    const DROP_HEIGHT = 38;
    const drops: { id: string; x: number; groundY: number; fromY: number }[] =
      [];

    for (const p of players) {
      if (!p.alive && p.hp <= 0) continue;
      const tank = this.tanks.get(p.id);
      if (!tank) continue;
      const groundY = p.y;
      const fromY = groundY + DROP_HEIGHT;
      drops.push({ id: p.id, x: p.x, groundY, fromY });
      // Park visual high above spawn; logical pos stays on ground
      tank.setIntroPose(p.x, fromY, this.midZ);
    }

    // Wider FOV for the establishing shot, restored after intro
    this.camera.fov = 48;
    this.camera.updateProjectionMatrix();
    // Push fog back so the far ends of the map stay visible
    if (this.scene.fog instanceof THREE.Fog) {
      this.scene.fog.near = 200;
      this.scene.fog.far = 600;
    }

    this.frameFullMap(true);
    this.cameraLockedByIntro = true;
    this.intro = {
      t0: performance.now(),
      firstPlayerId,
      drops,
      done: false,
    };

    // overview 1.4s + drop 1.6s + settle 0.35s + zoom 1.8s
    return 1400 + 1600 + 350 + 1800;
  }

  isIntroPlaying(): boolean {
    return this.intro !== null && !this.intro.done;
  }

  getWorld(): VoxelWorld | null {
    return this.world;
  }

  getMidZ(): number {
    return this.midZ;
  }

  getCameraFocus(): { x: number; y: number; z: number } {
    return {
      x: this.cameraTarget.x,
      y: this.cameraTarget.y,
      z: this.cameraTarget.z,
    };
  }

  /**
   * Project a world point to CSS pixel coords (top-left origin).
   * `behind` is true when the point is behind the camera near plane.
   */
  projectWorldToScreen(
    x: number,
    y: number,
    z: number,
  ): { sx: number; sy: number; behind: boolean } | null {
    const v = new THREE.Vector3(x, y, z);
    v.project(this.camera);
    if (!Number.isFinite(v.x) || !Number.isFinite(v.y) || !Number.isFinite(v.z)) {
      return null;
    }
    const w = window.innerWidth;
    const h = window.innerHeight;
    return {
      sx: (v.x * 0.5 + 0.5) * w,
      sy: (-v.y * 0.5 + 0.5) * h,
      behind: v.z > 1,
    };
  }

  syncPlayers(players: PlayerState[], opts?: { hardSnap?: boolean }): void {
    for (const p of players) {
      let tank = this.tanks.get(p.id);
      if (!tank && p.loadout) {
        tank = new TankMesh(p);
        tank.setDepth(this.midZ);
        this.tanks.set(p.id, tank);
        this.scene.add(tank.group);
      }
      tank?.sync(p);
      if (tank) {
        tank.setDepth(this.midZ);
        if (opts?.hardSnap) tank.snapDisplay();
      }
    }
  }

  applyTerrainOps(ops: TerrainOp[], weapon?: WeaponDef): void {
    if (!this.world || ops.length === 0) return;
    const dirty = new Set<string>();
    for (const op of ops) {
      const keys =
        op.kind === "ellipsoid"
          ? this.world.stampEllipsoid(
              Math.round(op.x),
              Math.round(op.y),
              Math.round(op.z),
              op.radius,
              op.radiusY ?? op.radius,
              op.radiusZ ?? op.radius,
              op.material ?? VoxelMaterial.Air,
              true,
            )
          : this.world.stampSphere(
              Math.round(op.x),
              Math.round(op.y),
              Math.round(op.z),
              op.radius,
              op.material ?? VoxelMaterial.Air,
              true,
            );
      for (const k of keys) dirty.add(k);
      for (const k of keys) {
        const [cx, cy, cz] = k.split(",").map(Number);
        for (let dx = -1; dx <= 1; dx++) {
          for (let dy = -1; dy <= 1; dy++) {
            for (let dz = -1; dz <= 1; dz++) {
              dirty.add(`${cx! + dx},${cy! + dy},${cz! + dz}`);
            }
          }
        }
      }
    }
    this.voxels.rebuildDirty(dirty);

    const style = shellStyleFor(weapon);
    const color = weapon?.color ?? 0xff8844;
    // Drill stacks several stamps — only VFX the mouth + a couple punches
    const vfxOps =
      style === "drill" ? ops.filter((_, i) => i === 0 || i === ops.length - 1 || i === 1) : ops;
    const stagger =
      style === "scatter" || style === "triple" ? 85 : style === "drill" ? 60 : 0;
    vfxOps.forEach((op, i) => {
      window.setTimeout(() => {
        this.spawnExplosion(op, color, style);
      }, i * stagger);
    });
    const primary = ops[0]!;
    const shakeMul =
      style === "nuke" ? 1.8 : style === "howitzer" ? 1.25 : style === "triple" ? 1.15 : 1;
    this.shake(0.5 * shakeMul, (0.3 + primary.radius * 0.1) * shakeMul);
  }

  private spawnExplosion(
    op: TerrainOp,
    color = 0xff8844,
    style: ShellStyle = "pea",
  ): void {
    const profile = explosionProfileFor(style, color);
    const count = profile.count;
    const geo = new THREE.BufferGeometry();
    const positions = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      positions[i * 3] = op.x;
      positions[i * 3 + 1] = op.y;
      positions[i * 3 + 2] = op.z;
    }
    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    const mat = new THREE.PointsMaterial({
      color,
      size: profile.size,
      transparent: true,
      opacity: 1,
      depthWrite: false,
    });
    const points = new THREE.Points(geo, mat);
    this.scene.add(points);

    const flash = new THREE.Mesh(
      new THREE.SphereGeometry(Math.max(1.0, op.radius * 0.55), 12, 12),
      new THREE.MeshBasicMaterial({
        color: profile.flashColor,
        transparent: true,
        opacity: 0.95,
      }),
    );
    flash.position.set(op.x, op.y, op.z);
    this.scene.add(flash);

    let ring: THREE.Mesh | null = null;
    if (profile.ring) {
      ring = new THREE.Mesh(
        new THREE.RingGeometry(op.radius * 0.3, op.radius * 0.95, 24),
        new THREE.MeshBasicMaterial({
          color: profile.flashColor,
          transparent: true,
          opacity: 0.85,
          side: THREE.DoubleSide,
          depthWrite: false,
        }),
      );
      ring.rotation.x = -Math.PI / 2;
      ring.position.set(op.x, op.y + 0.2, op.z);
      this.scene.add(ring);
    }

    const velocities = Array.from({ length: count }, () => ({
      x: (Math.random() - 0.5) * (profile.spread + op.radius),
      y:
        Math.random() *
        (10 + op.radius * 0.5) *
        (style === "drill" ? 0.45 : 1),
      z: (Math.random() - 0.5) * (profile.spread * 0.7 + op.radius),
    }));
    const t0 = performance.now();
    const life = profile.life;
    const tick = () => {
      const t = (performance.now() - t0) / 1000;
      if (t > life) {
        this.scene.remove(points);
        this.scene.remove(flash);
        if (ring) this.scene.remove(ring);
        geo.dispose();
        mat.dispose();
        flash.geometry.dispose();
        (flash.material as THREE.Material).dispose();
        if (ring) {
          ring.geometry.dispose();
          (ring.material as THREE.Material).dispose();
        }
        return;
      }
      const pos = geo.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < count; i++) {
        const v = velocities[i]!;
        pos.setXYZ(
          i,
          op.x + v.x * t,
          op.y + v.y * t - 10 * t * t,
          op.z + v.z * t,
        );
      }
      pos.needsUpdate = true;
      mat.opacity = 1 - t / life;
      flash.scale.setScalar(1 + t * profile.flashScale);
      (flash.material as THREE.MeshBasicMaterial).opacity = Math.max(
        0,
        0.95 - t * (0.95 / life),
      );
      if (ring) {
        const rs = 1 + t * 2.8;
        ring.scale.set(rs, rs, rs);
        (ring.material as THREE.MeshBasicMaterial).opacity = Math.max(
          0,
          0.85 - t * (0.85 / life),
        );
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  /** Floating "-42" style damage popup above a world point. */
  showDamageNumber(x: number, y: number, z: number, amount: number): void {
    const canvas = document.createElement("canvas");
    canvas.width = 128;
    canvas.height = 64;
    const ctx = canvas.getContext("2d")!;
    ctx.clearRect(0, 0, 128, 64);
    ctx.font = "bold 36px monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.lineWidth = 6;
    ctx.strokeStyle = "#000";
    ctx.fillStyle = amount >= 40 ? "#ff3344" : "#ffcc33";
    const label = `-${Math.round(amount)}`;
    ctx.strokeText(label, 64, 32);
    ctx.fillText(label, 64, 32);

    const tex = new THREE.CanvasTexture(canvas);
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.NearestFilter;
    const mat = new THREE.SpriteMaterial({
      map: tex,
      transparent: true,
      depthTest: false,
    });
    const sprite = new THREE.Sprite(mat);
    sprite.position.set(x, y + 1.8, z);
    sprite.scale.set(4.5, 2.25, 1);
    this.scene.add(sprite);
    this.floatingTexts.push({
      sprite,
      t0: performance.now(),
      duration: 1100,
      startY: y + 1.8,
    });
  }

  flashTank(playerId: string): void {
    this.tanks.get(playerId)?.flashHit();
  }

  shake(durationSec = 0.4, amplitude = 0.5): void {
    this.shakeUntil = performance.now() + durationSec * 1000;
    this.shakeAmp = amplitude;
  }

  /** Duration used for projectile flight animation (ms). */
  static projectileDurationMs(pathLength: number): number {
    return Math.min(3500, Math.max(400, 450 + pathLength * 7));
  }

  /**
   * Aim guide: only the first portion of the arc (muzzle intent).
   * No impact rings / full path — that made wind + power trivial.
   */
  showTrajectory(
    player: PlayerState,
    wind: number,
    opts?: {
      weaponSlot?: "primary" | "secondary";
      seekTargets?: { x: number; y: number }[];
    },
  ): void {
    if (!this.world || !player.loadout) {
      this.hideTrajectory();
      return;
    }
    const slot = opts?.weaponSlot ?? "primary";
    const weapon =
      slot === "secondary" && player.loadout.secondary
        ? player.loadout.secondary
        : player.loadout.primary;
    const fired = simulateWeaponFire(this.world, {
      weapon,
      tankX: player.x,
      tankY: player.y,
      midZ: this.midZ,
      facing: player.facing,
      angleDeg: player.angle,
      power: player.power,
      wind,
      chassisSize: player.loadout.chassis.size,
      seekTargets: opts?.seekTargets,
    });
    const pts = clipAimPreview(fired.path);
    if (pts.length < 2) {
      this.hideTrajectory();
      return;
    }

    const positions = new Float32Array(pts.length * 3);
    for (let i = 0; i < pts.length; i++) {
      positions[i * 3] = pts[i]!.x;
      positions[i * 3 + 1] = pts[i]!.y;
      positions[i * 3 + 2] = pts[i]!.z;
    }
    this.trajectoryLine.geometry.dispose();
    this.trajectoryLine.geometry = new THREE.BufferGeometry();
    this.trajectoryLine.geometry.setAttribute(
      "position",
      new THREE.BufferAttribute(positions, 3),
    );
    this.trajectoryLine.computeLineDistances();
    const mat = this.trajectoryLine.material as THREE.LineDashedMaterial;
    const col = weapon.color ?? 0xffe066;
    mat.color.setHex(col);
    mat.opacity = 0.72;
    const style = shellStyleFor(weapon);
    if (style === "bounce") {
      mat.dashSize = 0.55;
      mat.gapSize = 0.35;
    } else if (style === "drill") {
      mat.dashSize = 2.2;
      mat.gapSize = 0.25;
    } else if (style === "triple") {
      mat.dashSize = 0.9;
      mat.gapSize = 0.35;
    } else if (style === "nuke") {
      mat.dashSize = 1.6;
      mat.gapSize = 0.5;
    } else {
      mat.dashSize = 1.0;
      mat.gapSize = 0.85;
    }
    this.trajectoryLine.visible = true;

    // Optional short secondary fans for triple — same clipped length, no impact dots
    this.clearTrajectoryMarkers();
    if (fired.paths.length > 1) {
      for (let pi = 1; pi < fired.paths.length; pi++) {
        const sub = clipAimPreview(fired.paths[pi]!);
        if (sub.length < 2) continue;
        const pos = new Float32Array(sub.length * 3);
        for (let i = 0; i < sub.length; i++) {
          pos[i * 3] = sub[i]!.x;
          pos[i * 3 + 1] = sub[i]!.y;
          pos[i * 3 + 2] = sub[i]!.z;
        }
        const g = new THREE.BufferGeometry();
        g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
        const line = new THREE.Line(
          g,
          new THREE.LineBasicMaterial({
            color: col,
            transparent: true,
            opacity: 0.35,
          }),
        );
        this.trajectoryMarkers.add(line);
      }
    }
    this.trajectoryMarkers.visible = this.trajectoryMarkers.children.length > 0;
  }

  hideTrajectory(): void {
    this.trajectoryLine.visible = false;
    this.clearTrajectoryMarkers();
  }

  private clearTrajectoryMarkers(): void {
    while (this.trajectoryMarkers.children.length > 0) {
      const c = this.trajectoryMarkers.children[0]!;
      this.trajectoryMarkers.remove(c);
      if (c instanceof THREE.Mesh || c instanceof THREE.Line) {
        c.geometry.dispose();
        const m = c.material;
        if (Array.isArray(m)) m.forEach((x) => x.dispose());
        else m.dispose();
      }
    }
    this.trajectoryMarkers.visible = false;
  }

  private clearProjectileMeshes(): void {
    while (this.projectileRoot.children.length > 0) {
      const c = this.projectileRoot.children[0]!;
      this.projectileRoot.remove(c);
      c.traverse((obj) => {
        if (obj instanceof THREE.Mesh) {
          obj.geometry.dispose();
          const m = obj.material;
          if (Array.isArray(m)) m.forEach((x) => x.dispose());
          else m.dispose();
        }
      });
    }
  }

  /**
   * Animate shell(s) along path(s). Multi-path weapons (Triple) show all shells.
   * `onImpact` fires when the primary shell arrives.
   */
  playProjectile(
    path: { x: number; y: number; z: number }[],
    onImpact?: () => void,
    shellColor = 0xff5522,
    weapon?: WeaponDef,
    extraPaths?: { x: number; y: number; z: number }[][],
  ): number {
    const allPaths =
      extraPaths && extraPaths.length > 0
        ? extraPaths
        : path.length >= 2
          ? [path]
          : [];
    if (allPaths.length === 0 || (allPaths[0]?.length ?? 0) < 2) {
      onImpact?.();
      return 0;
    }

    const primary = allPaths[0]!;
    const duration = GameRenderer.projectileDurationMs(
      Math.max(...allPaths.map((p) => p.length)),
    );
    if (this.animProjectile?.onImpact) {
      const prev = this.animProjectile.onImpact;
      this.animProjectile.onImpact = undefined;
      prev();
    }

    let peakY = primary[0]!.y;
    for (const p of primary) {
      if (p.y > peakY) peakY = p.y;
    }

    const style = shellStyleFor(weapon);
    const color = weapon?.color ?? shellColor;
    const trailProf = trailProfileFor(style);

    this.clearProjectileMeshes();
    const shells: FlightShell[] = allPaths.map((p) => {
      const mesh = createShellMesh(style, color);
      // Triple: slight size variance so the trio reads as three shells
      if (style === "triple") mesh.scale.setScalar(1.15);
      this.projectileRoot.add(mesh);
      const start = p[0]!;
      mesh.position.set(start.x, start.y, start.z);
      return { mesh, path: p };
    });

    this.animProjectile = {
      shells,
      t0: performance.now(),
      duration,
      onImpact,
      peakY,
      style,
      color,
      lastBounceSparkAt: -99,
      trailEvery: trailProf.every,
      frame: 0,
    };

    const trailMat = this.trail.material as THREE.PointsMaterial;
    trailMat.color.setHex(color);
    trailMat.size = trailProf.size;
    trailMat.opacity = trailProf.opacity;
    this.trail.visible = true;
    this.trailIndex = 0;
    this.trailPositions.fill(0);
    (this.trail.geometry.attributes.position as THREE.BufferAttribute).needsUpdate =
      true;

    this.projectileRoot.visible = true;
    const start = primary[0]!;
    this.cameraTarget.set(start.x, start.y + 4, this.midZ);

    // Muzzle flash unique-ish per style
    this.spawnExplosion(
      {
        kind: "sphere",
        x: start.x,
        y: start.y,
        z: start.z,
        radius: style === "nuke" ? 2.2 : style === "triple" ? 1.6 : 1.2,
        material: VoxelMaterial.Air,
      },
      color,
      style,
    );

    return duration;
  }

  isProjectileFlying(): boolean {
    return this.animProjectile !== null;
  }

  /** True while a shell is in flight or we're holding on the impact. */
  isCameraLockedOnShot(): boolean {
    return (
      this.animProjectile !== null || performance.now() < this.impactHoldUntil
    );
  }

  focusPlayer(player: PlayerState | undefined): void {
    if (!player) return;
    // Don't steal framing from an active shot track or intro
    if (this.isCameraLockedOnShot() || this.isIntroPlaying()) return;
    this.cameraTarget.set(player.x, player.y + 8, this.midZ);
    this.cameraDistance = this.idleCameraDistance;
  }

  update(): void {
    const dt = this.clock.getDelta();
    const now = performance.now();

    this.env.update(dt);
    this.updateIntro(now);

    if (this.animProjectile) {
      const anim = this.animProjectile;
      const { shells, t0, duration, onImpact, peakY, style, color } = anim;
      const u = Math.min(1, (now - t0) / duration);
      anim.frame++;

      let primaryPos = { x: 0, y: 0, z: 0 };
      let primaryPath = shells[0]!.path;
      let primaryF = 0;

      for (let si = 0; si < shells.length; si++) {
        const shell = shells[si]!;
        const path = shell.path;
        const f = u * (path.length - 1);
        const i0 = Math.floor(f);
        const i1 = Math.min(path.length - 1, i0 + 1);
        const frac = f - i0;
        const a = path[i0]!;
        const b = path[i1]!;
        const px = a.x + (b.x - a.x) * frac;
        const py = a.y + (b.y - a.y) * frac;
        const pz = a.z + (b.z - a.z) * frac;
        shell.mesh.position.set(px, py, pz);

        // Orient shell along velocity
        if (i1 > i0) {
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          shell.mesh.rotation.z = Math.atan2(dy, dx);
        }

        // Per-style animation
        if (style === "drill") {
          shell.mesh.rotation.x += dt * 22;
        } else if (style === "bounce") {
          const pulse = 1 + Math.sin(now * 0.025 + si) * 0.2;
          shell.mesh.scale.setScalar(pulse);
        } else if (style === "scatter") {
          shell.mesh.rotation.x += dt * 6;
          shell.mesh.rotation.y += dt * 9;
        } else if (style === "nuke") {
          shell.mesh.rotation.z += dt * 3;
          const pulse = 1 + Math.sin(now * 0.012) * 0.08;
          shell.mesh.scale.setScalar(pulse);
        } else if (style === "triple") {
          shell.mesh.rotation.y += dt * 10;
          // Subtle vertical bob so the three shells don't merge visually
          shell.mesh.position.y += Math.sin(now * 0.02 + si * 2.1) * 0.08;
        } else if (style === "howitzer") {
          shell.mesh.rotation.z = Math.atan2(
            (path[Math.min(path.length - 1, i0 + 1)]?.y ?? py) - py,
            (path[Math.min(path.length - 1, i0 + 1)]?.x ?? px) - px,
          );
        }

        if (si === 0) {
          primaryPos = { x: px, y: py, z: pz };
          primaryPath = path;
          primaryF = f;
        }

        // Trail from every shell (triple leaves three streaks)
        if (anim.frame % anim.trailEvery === 0) {
          const ti = (this.trailIndex % (this.trailPositions.length / 3)) * 3;
          this.trailPositions[ti] = px;
          this.trailPositions[ti + 1] = py;
          this.trailPositions[ti + 2] = pz;
          this.trailIndex++;
          // Sparkle: write a second offset point
          if (style === "triple" || style === "scatter" || style === "nuke") {
            const tj = (this.trailIndex % (this.trailPositions.length / 3)) * 3;
            this.trailPositions[tj] = px + (Math.random() - 0.5) * 0.4;
            this.trailPositions[tj + 1] = py + (Math.random() - 0.5) * 0.4;
            this.trailPositions[tj + 2] = pz;
            this.trailIndex++;
          }
        }
      }
      (this.trail.geometry.attributes.position as THREE.BufferAttribute).needsUpdate =
        true;

      // Bounce sparks on primary path
      const path = primaryPath;
      const i0 = Math.floor(primaryF);
      if (
        style === "bounce" &&
        i0 > 2 &&
        i0 < path.length - 2 &&
        i0 - anim.lastBounceSparkAt > 12
      ) {
        const p0 = path[i0 - 2]!;
        const p1 = path[i0]!;
        const p2 = path[Math.min(path.length - 1, i0 + 2)]!;
        const d1x = p1.x - p0.x;
        const d1y = p1.y - p0.y;
        const d2x = p2.x - p1.x;
        const d2y = p2.y - p1.y;
        const mag1 = Math.hypot(d1x, d1y);
        const mag2 = Math.hypot(d2x, d2y);
        const dot = d1x * d2x + d1y * d2y;
        if (mag1 > 0.01 && mag2 > 0.01 && dot / (mag1 * mag2) < 0.15) {
          anim.lastBounceSparkAt = i0;
          this.spawnExplosion(
            {
              kind: "sphere",
              x: primaryPos.x,
              y: primaryPos.y,
              z: primaryPos.z,
              radius: 1.2,
              material: VoxelMaterial.Air,
            },
            color,
            "bounce",
          );
        }
      }

      const lead = Math.min(
        path.length - 1,
        primaryF + Math.max(4, path.length * 0.04),
      );
      const li0 = Math.floor(lead);
      const li1 = Math.min(path.length - 1, li0 + 1);
      const lfrac = lead - li0;
      const la = path[li0]!;
      const lb = path[li1]!;
      const lookX = la.x + (lb.x - la.x) * lfrac;
      const lookY = la.y + (lb.y - la.y) * lfrac;

      const focusX = primaryPos.x * 0.35 + lookX * 0.65;
      const focusY = Math.max(primaryPos.y, lookY) + 4;
      const track = 1 - Math.exp(-14 * dt);
      this.cameraTarget.x += (focusX - this.cameraTarget.x) * track;
      this.cameraTarget.y += (focusY - this.cameraTarget.y) * track;
      this.cameraTarget.z = this.midZ;

      const heightExtra = Math.max(0, peakY - 40) * 0.55;
      const flightExtra = Math.max(0, primaryPos.y - 30) * 0.35;
      const desiredDist = this.idleCameraDistance + heightExtra + flightExtra;
      this.cameraDistance += (desiredDist - this.cameraDistance) * track;

      if (u >= 1) {
        const impact = path[path.length - 1]!;
        this.cameraTarget.set(impact.x, impact.y + 6, this.midZ);
        this.impactHoldUntil = now + 650;
        this.animProjectile = null;
        this.projectileRoot.visible = false;
        this.clearProjectileMeshes();
        this.trail.visible = false;
        onImpact?.();
      }
    } else if (
      now >= this.impactHoldUntil &&
      !this.isIntroPlaying() &&
      !this.cameraLockedByIntro
    ) {
      // Ease distance back to idle after the hold (never during intro)
      this.cameraDistance +=
        (this.idleCameraDistance - this.cameraDistance) *
        (1 - Math.exp(-4 * dt));
    }

    // Floating damage numbers
    for (let i = this.floatingTexts.length - 1; i >= 0; i--) {
      const ft = this.floatingTexts[i]!;
      const u = Math.min(1, (now - ft.t0) / ft.duration);
      ft.sprite.position.y = ft.startY + u * 3.5;
      const mat = ft.sprite.material as THREE.SpriteMaterial;
      mat.opacity = 1 - u;
      if (u >= 1) {
        this.scene.remove(ft.sprite);
        mat.map?.dispose();
        mat.dispose();
        this.floatingTexts.splice(i, 1);
      }
    }

    for (const tank of this.tanks.values()) {
      tank.updateFx();
      if (!this.isIntroPlaying()) {
        tank.updateMotion(dt, this.midZ);
      }
    }

    // Camera: snap hard during overview/drop so wide shot isn't lerped away
    if (this.isIntroPlaying()) {
      const desired = new THREE.Vector3(
        this.cameraTarget.x,
        this.cameraTarget.y + 10,
        this.midZ + this.cameraDistance,
      );
      // Overview/drop: hard snap. Zoom phase: smooth.
      const t = now - (this.intro?.t0 ?? now);
      const zoomPhase = t >= 1400 + 1600 + 350; // matches updateIntro timings
      if (zoomPhase) {
        this.camera.position.lerp(desired, 1 - Math.exp(-5 * dt));
      } else {
        this.camera.position.copy(desired);
      }
      this.camera.lookAt(this.cameraTarget);
    } else {
      const tracking = this.isCameraLockedOnShot();
      const followRate = tracking ? 18 : 8;
      const desired = new THREE.Vector3(
        this.cameraTarget.x,
        this.cameraTarget.y + (tracking ? 8 : 12),
        this.midZ + this.cameraDistance,
      );
      const camT = 1 - Math.exp(-followRate * dt);
      this.camera.position.lerp(desired, camT);
      this.camera.lookAt(this.cameraTarget);
    }

    // Screen shake after impact
    if (now < this.shakeUntil) {
      const falloff = (this.shakeUntil - now) / 400;
      const amp = this.shakeAmp * Math.min(1, falloff);
      this.camera.position.x += (Math.random() - 0.5) * amp * 2;
      this.camera.position.y += (Math.random() - 0.5) * amp * 1.5;
    }

    this.renderer.render(this.scene, this.camera);
  }

  /** Offline sandbox dig at world position. */
  digAt(
    x: number,
    y: number,
    z: number,
    radius = 3.5,
    weapon?: WeaponDef,
  ): void {
    this.applyTerrainOps(
      [
        {
          kind: "sphere",
          x,
          y,
          z,
          radius,
          material: VoxelMaterial.Air,
        },
      ],
      weapon,
    );
  }

  private updateIntro(now: number): void {
    if (!this.intro || this.intro.done) return;
    const t = now - this.intro.t0;

    const OVERVIEW_MS = 1400;
    const DROP_MS = 1600;
    const SETTLE_MS = 350;
    const ZOOM_MS = 1800;
    const dropStart = OVERVIEW_MS;
    const dropEnd = dropStart + DROP_MS;
    const zoomStart = dropEnd + SETTLE_MS;
    const zoomEnd = zoomStart + ZOOM_MS;

    // Phase A: hold full map (re-assert every frame so nothing pulls zoom in)
    if (t < dropStart) {
      this.frameFullMap(true);
      return;
    }

    // Phase B: tanks drop with ease-in + soft bounce (stay wide)
    if (t < dropEnd) {
      this.frameFullMap(true);
      const u = (t - dropStart) / DROP_MS;
      const eased = 1 - Math.pow(1 - u, 2.4);
      for (const d of this.intro.drops) {
        const tank = this.tanks.get(d.id);
        if (!tank) continue;
        let y = d.fromY + (d.groundY - d.fromY) * eased;
        if (u > 0.85) {
          const b = (u - 0.85) / 0.15;
          y = d.groundY + Math.sin(b * Math.PI) * 1.2 * (1 - b);
        }
        tank.setIntroPose(d.x, y, this.midZ);
      }
      return;
    }

    // Snap to ground
    if (t < zoomStart) {
      this.frameFullMap(true);
      for (const d of this.intro.drops) {
        const tank = this.tanks.get(d.id);
        tank?.setIntroPose(d.x, d.groundY, this.midZ);
        tank?.endIntroPose(d.x, d.groundY);
      }
      return;
    }

    // Phase C: zoom to first player
    if (t < zoomEnd) {
      const u = Math.min(1, (t - zoomStart) / ZOOM_MS);
      const eased = 1 - Math.pow(1 - u, 2.2);
      const first =
        this.intro.drops.find((d) => d.id === this.intro!.firstPlayerId) ??
        this.intro.drops[0];
      if (first) {
        const cx = this.mapWidth / 2;
        const cy = Math.max(28, this.mapHeight * 0.42);
        const wideDist = this.fullMapCameraDistance();
        this.cameraTarget.set(
          cx + (first.x - cx) * eased,
          cy + (first.groundY + 8 - cy) * eased,
          this.midZ,
        );
        this.cameraDistance =
          wideDist + (this.idleCameraDistance - wideDist) * eased;
        // Ease FOV back to gameplay
        this.camera.fov = 48 + (40 - 48) * eased;
        this.camera.updateProjectionMatrix();
      }
      return;
    }

    // Done — restore gameplay camera + fog
    const first =
      this.intro.drops.find((d) => d.id === this.intro!.firstPlayerId) ??
      this.intro.drops[0];
    if (first) {
      this.cameraTarget.set(first.x, first.groundY + 8, this.midZ);
      this.cameraDistance = this.idleCameraDistance;
    }
    for (const d of this.intro.drops) {
      this.tanks.get(d.id)?.endIntroPose(d.x, d.groundY);
    }
    this.camera.fov = 40;
    this.camera.updateProjectionMatrix();
    if (this.scene.fog instanceof THREE.Fog) {
      this.scene.fog.near = 80;
      this.scene.fog.far = 220;
    }
    this.intro.done = true;
    this.cameraLockedByIntro = false;
    this.intro = null;
  }
}
