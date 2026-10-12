import type { GameState } from '@core/state/StateManager';
import type { RenderView } from '@core/render/RenderService';
import { Collections } from '@models/collections';
import { ExplorationHud } from '@modules/ui';
import { NO_INPUT, OverworldController, type ControlInput, type ControllerEvent } from '@modules/player';
import { CameraDirector, ShotProvider, ExplorationProvider, ExplorationRig, lineOfSightBlocked, v3, type CameraInput, type CameraPose, type UnitResolver } from '@modules/camera';
import type { CameraRules, CameraShot } from '@models/camera';
import type { Level } from '@models/locomotion';
import * as THREE from 'three';
import { TestLevelScene } from '../scenes/TestLevelScene';
import { PlaceholderCharacter } from '../scenes/PlaceholderCharacter';
import type { AppContext } from '../AppContext';
import { StateIds } from '../AppContext';

const STEP = 1 / 60;

/**
 * Exploration test level ("Explore Test Level" on the Departure Board). Builds the level, party,
 * controller and camera director from data, turns the action map into a `ControlInput` and a
 * `CameraInput` each frame, runs the controller in fixed sub-steps, forwards its hook events to
 * the bus and the HUD, poses the placeholder model, and applies the director's pose to the scene
 * camera. F4 opens the Camera Gallery, which previews every data-defined shot (Phase 3); scripted
 * shots gate the player's input.
 */
export class TestSceneState implements GameState {
  readonly id = StateIds.testScene;
  private level: TestLevelScene | null = null;
  private view: RenderView | null = null;
  private director: CameraDirector | null = null;
  private explore: ExplorationProvider | null = null;
  private cameraRules: CameraRules | null = null;
  private shots: CameraShot[] = [];
  private levelDef: Level | null = null;
  private galleryOpen = false;
  private playing: string | null = null;
  private lastFov = 0;
  private model: PlaceholderCharacter | null = null;
  private controller: OverworldController | null = null;
  private hud: ExplorationHud | null = null;
  private unmount: (() => void) | null = null;
  private promptsOpen = false;

  constructor(private readonly ctx: AppContext) {}

  enter(): void {
    const { data, config, render, ui, debug } = this.ctx;
    const levelDef = data.get(Collections.levels, 'level.test-grounds');
    const rules = data.get(Collections.locomotionRules, 'default');
    const party = data.get(Collections.parties, 'default');
    const elementColor = new Map(data.all(Collections.elements).map((e) => [e.element, e.color]));
    const members = party.members.map((id) => data.get(Collections.characters, id));

    this.level = new TestLevelScene(levelDef, data.all(Collections.elements).map((e) => ({ name: e.element, color: e.color })), Math.round(config.get().graphics.starCount * 0.6));
    this.level.camera.fov = config.get().camera.fov;
    this.view = render.createView(this.level.scene, this.level.camera, { bloom: true, bloomRadius: 0.45, bloomThreshold: 0.6, bloomStrength: 0.55 });
    this.model = new PlaceholderCharacter(rules.capsule.height);
    this.level.scene.add(this.model.root);

    const hints: Array<[string, string]> = [
      ['WASD', 'Move'],
      ['Shift', 'Sprint'],
      ['Ctrl', 'Walk'],
      ['F', 'Interact'],
      ['E', 'Technique'],
      ['LMB', 'Attack'],
      ['1-4', 'Switch'],
      ['RMB', 'Camera'],
      ['X', 'Recenter'],
      ['F4', 'Gallery'],
    ];
    this.hud = new ExplorationHud(
      { name: levelDef.name, subtitle: levelDef.subtitle },
      members.map((c) => ({ id: c.id, name: c.name, element: c.element, color: elementColor.get(c.element) ?? '#ffffff' })),
      rules.interaction.maxVisible,
      hints,
      () => this.back(),
    );
    this.unmount = ui.mount(this.hud.el);

    this.controller = new OverworldController(rules, levelDef.colliders, levelDef.interactables, party.members, levelDef.spawn, levelDef.killHeight, (e) => this.onEvent(e));
    this.hud.setLeader(0);
    this.model.setCharacter(elementColor.get(members[0]!.element) ?? '#ffffff');
    // Camera: director with the exploration rig at the bottom of the stack.
    this.levelDef = levelDef;
    this.cameraRules = data.get(Collections.cameraRules, 'default');
    this.shots = data.all(Collections.cameraShots);
    const settings = () => config.get().camera;
    const rig = new ExplorationRig(this.cameraRules.exploration, levelDef.colliders, settings, levelDef.spawn.yaw);
    this.explore = new ExplorationProvider(rig, this.cameraRules.priorities.exploration ?? 0, () => this.cameraInput());
    this.director = new CameraDirector(this.cameraRules, () => config.get().camera.shakeIntensity);
    this.director.push(this.explore);
    this.explore.reset(this.controller, levelDef.spawn.yaw);
    render.canvas.addEventListener('click', this.onCanvasClick);
    if (config.get().debug.overlay) debug.toggle(true);
    if (window.__ASTRAL__) {
      window.__ASTRAL__.probes.exploration = () => this.probe();
      window.__ASTRAL__.probes.explorationTeleport = (x: number, z: number, yaw: number) => {
        this.controller?.teleport(x, 0, z, yaw);
        this.explore?.reset(this.controller!, yaw);
      };
    }
  }

  exit(): void {
    this.unmount?.();
    this.hud?.dispose();
    this.view?.dispose();
    this.model?.dispose();
    this.level?.dispose();
    this.ctx.debug.toggle(false);
    this.ctx.render.canvas.removeEventListener('click', this.onCanvasClick);
    if (document.pointerLockElement) document.exitPointerLock();
    if (window.__ASTRAL__) {
      delete window.__ASTRAL__.probes.exploration;
      delete window.__ASTRAL__.probes.explorationTeleport;
    }
    this.level = null;
    this.view = null;
    this.director = null;
    this.explore = null;
    this.model = null;
    this.controller = null;
    this.hud = null;
  }

  update(dt: number): void {
    const c = this.controller;
    const director = this.director;
    if (!c || !director || !this.explore || !this.level || !this.model) return;
    const i = this.ctx.input;

    // Camera Gallery (debug): F4 toggles; 1-6 play the shots; Esc closes it before leaving.
    if (i.wasPressed('cameraGallery')) this.setGallery(!this.galleryOpen);
    else if (this.galleryOpen && i.wasPressed('back')) this.setGallery(false);
    else if (i.wasPressed('back')) return this.back();
    if (this.galleryOpen) {
      const n = ['cameraShot1', 'cameraShot2', 'cameraShot3', 'cameraShot4', 'cameraShot5', 'cameraShot6'].findIndex((a) => i.wasPressed(a));
      if (n >= 0 && this.shots[n]) this.playShot(this.shots[n]!);
    }
    // Scripted shots and the gallery own the camera: the player's movement input is gated.
    const gated = this.galleryOpen || director.inputGated;
    if (!gated && i.wasPressed('cameraRecenter')) this.explore.rig.requestRecenter();

    const stick = i.stick('left');
    const slot = ['partySlot1', 'partySlot2', 'partySlot3', 'partySlot4'].findIndex((a) => i.wasPressed(a));
    const wheel = this.promptsOpen ? Math.sign(i.wheelDelta) : 0;
    const first: ControlInput = gated
      ? { ...NO_INPUT, cameraYaw: this.explore.yaw }
      : {
          right: clamp(i.axis('moveLeft', 'moveRight') + stick.x),
          forward: clamp(i.axis('moveBack', 'moveForward') + stick.y),
          cameraYaw: this.explore.yaw,
          sprint: i.isDown('sprint'),
          walkTogglePressed: i.wasPressed('walkToggle'),
          interactPressed: i.wasPressed('interact'),
          techniquePressed: i.wasPressed('technique'),
          attackPressed: i.wasPressed('overworldAttack'),
          slotPressed: slot >= 0 ? slot : null,
          promptScroll: wheel + (i.wasPressed('promptNext') ? 1 : 0) - (i.wasPressed('promptPrev') ? 1 : 0),
        };
    // Fixed sub-steps keep the simulation frame-rate independent; one-shot inputs apply once.
    const frame = Math.min(dt, 0.1);
    const steps = Math.max(1, Math.ceil(frame / STEP - 1e-6));
    for (let k = 0; k < steps; k++) {
      c.step(frame / steps, k === 0 ? first : { ...first, walkTogglePressed: false, interactPressed: false, techniquePressed: false, attackPressed: false, slotPressed: null, promptScroll: 0 });
    }
    this.explore.follow(c);
    const pose = director.update(frame);
    if (pose) this.applyPose(pose);
    this.model.apply(c.frame, c.x, c.y, c.z, c.yaw, frame);
    this.hud?.setGait(c.gait, c.speed > 0.25);
    this.hud?.setLetterbox(director.letterbox, this.cameraRules?.letterboxHeight ?? 0);
    this.level.update(dt);
  }

  /** Camera input from the action map: right-mouse drag (or pointer lock), Z / C, right stick, wheel. */
  private cameraInput(): CameraInput {
    const i = this.ctx.input;
    const locked = document.pointerLockElement === this.ctx.render.canvas;
    const look = locked || i.isDown('cameraDrag');
    const stick = i.stick('right');
    return {
      mouseDx: look ? i.pointerDeltaX : 0,
      mouseDy: look ? i.pointerDeltaY : 0,
      yawAxis: clamp(i.axis('cameraRotateLeft', 'cameraRotateRight') + stick.x),
      pitchAxis: stick.y,
      wheel: this.promptsOpen ? 0 : i.wheelDelta,
      zoomAxis: i.axis('cameraZoomIn', 'cameraZoomOut'),
    };
  }

  private applyPose(p: CameraPose): void {
    const cam = this.level!.camera;
    cam.position.set(p.position.x, p.position.y, p.position.z);
    cam.up.set(0, 1, 0);
    cam.lookAt(p.target.x, p.target.y, p.target.z);
    if (p.roll !== 0) cam.rotateZ(p.roll);
    if (Math.abs(p.fov - this.lastFov) > 1e-4) {
      cam.fov = p.fov;
      cam.updateProjectionMatrix();
      this.lastFov = p.fov;
    }
  }

  /** Named units for shot anchors: the player, level markers and interactables. */
  private readonly units: UnitResolver = (id) => {
    const c = this.controller;
    if (id === 'player' && c) return { position: v3(c.x, c.y, c.z), yaw: c.yaw };
    const m = this.levelDef?.markers.find((x) => x.id === id);
    if (m) return { position: v3(...m.position), yaw: m.yaw };
    const it = this.levelDef?.interactables.find((x) => x.id === id);
    return it ? { position: v3(...it.position), yaw: 0 } : undefined;
  };

  private setGallery(open: boolean): void {
    const c = this.controller;
    if (!c || !this.director || !this.explore || !this.levelDef) return;
    this.galleryOpen = open;
    this.director.stopShots();
    this.playing = null;
    if (open && this.levelDef.galleryStage) {
      // Stage the player in front of the dummies so every shot frames something meaningful.
      const st = this.levelDef.galleryStage;
      c.teleport(...st.position, st.yaw);
      this.explore.reset(c, st.yaw);
    }
    this.refreshGallery();
  }

  private playShot(shot: CameraShot): void {
    this.director!.stopShots();
    this.playing = shot.id;
    this.refreshGallery();
    void this.director!.playShot(shot, this.units).then(() => {
      if (this.playing === shot.id) {
        this.playing = null;
        this.refreshGallery();
      }
    });
  }

  private refreshGallery(): void {
    this.hud?.setGallery(this.galleryOpen ? this.shots.map((s, n) => ({ key: String(n + 1), name: s.name, mode: s.mode, id: s.id })) : null, this.playing);
  }

  /** Optional pointer lock (camera.pointerLock): clicking the scene captures the mouse. */
  private readonly onCanvasClick = (): void => {
    if (this.ctx.config.get().camera.pointerLock && document.pointerLockElement !== this.ctx.render.canvas) void this.ctx.render.canvas.requestPointerLock();
  };

  render(): void {
    this.view?.render();
  }

  private onEvent(e: ControllerEvent): void {
    const { bus, data } = this.ctx;
    switch (e.type) {
      case 'footstep':
        bus.emit('player:footstep', { characterId: e.characterId, foot: e.foot, gait: e.gait, material: e.material, position: e.position });
        break;
      case 'animationState':
        bus.emit('player:animationState', { state: e.state, clip: e.clip });
        break;
      case 'leaderChanged': {
        const c = data.get(Collections.characters, e.characterId);
        const color = data.all(Collections.elements).find((el) => el.element === c.element)?.color ?? '#ffffff';
        this.model?.setCharacter(color);
        this.hud?.setLeader(e.slot);
        this.hud?.toast(c.name);
        bus.emit('player:leaderChanged', { characterId: e.characterId, slot: e.slot, previous: e.previous });
        break;
      }
      case 'interact': {
        const speaker = e.interactable.kind === 'npc' ? e.interactable.label.replace(/^Talk:\s*/, '') : e.interactable.kind === 'sign' ? 'Notice' : 'Treasure';
        this.hud?.message(speaker, e.interactable.message);
        bus.emit('player:interact', { characterId: e.characterId, interactableId: e.interactable.id, kind: e.interactable.kind });
        break;
      }
      case 'technique': {
        const c = data.get(Collections.characters, e.characterId);
        this.hud?.toast(`Technique · ${c.abilities.technique.name}`);
        bus.emit('player:technique', { characterId: e.characterId, position: e.position });
        break;
      }
      case 'overworldAttack':
        this.hud?.toast('Attack · enemies enter combat in Phase 5');
        bus.emit('player:overworldAttack', { characterId: e.characterId, position: e.position, yaw: e.yaw });
        break;
      case 'prompts':
        this.promptsOpen = e.prompts.length > 0;
        this.hud?.setPrompts(
          e.prompts.map((p) => ({ id: p.id, kind: p.kind, label: p.label })),
          e.selected,
        );
        break;
      case 'respawn':
        this.hud?.toast('Returned to the spawn point');
        break;
    }
  }

  private probe(): Record<string, unknown> {
    const c = this.controller;
    if (!c) return {};
    return {
      x: c.x,
      y: c.y,
      z: c.z,
      yaw: c.yaw,
      speed: c.speed,
      gait: c.gait,
      state: c.frame.state.id,
      leader: c.leader,
      grounded: c.grounded,
      prompts: c.prompts.items.map((p) => p.interactable.id),
      selected: c.prompts.selected?.id ?? null,
      cameraYaw: this.explore?.yaw ?? 0,
      camera: this.cameraProbe(),
    };
  }

  private cameraProbe(): Record<string, unknown> {
    const c = this.controller;
    const cam = this.level?.camera;
    const rig = this.explore?.rig;
    if (!c || !cam || !rig || !this.levelDef) return {};
    const head = new THREE.Vector3(c.x, c.y + 1.35, c.z);
    const ndc = head.clone().project(cam);
    return {
      mode: this.director?.mode ?? null,
      gated: this.galleryOpen || (this.director?.inputGated ?? false),
      gallery: this.galleryOpen,
      playing: this.playing,
      shotTime: this.director?.providers().find((p): p is ShotProvider => p instanceof ShotProvider)?.time ?? null,
      yaw: rig.yaw,
      pitch: rig.pitch,
      zoom: rig.zoom,
      distance: rig.distance,
      idle: rig.idle,
      fov: cam.fov,
      letterbox: this.director?.letterbox ?? 0,
      trauma: this.director?.trauma ?? 0,
      position: [cam.position.x, cam.position.y, cam.position.z],
      playerNdc: [ndc.x, ndc.y, ndc.z],
      playerOnScreen: Math.abs(ndc.x) <= 1 && Math.abs(ndc.y) <= 1 && ndc.z < 1,
      playerOccluded: lineOfSightBlocked(this.levelDef.colliders, v3(cam.position.x, cam.position.y, cam.position.z), v3(head.x, head.y, head.z)),
    };
  }

  private back(): void {
    if (this.ctx.states.busy) return;
    void this.ctx.states.reset(StateIds.title, { openMenu: true }, { transition: true });
  }
}

const clamp = (v: number): number => Math.max(-1, Math.min(1, v));
