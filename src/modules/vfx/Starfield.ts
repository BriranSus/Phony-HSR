import * as THREE from 'three';

export interface StarfieldOptions {
  count: number;
  innerRadius?: number;
  outerRadius?: number;
  /** Base point size in pixels (before pixel ratio). */
  size?: number;
  seed?: number;
}

/** Deterministic PRNG (mulberry32) so the sky is identical across sessions and screenshots. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const STAR_TINTS = [
  new THREE.Color('#ffffff'),
  new THREE.Color('#dfe8ff'),
  new THREE.Color('#bcd2ff'),
  new THREE.Color('#ffe9c4'),
  new THREE.Color('#f6d28f'),
  new THREE.Color('#d6c4ff'),
];

/**
 * Procedural twinkling starfield rendered as additive point sprites on a spherical shell.
 * A fraction of stars is concentrated in a tilted "galactic band" for a more painterly sky.
 */
export class Starfield {
  readonly object: THREE.Points;
  private readonly material: THREE.ShaderMaterial;

  constructor(options: StarfieldOptions) {
    const { count, innerRadius = 500, outerRadius = 900, size = 2.2, seed = 1337 } = options;
    const rand = mulberry32(seed);
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const sizes = new Float32Array(count);
    const phases = new Float32Array(count);
    const band = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.45, 0, -0.35));
    const v = new THREE.Vector3();

    for (let i = 0; i < count; i++) {
      const inBand = rand() < 0.45;
      const u = rand() * 2 - 1;
      const theta = rand() * Math.PI * 2;
      if (inBand) {
        // Concentrate near the band's equator.
        const lat = (rand() + rand() + rand() - 1.5) * 0.22;
        v.set(Math.cos(theta) * Math.cos(lat), Math.sin(lat), Math.sin(theta) * Math.cos(lat)).applyQuaternion(band);
      } else {
        const r = Math.sqrt(1 - u * u);
        v.set(r * Math.cos(theta), u, r * Math.sin(theta));
      }
      const radius = innerRadius + rand() * (outerRadius - innerRadius);
      positions.set([v.x * radius, v.y * radius, v.z * radius], i * 3);
      const tint = STAR_TINTS[Math.floor(rand() * STAR_TINTS.length)] as THREE.Color;
      const bright = 0.55 + rand() * 0.45;
      colors.set([tint.r * bright, tint.g * bright, tint.b * bright], i * 3);
      // Mostly small stars, a few large ones.
      const big = rand();
      sizes[i] = size * (big > 0.985 ? 3.2 : big > 0.93 ? 1.8 : 0.6 + rand() * 0.8);
      phases[i] = rand();
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));
    geometry.setAttribute('phase', new THREE.BufferAttribute(phases, 1));

    this.material = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uPixelRatio: { value: Math.min(window.devicePixelRatio || 1, 2) } },
      vertexShader: /* glsl */ `
        attribute float size;
        attribute float phase;
        attribute vec3 color;
        uniform float uTime;
        uniform float uPixelRatio;
        varying vec3 vColor;
        varying float vTwinkle;
        void main() {
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mv;
          float tw = 0.7 + 0.3 * sin(uTime * (0.8 + phase * 2.2) + phase * 6.2831);
          vTwinkle = tw;
          vColor = color;
          gl_PointSize = size * uPixelRatio * (0.85 + 0.3 * tw);
        }`,
      fragmentShader: /* glsl */ `
        varying vec3 vColor;
        varying float vTwinkle;
        void main() {
          vec2 c = gl_PointCoord - 0.5;
          float d = length(c);
          float core = 1.0 - smoothstep(0.0, 0.5, d);
          float glow = exp(-d * d * 22.0);
          float alpha = (core * 0.55 + glow) * vTwinkle;
          if (alpha < 0.01) discard;
          gl_FragColor = vec4(vColor * (0.6 + glow), alpha);
        }`,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });

    this.object = new THREE.Points(geometry, this.material);
    this.object.frustumCulled = false;
    this.object.renderOrder = -10;
  }

  update(time: number): void {
    (this.material.uniforms.uTime as THREE.IUniform<number>).value = time;
  }

  dispose(): void {
    this.object.geometry.dispose();
    this.material.dispose();
  }
}
