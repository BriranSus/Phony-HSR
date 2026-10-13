import * as THREE from 'three';
import { Nebula, Starfield } from '@modules/vfx';
import type { Collider, Interactable, Level } from '@models/locomotion';
import { surfaceHeight } from '@modules/player';

export interface LevelElementColor {
  readonly name: string;
  readonly color: string;
}

/** Surface look per collider `material` (procedural; no textures). */
const MATERIALS: Record<string, { color: string; metalness: number; roughness: number; emissive?: string }> = {
  floor: { color: '#1b2242', metalness: 0.45, roughness: 0.55 },
  wall: { color: '#2b3560', metalness: 0.35, roughness: 0.5 },
  platform: { color: '#3a4675', metalness: 0.5, roughness: 0.4 },
  step: { color: '#c9c2b0', metalness: 0.4, roughness: 0.45 },
  stone: { color: '#7c86a8', metalness: 0.3, roughness: 0.55 },
  pillar: { color: '#d8d1bf', metalness: 0.55, roughness: 0.3 },
  crate: { color: '#6b4e2e', metalness: 0.1, roughness: 0.8 },
};

/**
 * Phase-2 walkable test level, built entirely from `levels/test-level.json`: every collider
 * becomes a mesh (ramps as wedges), interactables get placeholder props (sign, chest, NPC), and the
 * Phase-1 sky (procedural nebula + starfield) and element crystals frame the scene.
 */
export class TestLevelScene {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(50, 16 / 9, 0.1, 5000);
  private readonly starfield: Starfield;
  private readonly nebula: Nebula;
  private readonly crystals: THREE.Mesh[] = [];
  private readonly markers: THREE.Object3D[] = [];
  private readonly disposables: Array<{ dispose(): void }> = [];
  private readonly mats = new Map<string, THREE.MeshStandardMaterial>();
  private time = 0;

  constructor(level: Level, elements: readonly LevelElementColor[], starCount: number) {
    this.nebula = new Nebula(1800);
    this.starfield = new Starfield({ count: starCount, innerRadius: 800, outerRadius: 1600 });
    this.scene.add(this.nebula.object, this.starfield.object);
    this.scene.fog = new THREE.FogExp2(0x060914, 0.012);
    this.scene.add(new THREE.HemisphereLight(0x9db7ff, 0x1a1030, 1.0));
    const key = new THREE.DirectionalLight(0xfff0d8, 2.4);
    key.position.set(14, 24, 8);
    this.scene.add(key);
    const fill = new THREE.DirectionalLight(0x7fb8ff, 0.8);
    fill.position.set(-14, 8, -12);
    this.scene.add(fill);

    for (const c of level.colliders) this.scene.add(this.colliderMesh(c));
    this.addFloorGrid(level.colliders.find((c) => c.id === 'floor'));
    for (const it of level.interactables) this.scene.add(this.prop(it));
    for (const m of level.markers) this.scene.add(this.dummy(m));

    // Element crystals along the north wall (decoration, colours from data).
    elements.forEach((el, i) => {
      const color = new THREE.Color(el.color);
      const crystal = new THREE.Mesh(
        this.track(new THREE.OctahedronGeometry(0.6, 0)),
        this.track(new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.8, roughness: 0.15, flatShading: true })),
      );
      crystal.scale.set(0.8, 1.6, 0.8);
      const x = -15 + i * 5;
      crystal.position.set(x, 3.8, -21.5);
      crystal.userData.phase = i;
      this.crystals.push(crystal);
      const light = new THREE.PointLight(color, 5, 8, 2);
      light.position.set(x, 3, -20.5);
      this.scene.add(crystal, light);
    });
  }

  update(dt: number): void {
    this.time += dt;
    const t = this.time;
    this.starfield.update(t);
    this.nebula.update(t);
    for (const c of this.crystals) {
      const p = c.userData.phase as number;
      c.rotation.y = t * 0.8 + p;
      c.position.y = 3.8 + Math.sin(t * 1.4 + p) * 0.2;
    }
    for (const m of this.markers) {
      m.rotation.y = t * 2;
      m.position.y = (m.userData.baseY as number) + Math.sin(t * 3) * 0.08;
    }
  }

  dispose(): void {
    this.starfield.dispose();
    this.nebula.dispose();
    for (const d of this.disposables) d.dispose();
  }

  private material(name: string): THREE.MeshStandardMaterial {
    let m = this.mats.get(name);
    if (!m) {
      const spec = MATERIALS[name] ?? MATERIALS.stone!;
      m = this.track(new THREE.MeshStandardMaterial({ color: spec.color, metalness: spec.metalness, roughness: spec.roughness, flatShading: true }));
      this.mats.set(name, m);
    }
    return m;
  }

  private colliderMesh(c: Collider): THREE.Object3D {
    const [x0, y0, z0] = c.min;
    const [x1, y1, z1] = c.max;
    const geo = this.track(new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0));
    if (c.shape === 'ramp') {
      // Lower the top vertices to the ramp surface.
      const pos = geo.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < pos.count; i++) {
        if (pos.getY(i) <= 0) continue;
        const wx = pos.getX(i) + (x0 + x1) / 2;
        const wz = pos.getZ(i) + (z0 + z1) / 2;
        const top = surfaceHeight(c, wx, wz) ?? y1;
        pos.setY(i, top - (y0 + y1) / 2);
      }
      geo.computeVertexNormals();
    }
    const mesh = new THREE.Mesh(geo, this.material(c.shape === 'ramp' ? (c.material === 'stone' ? 'stone' : c.material) : c.material));
    mesh.position.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
    mesh.receiveShadow = true;
    // Gold edge line on top of walkable blocks, like the reference game's readable ledges.
    if (c.material !== 'floor') {
      const edges = new THREE.LineSegments(this.track(new THREE.EdgesGeometry(geo, 30)), this.track(new THREE.LineBasicMaterial({ color: 0xd9b475, transparent: true, opacity: 0.45 })));
      mesh.add(edges);
    }
    return mesh;
  }

  private addFloorGrid(floor: Collider | undefined): void {
    if (!floor) return;
    const size = floor.max[0] - floor.min[0];
    const grid = new THREE.GridHelper(size, size / 2, 0x3a4a80, 0x3a4a80);
    const mats = Array.isArray(grid.material) ? grid.material : [grid.material];
    for (const m of mats) {
      m.transparent = true;
      m.opacity = 0.28;
    }
    grid.position.y = floor.max[1] + 0.005;
    this.track(grid.geometry);
    this.scene.add(grid);
  }

  /** Placeholder units for camera shots: hostile dummies (boss scaled up) and a speaker figure. */
  private dummy(m: Level['markers'][number]): THREE.Object3D {
    if (m.kind === 'npc') {
      // The speaker uses the NPC prop (Pom-Pom-style figure), facing along the marker yaw.
      const npc = this.prop({ id: m.id, kind: 'npc', label: m.id, position: m.position, message: m.id });
      npc.rotation.y = m.yaw;
      return npc;
    }
    const g = new THREE.Group();
    g.position.set(...m.position);
    g.rotation.y = m.yaw;
    const bodyMat = this.track(new THREE.MeshStandardMaterial({ color: '#2a1838', metalness: 0.4, roughness: 0.5, flatShading: true }));
    const coreColor = new THREE.Color('#ff3d6e');
    const core = this.track(new THREE.MeshStandardMaterial({ color: coreColor, emissive: coreColor, emissiveIntensity: 1.2, flatShading: true }));
    const body = new THREE.Mesh(this.track(new THREE.CylinderGeometry(0.22, 0.4, 1.2, 6)), bodyMat);
    body.position.y = 0.6;
    const head = new THREE.Mesh(this.track(new THREE.OctahedronGeometry(0.28, 0)), core);
    head.position.y = 1.5;
    const shoulders = new THREE.Mesh(this.track(new THREE.BoxGeometry(0.9, 0.16, 0.3)), bodyMat);
    shoulders.position.y = 1.15;
    g.add(body, head, shoulders);
    if (m.kind === 'boss') g.scale.setScalar(2.2);
    return g;
  }

  private prop(it: Interactable): THREE.Object3D {
    const g = new THREE.Group();
    g.position.set(...it.position);
    g.rotation.y = Math.atan2(-it.position[0], 6 - it.position[2]) * 0.5;
    const gold = this.track(new THREE.MeshStandardMaterial({ color: '#d9b475', metalness: 0.7, roughness: 0.3, emissive: '#5a4012', flatShading: true }));
    const glow = this.track(new THREE.MeshBasicMaterial({ color: new THREE.Color('#f4dfb0').multiplyScalar(2), toneMapped: false }));
    if (it.kind === 'sign') {
      const post = new THREE.Mesh(this.track(new THREE.CylinderGeometry(0.05, 0.06, 1.3, 6)), this.material('pillar'));
      post.position.y = 0.65;
      const board = new THREE.Mesh(this.track(new THREE.BoxGeometry(0.9, 0.5, 0.06)), this.material('wall'));
      board.position.y = 1.25;
      const plate = new THREE.Mesh(this.track(new THREE.PlaneGeometry(0.75, 0.35)), this.track(new THREE.MeshBasicMaterial({ color: new THREE.Color('#9fdcff').multiplyScalar(1.3), toneMapped: false, transparent: true, opacity: 0.75 })));
      plate.position.set(0, 1.25, 0.035);
      g.add(post, board, plate);
    } else if (it.kind === 'chest') {
      const box = new THREE.Mesh(this.track(new THREE.BoxGeometry(0.9, 0.5, 0.6)), this.material('crate'));
      box.position.y = 0.25;
      const lid = new THREE.Mesh(this.track(new THREE.CylinderGeometry(0.3, 0.3, 0.9, 8, 1, false, 0, Math.PI)), this.material('crate'));
      lid.rotation.z = Math.PI / 2;
      lid.position.y = 0.5;
      const band = new THREE.Mesh(this.track(new THREE.BoxGeometry(0.94, 0.08, 0.64)), gold);
      band.position.y = 0.42;
      const lock = new THREE.Mesh(this.track(new THREE.BoxGeometry(0.12, 0.14, 0.05)), gold);
      lock.position.set(0, 0.42, 0.32);
      g.add(box, lid, band, lock);
    } else {
      const body = new THREE.Mesh(this.track(new THREE.CapsuleGeometry(0.28, 0.6, 4, 12)), this.material('pillar'));
      body.position.y = 0.6;
      const head = new THREE.Mesh(this.track(new THREE.SphereGeometry(0.24, 16, 10)), this.material('pillar'));
      head.position.y = 1.3;
      const ears = new THREE.Mesh(this.track(new THREE.ConeGeometry(0.08, 0.25, 6)), gold);
      ears.position.set(0.16, 1.52, 0);
      const ears2 = ears.clone();
      ears2.position.x = -0.16;
      // Simple face (eyes on the +Z side) so dialogue shots have something to frame.
      const eyeMat = this.track(new THREE.MeshBasicMaterial({ color: '#1b1430' }));
      const eye = new THREE.Mesh(this.track(new THREE.SphereGeometry(0.035, 8, 6)), eyeMat);
      eye.position.set(0.085, 1.34, 0.215);
      const eye2 = eye.clone();
      eye2.position.x = -0.085;
      g.add(body, head, ears, ears2, eye, eye2);
    }
    const marker = new THREE.Mesh(this.track(new THREE.OctahedronGeometry(0.11)), glow);
    marker.userData.baseY = it.kind === 'npc' ? 1.95 : it.kind === 'sign' ? 1.8 : 1.0;
    marker.position.y = marker.userData.baseY as number;
    this.markers.push(marker);
    g.add(marker);
    return g;
  }

  private track<T extends { dispose(): void }>(x: T): T {
    this.disposables.push(x);
    return x;
  }
}
