import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { Nebula, Planet, Starfield, mulberry32 } from '@modules/vfx';

/**
 * Title-screen backdrop: a procedural interstellar express riding a rail of light through a
 * nebula past a ringed gas giant. The express stays framed while the world streams past
 * (scrolling rail ties, stardust and a slowly turning sky), like a tracking shot.
 * Everything is generated geometry and shaders (no imported art).
 */
const UP = new THREE.Vector3(0, 1, 0);
const CAR_COUNT = 4;
const CAR_LENGTH = 7.4;
const CAR_GAP = 0.9;
const RAIL_GAUGE = 1.6;
const TIE_SPACING = 2.4;
/** Rail length receding behind the express (towards the vanishing point). */
const RAIL_BEHIND = 2600;
/** Rail length ahead of the locomotive (towards and past the camera). */
const RAIL_AHEAD = 140;
/** Stardust stream range around the express. */
const DUST_MIN = -420;
const DUST_MAX = 140;
/** Camera placement relative to the locomotive (s = distance along the rail, side = towards its right). */
const CAMERA_RIG = { ahead: 16, side: 13, up: 3.2, lookAtS: -9, lookUp: 2.2 } as const;

export interface TitleBackdropOptions {
  starCount: number;
  /** World units per second the express travels. */
  speed?: number;
}

export class TitleBackdrop {
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  /** Direction of travel. */
  private readonly forward = new THREE.Vector3(-0.82, 0.06, -0.57).normalize();
  private readonly right = new THREE.Vector3();
  private readonly train = new THREE.Group();
  private readonly sky = new THREE.Group();
  private readonly starfield: Starfield;
  private readonly nebula: Nebula;
  private readonly planet: Planet;
  private readonly ties: THREE.InstancedMesh;
  private readonly tieCount: number;
  private readonly dust: THREE.Points;
  private readonly dustS: Float32Array;
  private readonly dustSpeed: Float32Array;
  private readonly dustOffset: Float32Array;
  private readonly disposables: Array<{ dispose(): void }> = [];
  private readonly speed: number;
  private readonly cameraBase: THREE.Vector3;
  private readonly cameraTarget: THREE.Vector3;
  private time = 0;
  private distance = 0;

  constructor(o: TitleBackdropOptions) {
    this.speed = o.speed ?? 42;
    this.right.crossVectors(this.forward, UP).normalize();
    this.camera = new THREE.PerspectiveCamera(40, 16 / 9, 0.1, 6000);
    this.scene.fog = new THREE.FogExp2(0x080c20, 0.0009);

    // Camera framing in train space: ahead of the locomotive, off its sunlit side, looking back
    // along the train so the cars recede towards the vanishing point.
    this.cameraBase = this.railPoint(CAMERA_RIG.ahead, CAMERA_RIG.side, new THREE.Vector3()).add(new THREE.Vector3(0, CAMERA_RIG.up, 0));
    this.cameraTarget = this.railPoint(CAMERA_RIG.lookAtS, RAIL_GAUGE / 2, new THREE.Vector3()).add(new THREE.Vector3(0, CAMERA_RIG.lookUp, 0));
    this.camera.position.copy(this.cameraBase);
    this.camera.lookAt(this.cameraTarget);
    this.camera.updateMatrixWorld();

    this.nebula = new Nebula(2600);
    this.starfield = new Starfield({ count: o.starCount, innerRadius: 1400, outerRadius: 2400, size: 2.4 });
    this.sky.add(this.nebula.object, this.starfield.object);
    this.scene.add(this.sky);

    // Key light from behind the camera (front-lights the express); a distant star backlights the scene.
    const keyDir = this.viewDirection(0.9, 0.9, -1).normalize();
    const starDir = this.viewDirection(0.5, 0.62, 1);
    this.scene.add(new THREE.AmbientLight(0x56649c, 0.8));
    const key = new THREE.DirectionalLight(0xffe9c8, 2.2);
    key.position.copy(keyDir).multiplyScalar(100);
    this.scene.add(key);
    const rim = new THREE.DirectionalLight(0x9cc8ff, 1.3);
    rim.position.copy(starDir).multiplyScalar(100);
    this.scene.add(rim);
    this.scene.add(this.createSunGlow(starDir));

    this.planet = new Planet({ radius: 330, colorA: '#10173c', colorB: '#465a9c', atmosphere: '#7cc6ff', lightDir: starDir, bands: 12, ring: true });
    this.planet.object.position.copy(this.camera.position).addScaledVector(this.viewDirection(-0.62, -0.42, 1), 1700);
    this.planet.object.rotation.z = 0.35;
    this.scene.add(this.planet.object);

    this.scene.add(this.createRails());
    const tiles = this.createTies();
    this.ties = tiles.mesh;
    this.tieCount = tiles.count;
    this.scene.add(this.ties);

    const dust = this.createDust(700);
    this.dust = dust.points;
    this.dustS = dust.s;
    this.dustSpeed = dust.speed;
    this.dustOffset = dust.offset;
    this.scene.add(this.dust);

    for (let i = 0; i < CAR_COUNT; i++) {
      const car = this.createCar(i === 0);
      const back = i * (CAR_LENGTH + CAR_GAP);
      car.position.copy(this.forward).multiplyScalar(-back).add(this.right.clone().multiplyScalar(RAIL_GAUGE / 2)).add(new THREE.Vector3(0, 1.45, 0));
      car.lookAt(car.position.clone().add(this.forward));
      this.train.add(car);
    }
    this.scene.add(this.train);

    this.update(0);
  }

  /**
   * World direction for a point in the initial view: x/y are offsets in units of the view's
   * half-extents (-1 left/bottom .. 1 right/top), z = +1 in front of the camera, -1 behind it.
   */
  private viewDirection(x: number, y: number, z: number): THREE.Vector3 {
    const e = this.camera.matrixWorld.elements;
    const right = new THREE.Vector3(e[0], e[1], e[2]);
    const up = new THREE.Vector3(e[4], e[5], e[6]);
    const back = new THREE.Vector3(e[8], e[9], e[10]);
    const tanY = Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2));
    const tanX = tanY * this.camera.aspect;
    return back
      .multiplyScalar(-z)
      .addScaledVector(right, x * tanX)
      .addScaledVector(up, y * tanY)
      .normalize();
  }

  update(dt: number): void {
    this.time += dt;
    this.distance += dt * this.speed;
    const t = this.time;
    this.starfield.update(t);
    this.nebula.update(t);
    this.planet.update(t);
    // A very slow sky turn sells the forward motion without moving the composition.
    this.sky.rotation.y = t * 0.004;
    this.updateTies();
    this.updateDust(dt);
    // The express sways gently on its rail.
    this.train.position.y = Math.sin(t * 1.3) * 0.06;
    this.train.rotation.z = Math.sin(t * 0.7) * 0.006;
    // Slow, breathing camera drift.
    this.camera.position.set(
      this.cameraBase.x + Math.sin(t * 0.09) * 0.9,
      this.cameraBase.y + Math.sin(t * 0.13) * 0.4,
      this.cameraBase.z + Math.sin(t * 0.07) * 0.6,
    );
    this.camera.lookAt(this.cameraTarget);
  }

  dispose(): void {
    this.starfield.dispose();
    this.nebula.dispose();
    this.planet.dispose();
    for (const d of this.disposables) d.dispose();
  }

  private track<T extends { dispose(): void }>(x: T): T {
    this.disposables.push(x);
    return x;
  }

  /** Point on the rail centre-line at signed distance `s` ahead of the locomotive. */
  private railPoint(s: number, lateral: number, out: THREE.Vector3): THREE.Vector3 {
    return out.copy(this.forward).multiplyScalar(s).addScaledVector(this.right, lateral);
  }

  private createSunGlow(dir: THREE.Vector3): THREE.Mesh {
    const mat = this.track(
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        fog: false,
        blending: THREE.AdditiveBlending,
        vertexShader: /* glsl */ `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
        fragmentShader: /* glsl */ `
          varying vec2 vUv;
          void main() {
            vec2 p = vUv - 0.5; float d = length(p);
            float core = exp(-d * d * 1400.0) * 1.3;
            float halo = exp(-d * d * 60.0) * 0.14;
            float flare = pow(max(0.0, 1.0 - abs(p.y) * 120.0), 6.0) * exp(-abs(p.x) * 8.0) * 0.3;
            vec3 col = vec3(1.0, 0.9, 0.74) * (core + halo + flare);
            gl_FragColor = vec4(col, clamp(core + halo + flare, 0.0, 1.0));
          }`,
      }),
    );
    const glow = new THREE.Mesh(this.track(new THREE.PlaneGeometry(1400, 1400)), mat);
    glow.position.copy(dir).multiplyScalar(2200);
    glow.lookAt(0, 0, 0);
    glow.renderOrder = -5;
    return glow;
  }

  private createRails(): THREE.Group {
    const group = new THREE.Group();
    const a = (lat: number) => new THREE.LineCurve3(this.railPoint(-RAIL_BEHIND, lat, new THREE.Vector3()), this.railPoint(RAIL_AHEAD, lat, new THREE.Vector3()));
    const goldRail = this.track(new THREE.MeshBasicMaterial({ color: new THREE.Color('#ffe7b8').multiplyScalar(1.2), toneMapped: false }));
    const cyanRail = this.track(new THREE.MeshBasicMaterial({ color: new THREE.Color('#a8e0ff').multiplyScalar(1.1), toneMapped: false }));
    group.add(
      new THREE.Mesh(this.track(new THREE.TubeGeometry(a(0), 8, 0.1, 8, false)), goldRail),
      new THREE.Mesh(this.track(new THREE.TubeGeometry(a(RAIL_GAUGE), 8, 0.085, 8, false)), cyanRail),
    );
    const halo = new THREE.Mesh(
      this.track(new THREE.TubeGeometry(a(RAIL_GAUGE / 2), 8, 0.9, 12, false)),
      this.track(new THREE.MeshBasicMaterial({ color: '#3d6bc4', transparent: true, opacity: 0.035, blending: THREE.AdditiveBlending, depthWrite: false })),
    );
    group.add(halo);
    return group;
  }

  private createTies(): { mesh: THREE.InstancedMesh; count: number } {
    const count = Math.ceil((RAIL_BEHIND + RAIL_AHEAD) / TIE_SPACING);
    const mat = this.track(new THREE.MeshBasicMaterial({ color: new THREE.Color('#ffd79a').multiplyScalar(1.1), toneMapped: false, transparent: true, opacity: 0.75 }));
    const mesh = new THREE.InstancedMesh(this.track(new THREE.BoxGeometry(RAIL_GAUGE + 0.9, 0.05, 0.18)), mat, count);
    mesh.frustumCulled = false;
    return { mesh, count };
  }

  private updateTies(): void {
    const phase = this.distance % TIE_SPACING;
    const q = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().lookAt(new THREE.Vector3(), this.forward, UP));
    const m = new THREE.Matrix4();
    const p = new THREE.Vector3();
    const one = new THREE.Vector3(1, 1, 1);
    for (let i = 0; i < this.tieCount; i++) {
      // Ties move backwards relative to the express.
      const s = -RAIL_BEHIND + i * TIE_SPACING - phase;
      m.compose(this.railPoint(s, RAIL_GAUGE / 2, p), q, one);
      this.ties.setMatrixAt(i, m);
    }
    this.ties.instanceMatrix.needsUpdate = true;
  }

  private createDust(count: number): { points: THREE.Points; s: Float32Array; speed: Float32Array; offset: Float32Array } {
    const rand = mulberry32(99);
    const s = new Float32Array(count);
    const speed = new Float32Array(count);
    const offset = new Float32Array(count * 2);
    for (let i = 0; i < count; i++) {
      s[i] = DUST_MIN + rand() * (DUST_MAX - DUST_MIN);
      speed[i] = 0.6 + rand() * 1.2;
      const r = 1.5 + Math.pow(rand(), 2) * 22;
      const a = rand() * Math.PI * 2;
      offset[i * 2] = Math.cos(a) * r;
      offset[i * 2 + 1] = Math.sin(a) * r * 0.6;
    }
    const geo = this.track(new THREE.BufferGeometry());
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
    const mat = this.track(
      new THREE.PointsMaterial({ color: new THREE.Color('#ffe2a8'), size: 0.22, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false }),
    );
    const points = new THREE.Points(geo, mat);
    points.frustumCulled = false;
    return { points, s, speed, offset };
  }

  private updateDust(dt: number): void {
    const attr = this.dust.geometry.getAttribute('position') as THREE.BufferAttribute;
    const p = new THREE.Vector3();
    for (let i = 0; i < attr.count; i++) {
      let s = (this.dustS[i] as number) - dt * this.speed * (this.dustSpeed[i] as number);
      if (s < DUST_MIN) s += DUST_MAX - DUST_MIN;
      this.dustS[i] = s;
      this.railPoint(s, RAIL_GAUGE / 2 + (this.dustOffset[i * 2] as number), p);
      attr.setXYZ(i, p.x, p.y + (this.dustOffset[i * 2 + 1] as number), p.z);
    }
    attr.needsUpdate = true;
  }

  private createCar(isLocomotive: boolean): THREE.Group {
    const car = new THREE.Group();
    const hull = this.track(new THREE.MeshStandardMaterial({ color: '#e7e1d4', metalness: 0.45, roughness: 0.3 }));
    const navy = this.track(new THREE.MeshStandardMaterial({ color: '#141c40', metalness: 0.6, roughness: 0.38 }));
    const band = this.track(new THREE.MeshStandardMaterial({ color: '#25336e', metalness: 0.55, roughness: 0.35 }));
    const gold = this.track(new THREE.MeshStandardMaterial({ color: '#d9b475', metalness: 0.9, roughness: 0.25, emissive: '#6b4a1a', emissiveIntensity: 0.8 }));
    const windowMat = this.track(new THREE.MeshBasicMaterial({ color: new THREE.Color('#ffd89a').multiplyScalar(1.2), toneMapped: false }));

    car.add(new THREE.Mesh(this.track(new RoundedBoxGeometry(2.3, 2.5, CAR_LENGTH, 4, 0.55)), hull));
    const roof = new THREE.Mesh(this.track(new RoundedBoxGeometry(2.1, 0.5, CAR_LENGTH - 0.5, 3, 0.22)), navy);
    roof.position.y = 1.3;
    car.add(roof);
    const stripe = new THREE.Mesh(this.track(new THREE.BoxGeometry(2.34, 0.7, CAR_LENGTH - 0.9)), band);
    stripe.position.y = -0.62;
    car.add(stripe);
    const skirt = new THREE.Mesh(this.track(new THREE.BoxGeometry(2.0, 0.4, CAR_LENGTH - 0.6)), navy);
    skirt.position.y = -1.3;
    car.add(skirt);
    for (const s of [-1, 1]) {
      const trim = new THREE.Mesh(this.track(new THREE.BoxGeometry(0.04, 0.08, CAR_LENGTH - 0.8)), gold);
      trim.position.set(s * 1.18, -0.22, 0);
      car.add(trim);
      const windows = isLocomotive ? 2 : 5;
      const span = isLocomotive ? 2.2 : CAR_LENGTH - 2;
      for (let w = 0; w < windows; w++) {
        const win = new THREE.Mesh(this.track(new THREE.BoxGeometry(0.04, 0.6, 0.8)), windowMat);
        win.position.set(s * 1.16, 0.38, -span / 2 + (w + 0.5) * (span / windows) - (isLocomotive ? 1.6 : 0));
        car.add(win);
      }
    }
    if (isLocomotive) {
      const nose = new THREE.Mesh(this.track(new THREE.SphereGeometry(1.2, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2)), hull);
      nose.rotation.x = Math.PI / 2;
      nose.scale.set(0.95, 1.9, 1.0);
      nose.position.z = CAR_LENGTH / 2 - 0.2;
      car.add(nose);
      const lampMat = this.track(new THREE.MeshBasicMaterial({ color: new THREE.Color('#fff4dc').multiplyScalar(1.25), toneMapped: false }));
      const lamp = new THREE.Mesh(this.track(new THREE.SphereGeometry(0.26, 16, 12)), lampMat);
      lamp.position.set(0, 0.1, CAR_LENGTH / 2 + 2.0);
      car.add(lamp);
      const ring = new THREE.Mesh(this.track(new THREE.TorusGeometry(0.6, 0.07, 8, 32)), gold);
      ring.position.set(0, 0.1, CAR_LENGTH / 2 + 1.86);
      car.add(ring);
      const beam = new THREE.Mesh(
        this.track(new THREE.ConeGeometry(2.2, 26, 24, 1, true)),
        this.track(new THREE.MeshBasicMaterial({ color: '#ffe9c2', transparent: true, opacity: 0.018, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide })),
      );
      beam.rotation.x = -Math.PI / 2;
      beam.position.set(0, 0.1, CAR_LENGTH / 2 + 15);
      car.add(beam);
      const head = new THREE.PointLight(0xffe6b8, 6, 30, 2);
      head.position.set(0, 0.4, CAR_LENGTH / 2 + 3);
      car.add(head);
    }
    return car;
  }
}
