import * as THREE from 'three';

export interface PlanetOptions {
  radius: number;
  colorA: string;
  colorB: string;
  atmosphere: string;
  lightDir: THREE.Vector3;
  bands?: number;
  ring?: boolean;
}

/**
 * Procedural banded planet with day/night terminator, Fresnel atmosphere halo and optional ring.
 */
export class Planet {
  readonly object = new THREE.Group();
  private readonly materials: THREE.ShaderMaterial[] = [];
  private readonly geometries: THREE.BufferGeometry[] = [];

  constructor(o: PlanetOptions) {
    const light = o.lightDir.clone().normalize();
    const surface = new THREE.ShaderMaterial({
      uniforms: {
        uA: { value: new THREE.Color(o.colorA) },
        uB: { value: new THREE.Color(o.colorB) },
        uAtmo: { value: new THREE.Color(o.atmosphere) },
        uLight: { value: light },
        uBands: { value: o.bands ?? 7 },
        uTime: { value: 0 },
      },
      vertexShader: /* glsl */ `
        varying vec3 vN; varying vec3 vLocal; varying vec3 vView;
        void main() {
          vLocal = normalize(position);
          vN = normalize(mat3(modelMatrix) * normal);
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vView = normalize(cameraPosition - wp.xyz);
          gl_Position = projectionMatrix * viewMatrix * wp;
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uA, uB, uAtmo, uLight; uniform float uBands; uniform float uTime;
        varying vec3 vN; varying vec3 vLocal; varying vec3 vView;
        float h(float n) { return fract(sin(n) * 43758.5453); }
        float n1(float x) { float i = floor(x); float f = fract(x); return mix(h(i), h(i + 1.0), f * f * (3.0 - 2.0 * f)); }
        void main() {
          float lat = vLocal.y;
          float swirl = n1(vLocal.x * 6.0 + vLocal.z * 4.0 + uTime * 0.02) * 0.35;
          float b = 0.5 + 0.5 * sin((lat + swirl * 0.15) * uBands * 3.14159);
          vec3 col = mix(uA, uB, b);
          col *= 0.85 + 0.3 * n1(lat * 40.0 + swirl * 8.0);
          float ndl = dot(normalize(vN), uLight);
          float day = smoothstep(-0.15, 0.6, ndl);
          col *= 0.04 + day;
          float rim = pow(1.0 - max(dot(normalize(vN), vView), 0.0), 3.0);
          col += uAtmo * rim * (0.25 + day) * 0.9;
          gl_FragColor = vec4(col, 1.0);
        }`,
    });
    const geo = new THREE.SphereGeometry(o.radius, 96, 64);
    this.object.add(new THREE.Mesh(geo, surface));

    const halo = new THREE.ShaderMaterial({
      uniforms: { uAtmo: { value: new THREE.Color(o.atmosphere) }, uLight: { value: light } },
      vertexShader: /* glsl */ `
        varying vec3 vN; varying vec3 vView;
        void main() {
          vN = normalize(mat3(modelMatrix) * normal);
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vView = normalize(cameraPosition - wp.xyz);
          gl_Position = projectionMatrix * viewMatrix * wp;
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uAtmo; uniform vec3 uLight;
        varying vec3 vN; varying vec3 vView;
        void main() {
          float rim = 1.0 - abs(dot(normalize(vN), vView));
          float glow = pow(rim, 4.0);
          float lit = 0.35 + 0.65 * smoothstep(-0.4, 0.8, dot(normalize(vN), uLight));
          gl_FragColor = vec4(uAtmo * glow * lit * 1.6, glow * lit);
        }`,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.BackSide,
    });
    const haloGeo = new THREE.SphereGeometry(o.radius * 1.08, 64, 48);
    this.object.add(new THREE.Mesh(haloGeo, halo));
    this.materials.push(surface, halo);
    this.geometries.push(geo, haloGeo);

    if (o.ring) {
      const ringGeo = new THREE.RingGeometry(o.radius * 1.45, o.radius * 2.2, 128, 1);
      const ringMat = new THREE.ShaderMaterial({
        uniforms: { uColor: { value: new THREE.Color(o.colorB) }, uInner: { value: o.radius * 1.45 }, uOuter: { value: o.radius * 2.2 } },
        vertexShader: /* glsl */ `varying vec3 vP; void main() { vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
        fragmentShader: /* glsl */ `
          uniform vec3 uColor; uniform float uInner; uniform float uOuter; varying vec3 vP;
          void main() {
            float r = (length(vP.xy) - uInner) / (uOuter - uInner);
            float bands = 0.55 + 0.45 * sin(r * 70.0) * sin(r * 23.0 + 1.3);
            float edge = smoothstep(0.0, 0.08, r) * (1.0 - smoothstep(0.8, 1.0, r));
            gl_FragColor = vec4(uColor * 1.2, bands * edge * 0.45);
          }`,
        transparent: true,
        side: THREE.DoubleSide,
        depthWrite: false,
      });
      const ring = new THREE.Mesh(ringGeo, ringMat);
      ring.rotation.x = Math.PI * 0.42;
      ring.rotation.y = 0.25;
      this.object.add(ring);
      this.materials.push(ringMat);
      this.geometries.push(ringGeo);
    }
  }

  update(time: number): void {
    const u = this.materials[0]?.uniforms.uTime as THREE.IUniform<number> | undefined;
    if (u) u.value = time;
    this.object.rotation.y = time * 0.01;
  }

  dispose(): void {
    for (const m of this.materials) m.dispose();
    for (const g of this.geometries) g.dispose();
  }
}
