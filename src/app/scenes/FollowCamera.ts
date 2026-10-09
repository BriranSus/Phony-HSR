import * as THREE from 'three';
import type { InputManager } from '@core/input/InputManager';
import type { GameConfig } from '@core/config/GameConfig';
import type { ExplorationCamera } from '@modules/camera';

type Vec = { readonly x: number; readonly y: number; readonly z: number };

/**
 * Phase-2 playtest follow camera: stays behind and above the character, rotates with right-mouse
 * drag, Z / C or the right stick, zooms with the wheel (when no interaction list is open), and
 * smooths its position. It implements `ExplorationCamera`; the Phase-3 camera rig (collision,
 * auto-recentering, combat shots) replaces it behind the same interface.
 */
export class FollowCamera implements ExplorationCamera {
  yaw = 0;
  private pitch: number;
  private distance: number;
  private readonly focus = new THREE.Vector3();
  private readonly desired = new THREE.Vector3();
  private initialised = false;
  /** When false, the wheel belongs to the interaction prompt list. */
  wheelZoom = true;

  constructor(
    readonly camera: THREE.PerspectiveCamera,
    private readonly input: InputManager,
    private readonly settings: () => GameConfig['camera'],
  ) {
    const f = settings().follow;
    this.pitch = f.pitch;
    this.distance = f.distance;
  }

  reset(target: Vec, yaw: number): void {
    this.yaw = yaw;
    this.initialised = false;
    this.update(0, target);
  }

  update(dt: number, target: Vec): void {
    const s = this.settings();
    const f = s.follow;
    const inv = s.invertY ? -1 : 1;
    if (this.input.isDown('cameraDrag')) {
      this.yaw -= this.input.pointerDeltaX * s.orbitSensitivity;
      this.pitch += this.input.pointerDeltaY * s.orbitSensitivity * inv;
    }
    const keys = this.input.axis('cameraRotateLeft', 'cameraRotateRight');
    const stick = this.input.stick('right');
    this.yaw -= (keys + stick.x) * f.rotateSpeed * dt;
    this.pitch -= stick.y * f.rotateSpeed * 0.6 * dt * inv;
    this.pitch = Math.min(f.maxPitch, Math.max(f.minPitch, this.pitch));
    const wheel = this.wheelZoom ? this.input.wheelDelta : 0;
    const zoom = this.input.axis('cameraZoomIn', 'cameraZoomOut') * dt * 6;
    this.distance = Math.min(f.maxDistance, Math.max(f.minDistance, this.distance * Math.exp(wheel * s.zoomSensitivity) + zoom));

    this.focus.set(target.x, target.y + f.height, target.z);
    const horizontal = Math.cos(this.pitch) * this.distance;
    this.desired.set(this.focus.x - Math.sin(this.yaw) * horizontal, this.focus.y + Math.sin(this.pitch) * this.distance, this.focus.z - Math.cos(this.yaw) * horizontal);
    if (!this.initialised || dt === 0) {
      this.camera.position.copy(this.desired);
      this.initialised = true;
    } else {
      this.camera.position.lerp(this.desired, 1 - Math.exp(-f.smoothing * dt));
    }
    this.camera.lookAt(this.focus);
  }
}
