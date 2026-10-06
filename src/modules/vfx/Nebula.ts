import * as THREE from 'three';

export interface NebulaPalette {
  base: string;
  deep: string;
  cloudA: string;
  cloudB: string;
  dust: string;
}

export const DEFAULT_NEBULA: NebulaPalette = {
  base: '#03050d',
  deep: '#0b1436',
  cloudA: '#45318f',
  cloudB: '#1f6a9c',
  dust: '#c48ad6',
};

/**
 * Procedural nebula sky dome: fractal noise evaluated on view direction, layered into deep-navy
 * space, violet/teal gas clouds and a faint warm dust lane. Rendered on a back-faced sphere.
 */
export class Nebula {
  readonly object: THREE.Mesh;
  private readonly material: THREE.ShaderMaterial;

  constructor(radius = 1200, palette: NebulaPalette = DEFAULT_NEBULA) {
    this.material = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: {
        uTime: { value: 0 },
        uBase: { value: new THREE.Color(palette.base) },
        uDeep: { value: new THREE.Color(palette.deep) },
        uCloudA: { value: new THREE.Color(palette.cloudA) },
        uCloudB: { value: new THREE.Color(palette.cloudB) },
        uDust: { value: new THREE.Color(palette.dust) },
      },
      vertexShader: /* glsl */ `
        varying vec3 vDir;
        void main() {
          vDir = normalize(position);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        uniform float uTime;
        uniform vec3 uBase, uDeep, uCloudA, uCloudB, uDust;
        varying vec3 vDir;

        float hash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
        float noise(vec3 x) {
          vec3 i = floor(x); vec3 f = fract(x); f = f * f * (3.0 - 2.0 * f);
          return mix(mix(mix(hash(i), hash(i + vec3(1,0,0)), f.x), mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
                     mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x), mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y), f.z);
        }
        float fbm(vec3 p) {
          float v = 0.0; float a = 0.5;
          for (int i = 0; i < 6; i++) { v += a * noise(p); p = p * 2.03 + vec3(1.7, 9.2, 3.1); a *= 0.5; }
          return v;
        }
        void main() {
          vec3 d = normalize(vDir);
          float t = uTime * 0.004;
          // Vertical gradient: deeper blue towards the horizon band.
          float horizon = 1.0 - abs(d.y);
          vec3 col = mix(uBase, uDeep, pow(horizon, 2.5) * 0.9);
          // Galactic band (tilted).
          vec3 bandAxis = normalize(vec3(0.35, 1.0, 0.25));
          float band = exp(-pow(dot(d, bandAxis) * 3.2, 2.0));
          float n1 = fbm(d * 2.4 + vec3(t, 0.0, -t));
          float n2 = fbm(d * 5.1 - vec3(0.0, t, 0.0));
          float clouds = smoothstep(0.42, 0.85, n1) * (0.35 + band * 0.9);
          col += uCloudA * clouds * 0.75;
          col += uCloudB * smoothstep(0.5, 0.9, n2) * band * 0.55;
          // Warm dust lane threading through the band.
          float dust = smoothstep(0.55, 0.75, fbm(d * 9.0 + 4.0)) * band;
          col += uDust * dust * 0.12;
          // Soft glow hotspot (distant galactic core) to the upper right.
          float core = pow(max(dot(d, normalize(vec3(0.6, 0.25, -0.75))), 0.0), 18.0);
          col += vec3(0.95, 0.82, 0.62) * core * 0.55;
          gl_FragColor = vec4(col, 1.0);
        }`,
    });
    this.object = new THREE.Mesh(new THREE.SphereGeometry(radius, 48, 32), this.material);
    this.object.frustumCulled = false;
    this.object.renderOrder = -20;
  }

  update(time: number): void {
    (this.material.uniforms.uTime as THREE.IUniform<number>).value = time;
  }

  dispose(): void {
    this.object.geometry.dispose();
    this.material.dispose();
  }
}
