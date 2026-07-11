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

  update(dt: number): void {
    this.time += dt;
    this.skyMat.uniforms.time.value = this.time;

    // Parallax hills drift slightly
    this.hills.position.x = Math.sin(this.time * 0.05) * 1.5;

    // Clouds drift with wind bias
    const windBias = this.wind * 4;
    for (const c of this.clouds) {
      c.mesh.position.x += (c.speed * 0.35 + windBias) * dt;
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
    const strength = Math.abs(this.wind);
    const dir = this.wind >= 0 ? 1 : -1;
    const targetCount =
      strength < 0.12 ? 8 : strength < 0.6 ? 22 : strength < 1.2 ? 36 : 50;

    while (this.debris.length < targetCount) {
      this.spawnDebris(dir, true);
    }
    while (this.debris.length > targetCount) {
      const d = this.debris.pop()!;
      this.debrisGroup.remove(d.mesh);
      d.mesh.geometry.dispose();
      (d.mesh.material as THREE.Material).dispose();
    }

    const speedBase = 6 + strength * 14;
    for (const d of this.debris) {
      d.mesh.position.x += d.vx * dt * speedBase;
      d.mesh.position.y += d.vy * dt;
      d.mesh.rotation.z += dt * 3 * dir;
      d.life -= dt;
      const mat = d.mesh.material as THREE.MeshBasicMaterial;
      mat.opacity = Math.max(0, (d.life / d.maxLife) * 0.75);

      // Wrap horizontally with wind direction
      if (dir > 0 && d.mesh.position.x > this.mapWidth + 10) {
        d.mesh.position.x = -8;
        d.mesh.position.y = 10 + Math.random() * this.mapHeight * 0.7;
        d.life = d.maxLife;
      }
      if (dir < 0 && d.mesh.position.x < -10) {
        d.mesh.position.x = this.mapWidth + 8;
        d.mesh.position.y = 10 + Math.random() * this.mapHeight * 0.7;
        d.life = d.maxLife;
      }
      if (d.life <= 0) {
        d.life = d.maxLife;
        d.mesh.position.y = 8 + Math.random() * this.mapHeight * 0.75;
        d.mesh.position.x =
          dir > 0 ? -5 - Math.random() * 20 : this.mapWidth + 5 + Math.random() * 20;
        mat.opacity = 0.7;
      }
    }
  }

  private spawnDebris(dir: number, scatter: boolean): void {
    const kinds = Math.random();
    let mesh: THREE.Mesh;
    if (kinds < 0.4) {
      // Leaf / petal
      mesh = new THREE.Mesh(
        new THREE.PlaneGeometry(0.5, 0.3),
        new THREE.MeshBasicMaterial({
          color: 0xc4a35a,
          transparent: true,
          opacity: 0.7,
          side: THREE.DoubleSide,
          depthWrite: false,
        }),
      );
    } else if (kinds < 0.75) {
      // Dust mote
      mesh = new THREE.Mesh(
        new THREE.SphereGeometry(0.12, 4, 4),
        new THREE.MeshBasicMaterial({
          color: 0xddd0b0,
          transparent: true,
          opacity: 0.55,
          depthWrite: false,
        }),
      );
    } else {
      // Scrap flake
      mesh = new THREE.Mesh(
        new THREE.BoxGeometry(0.35, 0.12, 0.08),
        new THREE.MeshBasicMaterial({
          color: 0x889099,
          transparent: true,
          opacity: 0.65,
          depthWrite: false,
        }),
      );
    }

    const x = scatter
      ? Math.random() * this.mapWidth
      : dir > 0
        ? -5
        : this.mapWidth + 5;
    mesh.position.set(
      x,
      8 + Math.random() * this.mapHeight * 0.75,
      this.midZ + (Math.random() - 0.5) * 8,
    );
    this.debrisGroup.add(mesh);
    this.debris.push({
      mesh,
      vx: dir * (0.7 + Math.random() * 0.6),
      vy: (Math.random() - 0.5) * 1.2,
      life: 3 + Math.random() * 5,
      maxLife: 4 + Math.random() * 4,
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
