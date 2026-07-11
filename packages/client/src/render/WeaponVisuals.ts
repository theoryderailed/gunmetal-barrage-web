import * as THREE from "three";
import type { WeaponDef } from "@gunmetal-barrage/shared";

export type ShellStyle =
  | "pea"
  | "howitzer"
  | "scatter"
  | "drill"
  | "bounce"
  | "nuke"
  | "triple"
  | "homing";

export function shellStyleFor(weapon?: WeaponDef | null): ShellStyle {
  if (!weapon) return "pea";
  switch (weapon.id) {
    case "howitzer":
      return "howitzer";
    case "scatter":
      return "scatter";
    case "bunker_buster":
      return "drill";
    case "ricochet":
      return "bounce";
    case "nuke_lite":
      return "nuke";
    case "triple":
      return "triple";
    case "heat_seeker":
      return "homing";
    default:
      return weapon.trajectory === "homing" ? "homing" : "pea";
  }
}

/** Build a high-contrast projectile mesh for a weapon style. */
export function createShellMesh(style: ShellStyle, color: number): THREE.Group {
  const group = new THREE.Group();
  const bodyMat = new THREE.MeshBasicMaterial({
    color,
    transparent: false,
  });
  const rimMat = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0.9,
  });
  const glowMat = new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity: 0.35,
    depthWrite: false,
  });

  switch (style) {
    case "pea": {
      // Small bright ball + white rim
      const body = new THREE.Mesh(new THREE.SphereGeometry(0.38, 10, 10), bodyMat);
      const rim = new THREE.Mesh(new THREE.SphereGeometry(0.48, 10, 10), glowMat);
      group.add(rim, body);
      break;
    }
    case "howitzer": {
      // Fat mortar shell
      const body = new THREE.Mesh(
        new THREE.CylinderGeometry(0.28, 0.42, 1.1, 10),
        bodyMat,
      );
      body.rotation.z = Math.PI / 2;
      const nose = new THREE.Mesh(new THREE.SphereGeometry(0.42, 10, 10), bodyMat);
      nose.position.x = 0.55;
      const glow = new THREE.Mesh(new THREE.SphereGeometry(0.9, 10, 10), glowMat);
      group.add(glow, body, nose);
      break;
    }
    case "scatter": {
      // Faceted gem / cluster pod
      const body = new THREE.Mesh(new THREE.IcosahedronGeometry(0.5, 0), bodyMat);
      const glow = new THREE.Mesh(new THREE.IcosahedronGeometry(0.75, 0), glowMat);
      group.add(glow, body);
      break;
    }
    case "drill": {
      // Long spike + fins
      const body = new THREE.Mesh(new THREE.ConeGeometry(0.28, 1.4, 8), bodyMat);
      body.rotation.z = -Math.PI / 2;
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(0.32, 0.07, 6, 12),
        rimMat,
      );
      ring.rotation.y = Math.PI / 2;
      const glow = new THREE.Mesh(new THREE.SphereGeometry(0.55, 8, 8), glowMat);
      group.add(glow, body, ring);
      break;
    }
    case "bounce": {
      // Chrome ball with thick white outline
      const body = new THREE.Mesh(new THREE.SphereGeometry(0.42, 12, 12), bodyMat);
      const outline = new THREE.Mesh(
        new THREE.SphereGeometry(0.55, 12, 12),
        new THREE.MeshBasicMaterial({
          color: 0xffffff,
          transparent: true,
          opacity: 0.55,
          side: THREE.BackSide,
        }),
      );
      group.add(outline, body);
      break;
    }
    case "nuke": {
      // Big spiked sphere
      const body = new THREE.Mesh(new THREE.SphereGeometry(0.7, 12, 12), bodyMat);
      const spikes = new THREE.Group();
      for (let i = 0; i < 6; i++) {
        const spike = new THREE.Mesh(
          new THREE.ConeGeometry(0.12, 0.55, 5),
          rimMat,
        );
        const a = (i / 6) * Math.PI * 2;
        spike.position.set(Math.cos(a) * 0.65, Math.sin(a) * 0.65, 0);
        spike.rotation.z = a - Math.PI / 2;
        spikes.add(spike);
      }
      const glow = new THREE.Mesh(new THREE.SphereGeometry(1.15, 10, 10), glowMat);
      group.add(glow, body, spikes);
      break;
    }
    case "triple": {
      // Single marker shell (triad is separate multi-mesh flight)
      const body = new THREE.Mesh(
        new THREE.OctahedronGeometry(0.48, 0),
        bodyMat,
      );
      const glow = new THREE.Mesh(
        new THREE.OctahedronGeometry(0.72, 0),
        glowMat,
      );
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(0.55, 0.08, 6, 16),
        rimMat,
      );
      ring.rotation.x = Math.PI / 2;
      group.add(glow, body, ring);
      break;
    }
    case "homing": {
      // Slim missile with exhaust glow
      const body = new THREE.Mesh(
        new THREE.CylinderGeometry(0.18, 0.28, 1.2, 8),
        bodyMat,
      );
      body.rotation.z = Math.PI / 2;
      const nose = new THREE.Mesh(new THREE.ConeGeometry(0.28, 0.45, 8), rimMat);
      nose.rotation.z = -Math.PI / 2;
      nose.position.x = 0.7;
      const exhaust = new THREE.Mesh(
        new THREE.SphereGeometry(0.35, 8, 8),
        glowMat,
      );
      exhaust.position.x = -0.55;
      group.add(exhaust, body, nose);
      break;
    }
  }

  return group;
}

export interface TrailProfile {
  size: number;
  opacity: number;
  count: number;
  /** Spawn rate every N frames (1 = every frame) */
  every: number;
  sparkle: boolean;
}

export function trailProfileFor(style: ShellStyle): TrailProfile {
  switch (style) {
    case "pea":
      return { size: 0.32, opacity: 0.85, count: 36, every: 1, sparkle: false };
    case "howitzer":
      return { size: 0.55, opacity: 0.75, count: 40, every: 1, sparkle: false };
    case "scatter":
      return { size: 0.4, opacity: 0.9, count: 50, every: 1, sparkle: true };
    case "drill":
      return { size: 0.2, opacity: 0.95, count: 60, every: 1, sparkle: false };
    case "bounce":
      return { size: 0.45, opacity: 0.9, count: 44, every: 1, sparkle: true };
    case "nuke":
      return { size: 0.7, opacity: 0.8, count: 56, every: 1, sparkle: true };
    case "triple":
      return { size: 0.5, opacity: 1, count: 54, every: 1, sparkle: true };
    case "homing":
      return { size: 0.38, opacity: 0.95, count: 52, every: 1, sparkle: true };
  }
}

export interface ExplosionProfile {
  count: number;
  size: number;
  life: number;
  flashColor: number;
  spread: number;
  flashScale: number;
  ring: boolean;
  sparks: boolean;
}

export function explosionProfileFor(style: ShellStyle, color: number): ExplosionProfile {
  switch (style) {
    case "pea":
      return {
        count: 22,
        size: 0.7,
        life: 0.7,
        flashColor: 0xffee88,
        spread: 12,
        flashScale: 1.8,
        ring: false,
        sparks: false,
      };
    case "howitzer":
      return {
        count: 34,
        size: 1.0,
        life: 0.9,
        flashColor: 0xffaa44,
        spread: 16,
        flashScale: 2.4,
        ring: true,
        sparks: false,
      };
    case "scatter":
      return {
        count: 16,
        size: 0.65,
        life: 0.5,
        flashColor: 0xff66cc,
        spread: 10,
        flashScale: 1.6,
        ring: true,
        sparks: true,
      };
    case "drill":
      return {
        count: 28,
        size: 0.45,
        life: 0.65,
        flashColor: 0xddaaff,
        spread: 7,
        flashScale: 1.4,
        ring: false,
        sparks: true,
      };
    case "bounce":
      return {
        count: 26,
        size: 0.75,
        life: 0.75,
        flashColor: 0xaaffff,
        spread: 13,
        flashScale: 2.0,
        ring: true,
        sparks: true,
      };
    case "nuke":
      return {
        count: 48,
        size: 1.35,
        life: 1.15,
        flashColor: 0xffffff,
        spread: 22,
        flashScale: 3.2,
        ring: true,
        sparks: true,
      };
    case "triple":
      return {
        count: 30,
        size: 0.9,
        life: 0.75,
        flashColor: color,
        spread: 14,
        flashScale: 2.1,
        ring: true,
        sparks: true,
      };
    case "homing":
      return {
        count: 32,
        size: 0.85,
        life: 0.8,
        flashColor: 0xff6688,
        spread: 13,
        flashScale: 2.0,
        ring: true,
        sparks: true,
      };
  }
}
