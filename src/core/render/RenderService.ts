import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import type { GameConfig } from '../config/GameConfig';

/**
 * Owns the single WebGL renderer and canvas. Game states create a `RenderView` (scene + camera +
 * optional post-processing) and call `view.render()` from their `render()` hook. The service keeps
 * every live view sized correctly on window resize and applies graphics settings from config.
 */
export interface RenderViewOptions {
  bloom?: boolean;
  bloomStrength?: number;
  bloomRadius?: number;
  bloomThreshold?: number;
}

export interface RenderStats {
  readonly drawCalls: number;
  readonly triangles: number;
  readonly geometries: number;
  readonly textures: number;
  readonly width: number;
  readonly height: number;
  readonly pixelRatio: number;
}

export class RenderView {
  private composer: EffectComposer | null = null;
  private bloomPass: UnrealBloomPass | null = null;

  constructor(
    private readonly service: RenderService,
    readonly scene: THREE.Scene,
    readonly camera: THREE.PerspectiveCamera,
    options: RenderViewOptions,
  ) {
    if (options.bloom) {
      const r = service.renderer;
      const size = r.getSize(new THREE.Vector2());
      this.composer = new EffectComposer(r);
      this.composer.addPass(new RenderPass(scene, camera));
      this.bloomPass = new UnrealBloomPass(
        new THREE.Vector2(size.x, size.y),
        options.bloomStrength ?? 0.8,
        options.bloomRadius ?? 0.6,
        options.bloomThreshold ?? 0.2,
      );
      this.composer.addPass(this.bloomPass);
      this.composer.addPass(new OutputPass());
    }
    this.resize(service.width, service.height, service.pixelRatio);
  }

  render(): void {
    if (this.composer) this.composer.render();
    else this.service.renderer.render(this.scene, this.camera);
  }

  resize(width: number, height: number, pixelRatio: number): void {
    this.camera.aspect = width / Math.max(1, height);
    this.camera.updateProjectionMatrix();
    if (this.composer) {
      this.composer.setPixelRatio(pixelRatio);
      this.composer.setSize(width, height);
    }
  }

  setBloomStrength(strength: number): void {
    if (this.bloomPass) this.bloomPass.strength = strength;
  }

  dispose(): void {
    this.composer?.dispose();
    this.service.releaseView(this);
  }
}

export class RenderService {
  readonly renderer: THREE.WebGLRenderer;
  private readonly views = new Set<RenderView>();
  private _width = 1;
  private _height = 1;
  private _pixelRatio = 1;
  private graphics: GameConfig['graphics'];
  private readonly resizeObserver: ResizeObserver | null;

  constructor(
    private readonly container: HTMLElement,
    graphics: GameConfig['graphics'],
  ) {
    this.graphics = graphics;
    this.renderer = new THREE.WebGLRenderer({
      antialias: graphics.antialias,
      powerPreference: 'high-performance',
      alpha: false,
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = graphics.toneMappingExposure;
    this.renderer.setClearColor(0x05070f, 1);
    this.renderer.domElement.classList.add('game-canvas');
    // Frame statistics accumulate over all passes of a frame and are reset in beginFrame().
    this.renderer.info.autoReset = false;
    container.appendChild(this.renderer.domElement);
    this.resizeObserver = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => this.resize()) : null;
    this.resizeObserver?.observe(container);
    this.resize();
  }

  static isWebGLAvailable(): boolean {
    try {
      const canvas = document.createElement('canvas');
      return !!(canvas.getContext('webgl2') ?? canvas.getContext('webgl'));
    } catch {
      return false;
    }
  }

  get width(): number {
    return this._width;
  }
  get height(): number {
    return this._height;
  }
  get pixelRatio(): number {
    return this._pixelRatio;
  }
  get canvas(): HTMLCanvasElement {
    return this.renderer.domElement;
  }

  createView(scene: THREE.Scene, camera: THREE.PerspectiveCamera, options: RenderViewOptions = {}): RenderView {
    const bloom = (options.bloom ?? false) && this.graphics.bloom && this.graphics.quality !== 'low';
    const view = new RenderView(this, scene, camera, {
      ...options,
      bloom,
      bloomStrength: options.bloomStrength ?? this.graphics.bloomStrength,
    });
    this.views.add(view);
    return view;
  }

  releaseView(view: RenderView): void {
    this.views.delete(view);
  }

  applyGraphics(graphics: GameConfig['graphics']): void {
    this.graphics = graphics;
    this.renderer.toneMappingExposure = graphics.toneMappingExposure;
    this.resize();
  }

  resize(): void {
    const w = Math.max(1, this.container.clientWidth || window.innerWidth);
    const h = Math.max(1, this.container.clientHeight || window.innerHeight);
    const qualityScale = this.graphics.quality === 'low' ? 0.75 : 1;
    this._pixelRatio = Math.min(window.devicePixelRatio || 1, this.graphics.pixelRatioCap) * qualityScale;
    this._width = w;
    this._height = h;
    this.renderer.setPixelRatio(this._pixelRatio);
    this.renderer.setSize(w, h, false);
    for (const v of this.views) v.resize(w, h, this._pixelRatio);
  }

  /** Call once per frame before any view renders (resets per-frame statistics). */
  beginFrame(): void {
    const info = this.renderer.info;
    this.lastFrame = { calls: info.render.calls, triangles: info.render.triangles };
    info.reset();
  }

  private lastFrame = { calls: 0, triangles: 0 };

  /** Statistics of the last completed frame (all views and post-processing passes). */
  stats(): RenderStats {
    const info = this.renderer.info;
    return {
      drawCalls: this.lastFrame.calls,
      triangles: this.lastFrame.triangles,
      geometries: info.memory.geometries,
      textures: info.memory.textures,
      width: this._width,
      height: this._height,
      pixelRatio: this._pixelRatio,
    };
  }

  /** Clear to the background colour (used by states without a 3D scene, e.g. loading). */
  clear(): void {
    this.renderer.clear();
  }

  dispose(): void {
    this.resizeObserver?.disconnect();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
