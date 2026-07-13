import * as THREE from "three";
import type { MapTheme } from "@gunmetal-barrage/shared";

type Cloud = {
  mesh: THREE.Mesh;
  speed: number;
  baseY: number;
  phase: number;
};

type Debris = {
  mesh: THREE.Mesh;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  baseOpacity: number;
};

/**
 * Animated sky, parallax hills, and wind-blown debris.
 */
export class Environment {
  readonly group = new THREE.Group();
  private sky: THREE.Mesh;
  private skyMat: THREE.ShaderMaterial;
  private hills: THREE.Group;
  private clouds: Cloud[] = [];
  private debris: Debris[] = [];
  private debrisGroup = new THREE.Group();
  private mapWidth = 192;
  private mapHeight = 96;
  private midZ = 6;
  private wind = 0;
  private time = 0;
  private hemi: THREE.HemisphereLight | null = null;
  private sun: THREE.DirectionalLight | null = null;
  /** Extra debris density for hurricane sudden death (0 = normal). */
  private hazardIntensity = 0;

  constructor(scene: THREE.Scene) {
    // Gradient sky (shader plane behind the world)
    this.skyMat = new THREE.ShaderMaterial({
      uniforms: {
        topColor: { value: new THREE.Color(0x5ba3d9) },
        bottomColor: { value: new THREE.Color(0xa8d4f0) },
        time: { value: 0 },
      },
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform vec3 topColor;
        uniform vec3 bottomColor;
        uniform float time;
        varying vec2 vUv;
        void main() {
          float band = vUv.y + sin(vUv.x * 6.0 + time * 0.15) * 0.02;
          vec3 col = mix(bottomColor, topColor, clamp(band, 0.0, 1.0));
          // subtle shimmer
          col += 0.02 * sin(vUv.x * 40.0 + time) * sin(vUv.y * 20.0 - time * 0.5);
          gl_FragColor = vec4(col, 1.0);
        }
      `,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.sky = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.skyMat);
    this.sky.position.z = -40;
    this.group.add(this.sky);

    this.hills = new THREE.Group();
    this.group.add(this.hills);
    // Debris on top of terrain so wind is always readable
    this.debrisGroup.renderOrder = 10;
    this.group.add(this.debrisGroup);
    scene.add(this.group);
  }

  attachLights(hemi: THREE.HemisphereLight, sun: THREE.DirectionalLight): void {
    this.hemi = hemi;
    this.sun = sun;
  }

  /**
   * Rebuild backdrop for a map size + biome theme.
   */
  configure(mapWidth: number, mapHeight: number, midZ: number, theme: MapTheme): void {
    this.mapWidth = mapWidth;
    this.mapHeight = mapHeight;
    this.midZ = midZ;

    // Sky plane covers view
    this.sky.scale.set(mapWidth * 3.5, mapHeight * 3.2, 1);
    this.sky.position.set(mapWidth / 2, mapHeight * 0.55, midZ - 45);
    this.skyMat.uniforms.topColor.value.setHex(theme.skyTop);
    this.skyMat.uniforms.bottomColor.value.setHex(theme.skyBottom);

    if (this.hemi) {
      this.hemi.color.setHex(theme.hemiSky);
      this.hemi.groundColor.setHex(theme.hemiGround);
    }
    if (this.sun) {
      this.sun.color.setHex(theme.sun);
    }

    // Rebuild hills
    while (this.hills.children.length) {
      const c = this.hills.children[0]!;
      this.hills.remove(c);
      if (c instanceof THREE.Mesh) {
        c.geometry.dispose();
        (c.material as THREE.Material).dispose();
      }
    }
    this.clouds.forEach((c) => {
      this.group.remove(c.mesh);
      c.mesh.geometry.dispose();
      (c.mesh.material as THREE.Material).dispose();
    });
    this.clouds = [];

    const hillMat = new THREE.MeshLambertMaterial({
      color: theme.hill,
      flatShading: true,
    });
    const farMat = new THREE.MeshLambertMaterial({
      color: new THREE.Color(theme.hill).multiplyScalar(0.7),
      flatShading: true,
    });

    // Far ridgeline
    for (let i = 0; i < 8; i++) {
      const hill = new THREE.Mesh(
        new THREE.ConeGeometry(18 + (i % 3) * 6, 14 + (i % 4) * 5, 5),
        i % 2 === 0 ? hillMat : farMat,
      );
      hill.position.set(
        (i / 7) * mapWidth * 1.2 - mapWidth * 0.1,
        4 + (i % 3) * 2,
        midZ - 18 - (i % 3) * 3,
      );
      hill.rotation.z = ((i % 2) * 2 - 1) * 0.08;
      this.hills.add(hill);
    }

    // Mid parallax mounds
    for (let i = 0; i < 6; i++) {
      const hill = new THREE.Mesh(
        new THREE.ConeGeometry(12 + i * 2, 10 + i, 5),
        hillMat,
      );
      hill.position.set(
        10 + i * (mapWidth / 5),
        2,
        midZ - 10 - (i % 2),
      );
      this.hills.add(hill);
    }

    // Clouds / ash puffs
    const cloudMat = new THREE.MeshBasicMaterial({
      color: theme.cloud,
      transparent: true,
      opacity: theme.biome === "volcanic" ? 0.35 : 0.55,
      depthWrite: false,
    });
    const nClouds = theme.biome === "arctic" ? 10 : 7;
    for (let i = 0; i < nClouds; i++) {
      const g = new THREE.Group();
      const blobs = 2 + (i % 3);
      for (let b = 0; b < blobs; b++) {
        const mesh = new THREE.Mesh(
          new THREE.SphereGeometry(3 + (b % 3), 6, 6),
          cloudMat,
        );
        mesh.position.set(b * 3.5 - 2, (b % 2) * 1.2, 0);
        mesh.scale.set(1.4, 0.55, 0.8);
        g.add(mesh);
      }
      // Wrap group in a dummy mesh container for simplicity — use Object3D
      const holder = new THREE.Mesh(
        new THREE.SphereGeometry(0.01, 3, 3),
        new THREE.MeshBasicMaterial({ visible: false }),
      );
      holder.add(g);
      const baseY = mapHeight * 0.55 + (i % 4) * 6;
      holder.position.set(
        (i / nClouds) * mapWidth * 1.4,
        baseY,
        midZ - 28 - (i % 3) * 4,
      );
      this.group.add(holder);
      this.clouds.push({
        mesh: holder,
        speed: 1.5 + (i % 5) * 0.6,
        baseY,
        phase: i * 1.3,
      });
    }

    // Clear debris
    this.clearDebris();
  }

  setWind(wind: number): void {
    this.wind = wind;
  }

  /** Hurricane / storm visual multiplier for wind debris. */
  setHazardIntensity(intensity: number): void {
    this.hazardIntensity = Math.max(0, intensity);
  }

  update(dt: number): void {
    this.time += dt;
    this.skyMat.uniforms.time.value = this.time;

    // Parallax hills drift slightly
    this.hills.position.x = Math.sin(this.time * 0.05) * 1.5;

    // Clouds drift with wind bias
    const windBias = this.wind * 6;
    for (const c of this.clouds) {
      c.mesh.position.x += (c.speed * 0.45 + windBias) * dt;
      c.mesh.position.y = c.baseY + Math.sin(this.time * 0.4 + c.phase) * 1.2;
      if (c.mesh.position.x > this.mapWidth * 1.3) {
        c.mesh.position.x = -this.mapWidth * 0.2;
      }
      if (c.mesh.position.x < -this.mapWidth * 0.25) {
        c.mesh.position.x = this.mapWidth * 1.25;
      }
    }

    this.updateDebris(dt);
  }

  /** Spawn / refresh wind debris so direction of wind is readable. */
  private updateDebris(dt: number): void {
    // Always show a stream (calm wind still drifts); more particles when stronger
    const strength = Math.max(0.2, Math.abs(this.wind)) + this.hazardIntensity * 0.85;
    const dir = this.wind < -0.02 ? -1 : this.wind > 0.02 ? 1 : 1;
    const baseCount =
      strength < 0.4 ? 52 : strength < 0.85 ? 78 : strength < 1.35 ? 100 : 128;
    const targetCount = Math.min(
      220,
      Math.floor(baseCount + this.hazardIntensity * 70),
    );

    while (this.debris.length < targetCount) {
      this.spawnDebris(dir, true);
    }
    while (this.debris.length > targetCount) {
      const d = this.debris.pop()!;
      this.debrisGroup.remove(d.mesh);
      d.mesh.geometry.dispose();
      (d.mesh.material as THREE.Material).dispose();
    }

    const speedBase = 12 + strength * 30;
    for (const d of this.debris) {
      if (Math.sign(d.vx) !== dir) d.vx = dir * Math.abs(d.vx);
      d.mesh.position.x += d.vx * dt * speedBase;
      d.mesh.position.y += d.vy * dt;
      d.mesh.rotation.z += dt * (4 + strength * 4) * dir;
      d.life -= dt;
      const mat = d.mesh.material as THREE.MeshBasicMaterial;
      mat.opacity = d.baseOpacity * Math.max(0.2, d.life / d.maxLife);

      if (
        (dir > 0 && d.mesh.position.x > this.mapWidth + 14) ||
        (dir < 0 && d.mesh.position.x < -14) ||
        d.life <= 0
      ) {
        this.recycleDebris(d, dir);
      }
    }
  }

  private recycleDebris(d: Debris, dir: number): void {
    d.life = d.maxLife;
    d.mesh.position.y = 14 + Math.random() * this.mapHeight * 0.65;
    d.mesh.position.x =
      dir > 0
        ? -10 - Math.random() * 28
        : this.mapWidth + 10 + Math.random() * 28;
    d.mesh.position.z = this.midZ + (Math.random() - 0.5) * 12;
    d.vx = dir * (0.9 + Math.random() * 0.5);
    d.vy = (Math.random() - 0.5) * 1.6;
    const mat = d.mesh.material as THREE.MeshBasicMaterial;
    mat.opacity = d.baseOpacity;
  }

  private spawnDebris(dir: number, scatter: boolean): void {
    const kinds = Math.random();
    let mesh: THREE.Mesh;
    let baseOpacity = 0.88;
    if (kinds < 0.32) {
      mesh = new THREE.Mesh(
        new THREE.PlaneGeometry(1.15, 0.55),
        new THREE.MeshBasicMaterial({
          color: 0xe8c878,
          transparent: true,
          opacity: 0.92,
          side: THREE.DoubleSide,
          depthWrite: false,
          depthTest: false,
        }),
      );
      baseOpacity = 0.92;
    } else if (kinds < 0.58) {
      mesh = new THREE.Mesh(
        new THREE.SphereGeometry(0.32, 5, 5),
        new THREE.MeshBasicMaterial({
          color: 0xfff2d8,
          transparent: true,
          opacity: 0.85,
          depthWrite: false,
          depthTest: false,
        }),
      );
      baseOpacity = 0.85;
    } else if (kinds < 0.8) {
      mesh = new THREE.Mesh(
        new THREE.BoxGeometry(0.75, 0.24, 0.14),
        new THREE.MeshBasicMaterial({
          color: 0xb0bcc8,
          transparent: true,
          opacity: 0.9,
          depthWrite: false,
          depthTest: false,
        }),
      );
      baseOpacity = 0.9;
    } else {
      // Long streak reads as wind direction
      mesh = new THREE.Mesh(
        new THREE.BoxGeometry(2.2 + Math.random(), 0.1, 0.08),
        new THREE.MeshBasicMaterial({
          color: 0xffffff,
          transparent: true,
          opacity: 0.55,
          depthWrite: false,
          depthTest: false,
        }),
      );
      baseOpacity = 0.55;
    }
    mesh.renderOrder = 12;

    const x = scatter
      ? Math.random() * this.mapWidth
      : dir > 0
        ? -10
        : this.mapWidth + 10;
    mesh.position.set(
      x,
      14 + Math.random() * this.mapHeight * 0.65,
      this.midZ + (Math.random() - 0.5) * 12,
    );
    this.debrisGroup.add(mesh);
    this.debris.push({
      mesh,
      vx: dir * (0.9 + Math.random() * 0.5),
      vy: (Math.random() - 0.5) * 1.5,
      life: 4 + Math.random() * 6,
      maxLife: 5 + Math.random() * 5,
      baseOpacity,
    });
  }

  private clearDebris(): void {
    for (const d of this.debris) {
      this.debrisGroup.remove(d.mesh);
      d.mesh.geometry.dispose();
      (d.mesh.material as THREE.Material).dispose();
    }
    this.debris = [];
  }

  dispose(): void {
    this.clearDebris();
  }
}
