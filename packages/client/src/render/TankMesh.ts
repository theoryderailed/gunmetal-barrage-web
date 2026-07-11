import * as THREE from "three";
import type { PlayerState, TankFlair } from "@gunmetal-barrage/shared";

export class TankMesh {
  readonly group = new THREE.Group();
  private body: THREE.Mesh;
  private turret: THREE.Group;
  private barrel: THREE.Mesh;
  private hpBar: THREE.Mesh;
  private bodyMat: THREE.MeshLambertMaterial;
  private baseColor: THREE.Color;
  private accentColor: THREE.Color;
  private flashUntil = 0;
  private nameSprite: THREE.Sprite | null = null;
  /** Logical target from sim */
  private targetX = 0;
  private targetY = 0;
  private displayX = 0;
  private displayY = 0;
  private displayPitch = 0;
  private hasDisplay = false;
  playerId: string;

  constructor(player: PlayerState) {
    this.playerId = player.id;
    const loadout = player.loadout!;
    this.baseColor = new THREE.Color(
      loadout.palette[0],
      loadout.palette[1],
      loadout.palette[2],
    );
    const accent = player.identity?.accent ?? loadout.palette;
    this.accentColor = new THREE.Color(accent[0], accent[1], accent[2]);
    const size = loadout.chassis.size;
    const flair: TankFlair = player.identity?.flair ?? "none";

    this.bodyMat = new THREE.MeshLambertMaterial({
      color: this.baseColor.clone(),
      flatShading: true,
      emissive: new THREE.Color(0x000000),
    });
    const bodyMat = this.bodyMat;
    const darkMat = new THREE.MeshLambertMaterial({
      color: this.baseColor.clone().multiplyScalar(0.55),
      flatShading: true,
    });
    const accentMat = new THREE.MeshLambertMaterial({
      color: this.accentColor.clone(),
      flatShading: true,
    });
    const metalMat = new THREE.MeshLambertMaterial({
      color: loadout.primary.color,
      flatShading: true,
    });

    // Chassis shape varies slightly by size class
    const bodyH = 0.65 * size + (loadout.chassis.id === "heavy" || loadout.chassis.id === "fortress" ? 0.12 : 0);
    this.body = new THREE.Mesh(
      new THREE.BoxGeometry(1.6 * size, bodyH, 1.0 * size),
      bodyMat,
    );
    this.body.position.y = 0.4 * size + bodyH * 0.15;
    this.group.add(this.body);

    // Accent stripe on hull
    const stripe = new THREE.Mesh(
      new THREE.BoxGeometry(1.62 * size, 0.12 * size, 0.2 * size),
      accentMat,
    );
    stripe.position.set(0, this.body.position.y + bodyH * 0.25, 0.42 * size);
    this.group.add(stripe);

    // Tracks
    const trackGeo = new THREE.BoxGeometry(1.7 * size, 0.35 * size, 0.28 * size);
    const trackL = new THREE.Mesh(trackGeo, darkMat);
    trackL.position.set(0, 0.18 * size, 0.45 * size);
    const trackR = trackL.clone();
    trackR.position.z = -0.45 * size;
    this.group.add(trackL, trackR);

    // Turret
    this.turret = new THREE.Group();
    this.turret.position.y = 0.85 * size;
    const turretMesh = new THREE.Mesh(
      new THREE.BoxGeometry(0.9 * size, 0.45 * size, 0.8 * size),
      bodyMat,
    );
    this.turret.add(turretMesh);

    // Barrel length / thickness from weapon fantasy
    const barrelLen =
      1.0 * size +
      (loadout.primary.trajectory === "lob" ? 0.25 : 0) +
      (loadout.primary.trajectory === "drill" ? 0.45 : 0);
    const barrelThick = loadout.primary.blastRadius > 4 ? 0.22 * size : 0.14 * size;
    this.barrel = new THREE.Mesh(
      new THREE.BoxGeometry(barrelLen, barrelThick, barrelThick),
      metalMat,
    );
    this.barrel.position.set(barrelLen * 0.55, 0.05 * size, 0);
    this.turret.add(this.barrel);
    this.group.add(this.turret);

    this.addFlair(flair, size, accentMat, darkMat);

    // HP bar
    this.hpBar = new THREE.Mesh(
      new THREE.PlaneGeometry(1.4 * size, 0.12),
      new THREE.MeshBasicMaterial({ color: 0x6dff8a, side: THREE.DoubleSide }),
    );
    this.hpBar.position.y = 1.55 * size;
    this.group.add(this.hpBar);

    // Floating name for bots / all players
    this.nameSprite = makeNameSprite(
      player.name,
      player.identity?.title ?? null,
      this.accentColor,
    );
    this.nameSprite.position.y = 2.05 * size;
    this.group.add(this.nameSprite);

    this.sync(player);
  }

  private addFlair(
    flair: TankFlair,
    size: number,
    accentMat: THREE.Material,
    darkMat: THREE.Material,
  ): void {
    switch (flair) {
      case "horn": {
        const horn = new THREE.Mesh(
          new THREE.ConeGeometry(0.12 * size, 0.45 * size, 6),
          accentMat,
        );
        horn.position.set(-0.5 * size, 0.95 * size, 0);
        horn.rotation.z = 0.6;
        this.group.add(horn);
        break;
      }
      case "banner": {
        const pole = new THREE.Mesh(
          new THREE.BoxGeometry(0.06 * size, 0.9 * size, 0.06 * size),
          darkMat,
        );
        pole.position.set(-0.55 * size, 1.1 * size, 0);
        const flag = new THREE.Mesh(
          new THREE.BoxGeometry(0.45 * size, 0.28 * size, 0.04 * size),
          accentMat,
        );
        flag.position.set(-0.3 * size, 1.4 * size, 0);
        this.group.add(pole, flag);
        break;
      }
      case "spikes": {
        for (let i = 0; i < 4; i++) {
          const spike = new THREE.Mesh(
            new THREE.ConeGeometry(0.08 * size, 0.28 * size, 5),
            accentMat,
          );
          spike.position.set(-0.4 * size + i * 0.28 * size, 0.85 * size, 0.55 * size);
          this.group.add(spike);
        }
        break;
      }
      case "antenna": {
        const ant = new THREE.Mesh(
          new THREE.BoxGeometry(0.05 * size, 0.7 * size, 0.05 * size),
          darkMat,
        );
        ant.position.set(0.2 * size, 1.35 * size, 0);
        const ball = new THREE.Mesh(
          new THREE.SphereGeometry(0.1 * size, 6, 6),
          accentMat,
        );
        ball.position.set(0.2 * size, 1.7 * size, 0);
        this.group.add(ant, ball);
        break;
      }
      case "smokestack": {
        const stack = new THREE.Mesh(
          new THREE.CylinderGeometry(0.1 * size, 0.14 * size, 0.5 * size, 8),
          darkMat,
        );
        stack.position.set(-0.35 * size, 1.05 * size, 0);
        const rim = new THREE.Mesh(
          new THREE.CylinderGeometry(0.14 * size, 0.14 * size, 0.08 * size, 8),
          accentMat,
        );
        rim.position.set(-0.35 * size, 1.3 * size, 0);
        this.group.add(stack, rim);
        break;
      }
      case "scoop": {
        const scoop = new THREE.Mesh(
          new THREE.BoxGeometry(0.35 * size, 0.2 * size, 1.1 * size),
          accentMat,
        );
        scoop.position.set(0.95 * size, 0.35 * size, 0);
        this.group.add(scoop);
        break;
      }
      default:
        break;
    }
  }

  sync(player: PlayerState): void {
    this.targetX = player.x;
    this.targetY = player.y;
    if (!this.hasDisplay) {
      this.displayX = player.x;
      this.displayY = player.y;
      this.hasDisplay = true;
      this.group.position.set(player.x, player.y, this.group.position.z || 6);
    }
    this.group.visible = player.alive;
    // Facing: don't hard-flip scale every frame if using smooth pitch on body
    this.group.scale.x = player.facing;

    const rad = (player.angle * Math.PI) / 180;
    this.barrel.rotation.z = 0;
    this.turret.rotation.z = rad;

    const maxHp = player.loadout?.chassis.maxHp ?? 100;
    const ratio = Math.max(0, player.hp / maxHp);
    this.hpBar.scale.x = Math.max(0.05, ratio);
    (this.hpBar.material as THREE.MeshBasicMaterial).color.set(
      ratio > 0.5 ? 0x6dff8a : ratio > 0.25 ? 0xffcc33 : 0xff4d6d,
    );
  }

  /**
   * Smooth follow logical position + gentle body pitch on slopes.
   * Call every frame from the renderer.
   */
  updateMotion(dt: number, midZ: number): void {
    if (!this.hasDisplay) return;
    // Exponential smooth — higher = snappier
    const k = 1 - Math.exp(-18 * dt);
    const prevX = this.displayX;
    const prevY = this.displayY;
    this.displayX += (this.targetX - this.displayX) * k;
    this.displayY += (this.targetY - this.displayY) * k;

    // Slope pitch from recent motion (visual only)
    const dx = this.displayX - prevX;
    const dy = this.displayY - prevY;
    if (Math.abs(dx) > 1e-4) {
      const slope = Math.atan2(dy, Math.abs(dx));
      const targetPitch = Math.max(-0.45, Math.min(0.45, slope));
      this.displayPitch += (targetPitch - this.displayPitch) * (1 - Math.exp(-10 * dt));
    } else {
      this.displayPitch *= 1 - Math.exp(-6 * dt);
    }

    this.group.position.set(this.displayX, this.displayY, midZ + 0.5);
    // Pitch hull slightly; turret stays aim-driven
    this.body.rotation.z = this.displayPitch;
  }

  /** Hard snap (after dig / teleport) */
  snapDisplay(): void {
    this.displayX = this.targetX;
    this.displayY = this.targetY;
    this.displayPitch = 0;
    this.body.rotation.z = 0;
    this.group.position.x = this.displayX;
    this.group.position.y = this.displayY;
  }

  /** Place mesh for intro drop (bypasses lerp). */
  setIntroPose(x: number, y: number, midZ: number): void {
    this.hasDisplay = true;
    this.displayX = x;
    this.displayY = y;
    this.targetX = x;
    this.targetY = y;
    this.displayPitch = 0;
    this.body.rotation.z = 0;
    this.group.position.set(x, y, midZ + 0.5);
    this.group.visible = true;
  }

  endIntroPose(x: number, y: number): void {
    this.targetX = x;
    this.targetY = y;
    this.displayX = x;
    this.displayY = y;
    this.snapDisplay();
  }

  setDepth(midZ: number): void {
    this.group.position.z = midZ + 0.5;
  }

  flashHit(durationMs = 350): void {
    this.flashUntil = performance.now() + durationMs;
    this.bodyMat.color.set(0xff3333);
    this.bodyMat.emissive.set(0xaa2200);
  }

  updateFx(): void {
    if (this.flashUntil <= 0) return;
    if (performance.now() >= this.flashUntil) {
      this.flashUntil = 0;
      this.bodyMat.color.copy(this.baseColor);
      this.bodyMat.emissive.set(0x000000);
    }
  }

  dispose(): void {
    this.group.traverse((obj) => {
      if (obj instanceof THREE.Mesh) {
        obj.geometry.dispose();
        if (Array.isArray(obj.material)) obj.material.forEach((m) => m.dispose());
        else obj.material.dispose();
      }
      if (obj instanceof THREE.Sprite) {
        obj.material.map?.dispose();
        obj.material.dispose();
      }
    });
  }
}

function makeNameSprite(
  name: string,
  title: string | null,
  accent: THREE.Color,
): THREE.Sprite {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 64;
  const ctx = canvas.getContext("2d")!;
  ctx.clearRect(0, 0, 256, 64);
  ctx.fillStyle = "rgba(0,0,0,0.55)";
  ctx.fillRect(8, 8, 240, title ? 48 : 32);
  ctx.font = "bold 20px monospace";
  ctx.textAlign = "center";
  ctx.fillStyle = "#ffffff";
  ctx.fillText(name.slice(0, 18), 128, title ? 28 : 30);
  if (title) {
    ctx.font = "14px monospace";
    ctx.fillStyle = `#${accent.getHexString()}`;
    ctx.fillText(title.slice(0, 28), 128, 48);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  const mat = new THREE.SpriteMaterial({
    map: tex,
    transparent: true,
    depthTest: false,
  });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(5.5, 1.4, 1);
  return sprite;
}
