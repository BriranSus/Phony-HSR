import * as THREE from 'three';
import { Nebula, Starfield } from '@modules/vfx';
import type { Collider, Level } from '@models/locomotion';
import { surfaceHeight } from '@modules/player';
import { PropKit, createNpcFigure } from './WorldObjects';

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
  gate: { color: '#3b3470', metalness: 0.5, roughness: 0.4, emissive: '#1a1440' },
};

/**
 * One loaded area, built entirely from level JSON: every collider becomes a mesh (ramps as
 * wedges) and the Phase-1 sky (procedural nebula + starfield) and element crystals frame the
 * scene. Interactables, enemies and hidden-area veils are drawn by `WorldObjectsView` from the
 * world runtime's state; this scene only hides collider meshes the runtime has removed (opened
 * gates, broken walls). A new scene is built per area and disposed on a transition.
 */
export class AreaScene {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(50, 16 / 9, 0.1, 5000);
  private readonly starfield: Starfield;
  private readonly nebula: Nebula;
  private readonly crystals: THREE.Mesh[] = [];
  private readonly colliderMeshes = new Map<string, THREE.Object3D>();
  private readonly kit = new PropKit();
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

    for (const c of level.colliders) {
      const mesh = this.colliderMesh(c);
      if (c.id) this.colliderMeshes.set(c.id, mesh);
      this.scene.add(mesh);
    }
    this.addFloorGrid(level.colliders.find((c) => c.id === 'floor'));
    for (const m of level.markers) this.scene.add(this.dummy(m));

    // Element crystals along the north wall (decoration, colours from data).
    const floor = level.colliders.find((c) => c.id === 'floor');
    const northZ = level.colliders.find((c) => c.id === 'wall-n')?.max[2] ?? -23.4;
    const spacing = floor ? Math.min(5, (floor.max[0] - floor.min[0] - 6) / Math.max(1, elements.length - 1)) : 5;
    elements.forEach((el, i) => {
      const color = new THREE.Color(el.color);
      const crystal = new THREE.Mesh(
        this.track(new THREE.OctahedronGeometry(0.6, 0)),
        this.track(new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.8, roughness: 0.15, flatShading: true })),
      );
      crystal.scale.set(0.8, 1.6, 0.8);
      const x = (i - (elements.length - 1) / 2) * spacing;
      crystal.position.set(x, 3.8, northZ + 1.9);
      crystal.userData.phase = i;
      this.crystals.push(crystal);
      const light = new THREE.PointLight(color, 5, 8, 2);
      light.position.set(x, 3, northZ + 2.9);
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
  }

  dispose(): void {
    this.starfield.dispose();
    this.nebula.dispose();
    for (const d of this.disposables) d.dispose();
    this.kit.dispose();
  }

  /** Hides the meshes of colliders the world runtime removed (opened gates, broken walls). */
  syncColliders(live: readonly Collider[]): void {
    const ids = new Set(live.map((c) => c.id));
    for (const [id, mesh] of this.colliderMeshes) mesh.visible = ids.has(id);
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
      // The speaker is the same Pom-Pom-style figure the NPC objects use, facing along the marker yaw.
      const npc = createNpcFigure(this.kit);
      npc.position.set(...m.position);
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

  private track<T extends { dispose(): void }>(x: T): T {
    this.disposables.push(x);
    return x;
  }
}
