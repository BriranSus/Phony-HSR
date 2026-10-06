import * as THREE from 'three';
import { Nebula, Starfield } from '@modules/vfx';

export interface SandboxElement {
  readonly name: string;
  readonly color: string;
}

/**
 * Phase-1 placeholder 3D scene: a floating calibration platform with one crystal per element
 * (colours come from data/elements), a placeholder mannequin and a light-rail arch. It verifies the
 * renderer, lighting, post-processing and per-frame updates without any gameplay.
 */
export class TestSandbox {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(50, 16 / 9, 0.1, 5000);
  private readonly starfield: Starfield;
  private readonly nebula: Nebula;
  private readonly crystals: THREE.Mesh[] = [];
  private readonly rings: THREE.Mesh[] = [];
  private readonly mannequin = new THREE.Group();
  private readonly gridMaterial: THREE.ShaderMaterial;
  private readonly disposables: Array<{ dispose(): void }> = [];
  private time = 0;

  constructor(elements: readonly SandboxElement[], starCount: number) {
    this.nebula = new Nebula(1800);
    this.starfield = new Starfield({ count: starCount, innerRadius: 800, outerRadius: 1600 });
    this.scene.add(this.nebula.object, this.starfield.object);
    this.scene.fog = new THREE.FogExp2(0x060914, 0.006);

    this.scene.add(new THREE.HemisphereLight(0x9db7ff, 0x1a1030, 0.9));
    const key = new THREE.DirectionalLight(0xfff0d8, 2.2);
    key.position.set(12, 20, 10);
    this.scene.add(key);
    const fill = new THREE.DirectionalLight(0x7fb8ff, 0.8);
    fill.position.set(-14, 6, -10);
    this.scene.add(fill);

    // Platform: stone-like disc with an emissive calibration grid on top.
    const base = new THREE.Mesh(this.track(new THREE.CylinderGeometry(14, 11, 2.2, 96, 1)), this.track(new THREE.MeshStandardMaterial({ color: '#1a2140', metalness: 0.55, roughness: 0.45 })));
    base.position.y = -1.1;
    this.scene.add(base);
    const under = new THREE.Mesh(this.track(new THREE.ConeGeometry(11, 9, 64, 1, true)), this.track(new THREE.MeshStandardMaterial({ color: '#121833', metalness: 0.4, roughness: 0.6, side: THREE.DoubleSide })));
    under.position.y = -6.7;
    under.rotation.x = Math.PI;
    this.scene.add(under);

    this.gridMaterial = this.track(
      new THREE.ShaderMaterial({
        transparent: true,
        uniforms: { uTime: { value: 0 } },
        vertexShader: /* glsl */ `varying vec2 vP; void main() { vP = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
        fragmentShader: /* glsl */ `
          uniform float uTime; varying vec2 vP;
          void main() {
            float r = length(vP); float a = atan(vP.y, vP.x + 1e-5);
            // Line masks: distance to the nearest ring / spoke, 1 on the line fading to 0.
            float rings = smoothstep(0.465, 0.5, abs(fract(r / 2.0) - 0.5));
            float spokes = smoothstep(0.475, 0.5, abs(fract(a / 6.2831853 * 24.0) - 0.5)) * step(2.0, r);
            float grid = max(rings, spokes * 0.6);
            float sweep = 1.0 - smoothstep(0.0, 0.06, abs(fract(r / 14.0 - uTime * 0.12) - 0.5));
            float edge = smoothstep(13.2, 13.9, r) * (1.0 - smoothstep(13.9, 14.0, r));
            vec3 gold = vec3(0.95, 0.78, 0.48);
            vec3 col = vec3(0.012, 0.016, 0.04) + gold * grid * 0.4 + vec3(0.55, 0.8, 1.0) * sweep * grid * 0.9 + gold * edge * 1.4;
            gl_FragColor = vec4(col, 1.0);
          }`,
      }),
    );
    const top = new THREE.Mesh(this.track(new THREE.CircleGeometry(14, 128)), this.gridMaterial);
    top.rotation.x = -Math.PI / 2;
    top.position.y = 0.01;
    this.scene.add(top);

    // Floating halo rings.
    for (let i = 0; i < 3; i++) {
      const ring = new THREE.Mesh(
        this.track(new THREE.TorusGeometry(15.5 + i * 1.6, 0.05 + i * 0.015, 8, 160)),
        this.track(new THREE.MeshBasicMaterial({ color: new THREE.Color(i === 1 ? '#9fdcff' : '#f4dfb0').multiplyScalar(1.8), toneMapped: false, transparent: true, opacity: 0.8 - i * 0.2 })),
      );
      ring.rotation.x = Math.PI / 2 + (i - 1) * 0.06;
      ring.position.y = -0.4 - i * 0.6;
      this.rings.push(ring);
      this.scene.add(ring);
    }

    // Element crystals, evenly spaced around the platform; colours are data-driven.
    elements.forEach((el, i) => {
      const angle = (i / elements.length) * Math.PI * 2;
      const color = new THREE.Color(el.color);
      const crystal = new THREE.Mesh(
        this.track(new THREE.OctahedronGeometry(0.9, 0)),
        this.track(new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.7, metalness: 0.2, roughness: 0.15, flatShading: true })),
      );
      crystal.scale.set(0.8, 1.6, 0.8);
      crystal.position.set(Math.cos(angle) * 9.5, 2.4, Math.sin(angle) * 9.5);
      crystal.userData.baseY = 2.4;
      crystal.userData.phase = i;
      crystal.name = `crystal:${el.name}`;
      this.crystals.push(crystal);
      this.scene.add(crystal);
      const pedestal = new THREE.Mesh(this.track(new THREE.CylinderGeometry(0.7, 0.9, 0.5, 6)), this.track(new THREE.MeshStandardMaterial({ color: '#d9d3c4', metalness: 0.6, roughness: 0.3 })));
      pedestal.position.set(Math.cos(angle) * 9.5, 0.25, Math.sin(angle) * 9.5);
      this.scene.add(pedestal);
      const light = new THREE.PointLight(color, 6, 9, 2);
      light.position.set(Math.cos(angle) * 9.5, 1.6, Math.sin(angle) * 9.5);
      this.scene.add(light);
    });

    // Placeholder mannequin (no character art in Phase 1).
    const suit = this.track(new THREE.MeshStandardMaterial({ color: '#eceae3', metalness: 0.2, roughness: 0.45 }));
    const accent = this.track(new THREE.MeshStandardMaterial({ color: '#1b2550', metalness: 0.5, roughness: 0.35 }));
    const glow = this.track(new THREE.MeshBasicMaterial({ color: new THREE.Color('#f4dfb0').multiplyScalar(2), toneMapped: false }));
    const body = new THREE.Mesh(this.track(new THREE.CapsuleGeometry(0.55, 1.5, 8, 24)), suit);
    body.position.y = 1.35;
    const head = new THREE.Mesh(this.track(new THREE.SphereGeometry(0.42, 32, 16)), suit);
    head.position.y = 2.75;
    const belt = new THREE.Mesh(this.track(new THREE.TorusGeometry(0.56, 0.06, 8, 32)), accent);
    belt.rotation.x = Math.PI / 2;
    belt.position.y = 1.15;
    const visor = new THREE.Mesh(this.track(new THREE.BoxGeometry(0.5, 0.08, 0.1)), glow);
    visor.position.set(0, 2.8, 0.38);
    const marker = new THREE.Mesh(this.track(new THREE.OctahedronGeometry(0.18)), glow);
    marker.position.y = 3.7;
    marker.name = 'marker';
    this.mannequin.add(body, head, belt, visor, marker);
    this.scene.add(this.mannequin);

    // A light-rail arch over the platform, echoing the title screen.
    const arch = new THREE.CatmullRomCurve3([new THREE.Vector3(-30, -6, -18), new THREE.Vector3(-10, 9, -16), new THREE.Vector3(10, 11, -15), new THREE.Vector3(32, -4, -12)]);
    const rail = new THREE.Mesh(this.track(new THREE.TubeGeometry(arch, 200, 0.1, 6)), this.track(new THREE.MeshBasicMaterial({ color: new THREE.Color('#fff1cf').multiplyScalar(2), toneMapped: false })));
    this.scene.add(rail);
  }

  update(dt: number): void {
    this.time += dt;
    const t = this.time;
    (this.gridMaterial.uniforms.uTime as THREE.IUniform<number>).value = t;
    this.starfield.update(t);
    this.nebula.update(t);
    for (const c of this.crystals) {
      const phase = c.userData.phase as number;
      c.rotation.y = t * 0.8 + phase;
      c.position.y = (c.userData.baseY as number) + Math.sin(t * 1.4 + phase) * 0.25;
    }
    this.rings.forEach((r, i) => (r.rotation.z = t * (0.05 + i * 0.03) * (i % 2 ? -1 : 1)));
    const marker = this.mannequin.getObjectByName('marker');
    if (marker) {
      marker.rotation.y = t * 2;
      marker.position.y = 3.7 + Math.sin(t * 3) * 0.08;
    }
  }

  dispose(): void {
    this.starfield.dispose();
    this.nebula.dispose();
    for (const d of this.disposables) d.dispose();
  }

  private track<T extends { dispose(): void }>(x: T): T {
    this.disposables.push(x);
    return x;
  }
}
