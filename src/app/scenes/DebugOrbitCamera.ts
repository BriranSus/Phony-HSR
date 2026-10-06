import * as THREE from 'three';
import type { InputManager } from '@core/input/InputManager';
import type { GameConfig } from '@core/config/GameConfig';

const MAX_PAN_RADIUS = 9;

/**
 * Developer orbit camera for the Phase-1 sandbox. It exists to prove the action-mapped input path
 * end-to-end; the real camera system (exploration/combat/cinematic rigs) is Phase 3.
 */
export class DebugOrbitCamera {
  readonly target = new THREE.Vector3(0, 1.2, 0);
  private yaw = 0.6;
  private pitch = 0.32;
  private distance = 18;
  private goalYaw = this.yaw;
  private goalPitch = this.pitch;
  private goalDistance = this.distance;
  private readonly goalTarget = this.target.clone();

  constructor(
    readonly camera: THREE.PerspectiveCamera,
    private readonly input: InputManager,
    private readonly settings: () => GameConfig['camera'],
  ) {}

  update(dt: number): void {
    const s = this.settings();
    const i = this.input;
    if (i.isDown('cameraDrag')) {
      this.goalYaw -= i.pointerDeltaX * s.orbitSensitivity;
      this.goalPitch += i.pointerDeltaY * s.orbitSensitivity * (s.invertY ? -1 : 1);
    }
    this.goalYaw += i.axis('cameraRotateRight', 'cameraRotateLeft') * dt * 1.6;
    const zoomKeys = i.axis('cameraZoomIn', 'cameraZoomOut');
    this.goalDistance *= Math.exp(i.wheelDelta * s.zoomSensitivity + zoomKeys * dt * 1.2);
    this.goalDistance = THREE.MathUtils.clamp(this.goalDistance, 5, 60);
    this.goalPitch = THREE.MathUtils.clamp(this.goalPitch, 0.08, 1.35);

    const forward = i.axis('moveBack', 'moveForward');
    const strafe = i.axis('moveLeft', 'moveRight');
    if (forward !== 0 || strafe !== 0) {
      const speed = (i.isDown('sprint') ? 16 : 8) * dt;
      const fx = -Math.sin(this.goalYaw);
      const fz = -Math.cos(this.goalYaw);
      this.goalTarget.x += (fx * forward - fz * strafe) * speed;
      this.goalTarget.z += (fz * forward + fx * strafe) * speed;
      // Keep the focus point over the platform so the sandbox never loses its subject.
      const r = Math.hypot(this.goalTarget.x, this.goalTarget.z);
      if (r > MAX_PAN_RADIUS) {
        this.goalTarget.x *= MAX_PAN_RADIUS / r;
        this.goalTarget.z *= MAX_PAN_RADIUS / r;
      }
    }

    // Critically damped smoothing, frame-rate independent.
    const k = 1 - Math.exp(-dt * 10);
    this.yaw += (this.goalYaw - this.yaw) * k;
    this.pitch += (this.goalPitch - this.pitch) * k;
    this.distance += (this.goalDistance - this.distance) * k;
    this.target.lerp(this.goalTarget, k);

    const cp = Math.cos(this.pitch);
    this.camera.position.set(
      this.target.x + Math.sin(this.yaw) * cp * this.distance,
      this.target.y + Math.sin(this.pitch) * this.distance,
      this.target.z + Math.cos(this.yaw) * cp * this.distance,
    );
    this.camera.lookAt(this.target);
  }
}
