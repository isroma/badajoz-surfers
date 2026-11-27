/** Cheap in-engine juice: pooled particle bursts and speed lines. */
import * as THREE from "three";
import type { PickupKind } from "../contracts";

const MAX_PARTICLES = 384;

const BURST_COLORS: Readonly<Record<PickupKind | "crash" | "shield", readonly number[]>> = {
  bellota: [0xf2b134, 0xc8862a, 0xffe08a],
  iman: [0xff3b3b, 0x4aa3ff, 0xffffff],
  zapatillas: [0x46e07a, 0xffffff, 0x1fb6ff],
  jamon: [0xd2463c, 0xffd28a, 0xffffff],
  patinete: [0x23c7f2, 0xffffff, 0xffe14a],
  ciguena: [0xffffff, 0xf0f0f0, 0xff8a3a],
  letra: [0xffd400, 0xffffff, 0xff7a00],
  crash: [0xffffff, 0xcfcfcf, 0xffd27a],
  shield: [0x23c7f2, 0xffffff, 0x9ff3ff],
};

const BURST_COUNT: Readonly<Record<PickupKind | "crash" | "shield", number>> = {
  bellota: 6, ciguena: 48, iman: 28, zapatillas: 28, jamon: 28, patinete: 28, letra: 32, crash: 40, shield: 44,
};

/** A soft round dot so particles are not squares. */
function dotTexture(): THREE.Texture {
  const size = 32;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    g.addColorStop(0, "rgba(255,255,255,1)");
    g.addColorStop(0.55, "rgba(255,255,255,0.9)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

export class Effects {
  readonly points: THREE.Points;
  readonly speedLines: THREE.LineSegments;
  private readonly positions: Float32Array;
  private readonly colors: Float32Array;
  private readonly vel = new Float32Array(MAX_PARTICLES * 3);
  private readonly life = new Float32Array(MAX_PARTICLES);
  private next = 0;
  private alive = 0;
  private readonly color = new THREE.Color();
  private readonly lineCount = 48;
  private readonly lineData: Float32Array;
  private readonly linePositions: Float32Array;
  private readonly lineMaterial: THREE.LineBasicMaterial;
  private speedLineAmount = 0;

  constructor(scene: THREE.Scene, camera: THREE.Camera) {
    const geometry = new THREE.BufferGeometry();
    this.positions = new Float32Array(MAX_PARTICLES * 3).fill(-1000);
    this.colors = new Float32Array(MAX_PARTICLES * 3);
    geometry.setAttribute("position", new THREE.BufferAttribute(this.positions, 3).setUsage(THREE.DynamicDrawUsage));
    geometry.setAttribute("color", new THREE.BufferAttribute(this.colors, 3).setUsage(THREE.DynamicDrawUsage));
    const material = new THREE.PointsMaterial({
      size: 0.2, vertexColors: true, transparent: true, depthWrite: false, sizeAttenuation: true, map: dotTexture(), alphaTest: 0.05,
    });
    this.points = new THREE.Points(geometry, material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
    scene.add(this.points);

    // Speed lines live in camera space.
    this.lineData = new Float32Array(this.lineCount * 4); // angle, radius, z, length
    this.linePositions = new Float32Array(this.lineCount * 6);
    for (let i = 0; i < this.lineCount; i++) this.respawnLine(i, -Math.random() * 40);
    const lineGeometry = new THREE.BufferGeometry();
    lineGeometry.setAttribute("position", new THREE.BufferAttribute(this.linePositions, 3).setUsage(THREE.DynamicDrawUsage));
    this.lineMaterial = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false, fog: false });
    this.speedLines = new THREE.LineSegments(lineGeometry, this.lineMaterial);
    this.speedLines.frustumCulled = false;
    this.speedLines.visible = false;
    this.speedLines.renderOrder = 6;
    camera.add(this.speedLines);
  }

  private respawnLine(i: number, z: number): void {
    this.lineData[i * 4] = Math.random() * Math.PI * 2;
    this.lineData[i * 4 + 1] = 1.6 + Math.random() * 3.2;
    this.lineData[i * 4 + 2] = z;
    this.lineData[i * 4 + 3] = 1.5 + Math.random() * 3;
  }

  /** `vz`: base Z velocity (the runner's), so the burst travels along with the runner. */
  burst(kind: PickupKind | "crash" | "shield", x: number, y: number, z: number, vz = 0): void {
    const palette = BURST_COLORS[kind];
    const n = BURST_COUNT[kind];
    const speed = kind === "bellota" ? 2.5 : 5;
    for (let k = 0; k < n; k++) {
      const i = this.next;
      this.next = (this.next + 1) % MAX_PARTICLES;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      const v = speed * (0.4 + Math.random() * 0.8);
      this.positions[i * 3] = x;
      this.positions[i * 3 + 1] = y;
      this.positions[i * 3 + 2] = z;
      this.vel[i * 3] = Math.sin(phi) * Math.cos(theta) * v;
      this.vel[i * 3 + 1] = Math.abs(Math.cos(phi)) * v + 1.5;
      this.vel[i * 3 + 2] = Math.sin(phi) * Math.sin(theta) * v + vz;
      this.life[i] = 0.45 + Math.random() * 0.35;
      this.color.setHex(palette[k % palette.length] ?? 0xffffff);
      this.colors[i * 3] = this.color.r;
      this.colors[i * 3 + 1] = this.color.g;
      this.colors[i * 3 + 2] = this.color.b;
    }
    this.alive = MAX_PARTICLES;
  }

  /** `worldVz`: how fast the world streams past (runner speed), so bursts trail behind a little. */
  update(dt: number, speedLineTarget: number, runnerSpeed: number): void {
    if (this.alive > 0) {
      let any = 0;
      for (let i = 0; i < MAX_PARTICLES; i++) {
        if (this.life[i]! <= 0) continue;
        const l = this.life[i]! - dt;
        this.life[i] = l;
        if (l <= 0) {
          this.positions[i * 3 + 1] = -1000;
          continue;
        }
        any++;
        this.vel[i * 3 + 1]! -= 9 * dt;
        this.positions[i * 3]! += this.vel[i * 3]! * dt;
        this.positions[i * 3 + 1]! += this.vel[i * 3 + 1]! * dt;
        this.positions[i * 3 + 2]! += this.vel[i * 3 + 2]! * dt;
      }
      this.alive = any;
      const geometry = this.points.geometry;
      const pos = geometry.getAttribute("position");
      const col = geometry.getAttribute("color");
      pos.needsUpdate = true;
      col.needsUpdate = true;
    }

    this.speedLineAmount += (speedLineTarget - this.speedLineAmount) * Math.min(1, dt * 4);
    const visible = this.speedLineAmount > 0.02;
    this.speedLines.visible = visible;
    if (!visible) return;
    this.lineMaterial.opacity = 0.35 * this.speedLineAmount;
    const flow = (runnerSpeed * 1.6 + 10) * dt;
    for (let i = 0; i < this.lineCount; i++) {
      let z = this.lineData[i * 4 + 2]! + flow;
      if (z > 1) {
        this.respawnLine(i, -40 - Math.random() * 6);
        z = this.lineData[i * 4 + 2]!;
      }
      this.lineData[i * 4 + 2] = z;
      const a = this.lineData[i * 4]!;
      const r = this.lineData[i * 4 + 1]!;
      const len = this.lineData[i * 4 + 3]!;
      const x = Math.cos(a) * r * 1.4;
      const y = Math.sin(a) * r * 0.8;
      this.linePositions[i * 6] = x;
      this.linePositions[i * 6 + 1] = y;
      this.linePositions[i * 6 + 2] = z;
      this.linePositions[i * 6 + 3] = x;
      this.linePositions[i * 6 + 4] = y;
      this.linePositions[i * 6 + 5] = z - len;
    }
    this.speedLines.geometry.getAttribute("position").needsUpdate = true;
  }

  clear(): void {
    this.life.fill(0);
    for (let i = 0; i < MAX_PARTICLES; i++) this.positions[i * 3 + 1] = -1000;
    this.alive = 1;
  }
}
