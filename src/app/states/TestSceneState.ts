import type { GameState } from '@core/state/StateManager';
import type { RenderView } from '@core/render/RenderService';
import { Collections } from '@models/collections';
import { ExplorationHud } from '@modules/ui';
import type { DebugSection } from '@modules/ui/screens/DebugOverlay';
import { NO_INPUT, OverworldController, type ControlInput, type ControllerEvent } from '@modules/player';
import { CameraDirector, ShotProvider, ExplorationProvider, ExplorationRig, lineOfSightBlocked, v3, type CameraInput, type CameraPose, type UnitResolver } from '@modules/camera';
import { WorldRuntime, recallWorld, rememberWorld, type AnchorEntry, type EncounterInfo, type PlayerPose, type WorldEvents } from '@modules/world';
import type { CameraRules, CameraShot } from '@models/camera';
import type { Level } from '@models/locomotion';
import * as THREE from 'three';
import { AreaScene } from '../scenes/AreaScene';
import { PlaceholderCharacter } from '../scenes/PlaceholderCharacter';
import { WorldObjectsView } from '../scenes/WorldObjects';
import type { AppContext } from '../AppContext';
import { StateIds } from '../AppContext';

const STEP = 1 / 60;

type Overlay = 'none' | 'anchors' | 'encounter';

/**
 * Exploration scene ("Explore Test Level" on the Departure Board). Builds the world runtime,
 * party, controller and camera director from data, turns the action map into a `ControlInput`
 * and a `CameraInput` each frame, runs the controller in fixed sub-steps, forwards its hook
 * events to the world runtime, the bus and the HUD, poses the placeholder model, and applies the
 * director's pose to the scene camera.
 *
 * Phase 4: the scene is a view of a `WorldRuntime`. Area transitions and Space Anchor travel
 * rebuild the area scene behind the transition overlay while the party, controller and world
 * state carry over. F4 opens the Camera Gallery (Phase 3); scripted shots gate the player's input.
 */
export class TestSceneState implements GameState {
  readonly id = StateIds.testScene;
  private area: AreaScene | null = null;
  private view: RenderView | null = null;
  private director: CameraDirector | null = null;
  private explore: ExplorationProvider | null = null;
  private cameraRules: CameraRules | null = null;
  private shots: CameraShot[] = [];
  private levelDef: Level | null = null;
  private galleryOpen = false;
  private playing: string | null = null;
  /** Highest shake trauma and |roll| seen since the current shot started (probe observability). */
  private shakePeak = 0;
  private rollPeak = 0;
  private lastRoll = 0;
  private lastFov = 0;
  private model: PlaceholderCharacter | null = null;
  private controller: OverworldController | null = null;
  private hud: ExplorationHud | null = null;
  private unmount: (() => void) | null = null;
  private promptsOpen = false;
  private runtime: WorldRuntime | null = null;
  private objectsView: WorldObjectsView | null = null;
  private overlay: Overlay = 'none';
  private transitioning = false;
  private anchorRows: AnchorEntry[] = [];
  private anchorSel = 0;

  constructor(private readonly ctx: AppContext) {}

  enter(): void {
    const { data, config, render, ui, debug } = this.ctx;
    const rules = data.get(Collections.locomotionRules, 'default');
    const party = data.get(Collections.parties, 'default');
    const elementColor = new Map(data.all(Collections.elements).map((e) => [e.element, e.color]));
    const members = party.members.map((id) => data.get(Collections.characters, id));

    const worldDef = data.get(Collections.worlds, config.get().world.startWorld);
    const levels = new Map(data.all(Collections.levels).map((l) => [l.id, l]));
    this.runtime = new WorldRuntime({
      world: worldDef,
      levels,
      rules: data.get(Collections.worldRules, 'default'),
      capsule: rules.capsule,
      emit: (name, payload) => this.onWorldEvent(name, payload),
      state: recallWorld(worldDef.id) ?? undefined,
      itemName: (id) => data.get(Collections.items, id).name,
    });
    const resumed = this.runtime.state.data.visited.length > 0;
    const arrive = this.runtime.enterArea(this.runtime.state.data.area, resumed ? 'default' : worldDef.startSpawn);
    const level = this.runtime.level;

    this.model = new PlaceholderCharacter(rules.capsule.height);
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
      { name: level.name, subtitle: level.subtitle },
      members.map((c) => ({ id: c.id, name: c.name, element: c.element, color: elementColor.get(c.element) ?? '#ffffff' })),
      rules.interaction.maxVisible,
      hints,
      () => this.back(),
    );
    this.hud.setHandlers({
      anchorChosen: (key) => void this.chooseAnchor(key),
      anchorsClosed: () => this.closeAnchors(),
      encounterReturn: () => this.finishEncounter(),
    });
    this.unmount = ui.mount(this.hud.el);

    this.controller = new OverworldController(rules, this.runtime.colliders, this.runtime.prompts(), party.members, { position: level.spawn.position, yaw: level.spawn.yaw }, level.killHeight, (e) => this.onEvent(e));
    this.hud.setLeader(0);
    this.model.setCharacter(elementColor.get(members[0]!.element) ?? '#ffffff');

    // Camera: director with the exploration rig at the bottom of the stack. The rig shares the
    // runtime's live collider list, so opened gates and moved crates change what it avoids.
    this.cameraRules = data.get(Collections.cameraRules, 'default');
    this.shots = data.all(Collections.cameraShots);
    const settings = () => config.get().camera;
    const rig = new ExplorationRig(this.cameraRules.exploration, this.runtime.colliders, settings, arrive.yaw);
    this.explore = new ExplorationProvider(rig, this.cameraRules.priorities.exploration ?? 0, () => this.cameraInput());
    this.director = new CameraDirector(this.cameraRules, () => config.get().camera.shakeIntensity);
    this.director.push(this.explore);

    this.buildArea(arrive);
    this.hud.showBanner(level.name, this.runtime.graph.regionOf(level.id).name);
    render.canvas.addEventListener('click', this.onCanvasClick);
    if (config.get().debug.overlay) debug.toggle(true);
    debug.setProvider('world', () => this.debugSections());
    if (window.__ASTRAL__) {
      window.__ASTRAL__.probes.exploration = () => this.probe();
      window.__ASTRAL__.probes.explorationTeleport = (x: number, z: number, yaw: number, y = 0) => {
        this.controller?.teleport(x, y, z, yaw);
        this.explore?.reset(this.controller!, yaw);
      };
      window.__ASTRAL__.probes.world = () => this.worldProbe();
      // QA hook: travel to an area directly (the E2E walkthrough uses portals and anchors).
      window.__ASTRAL__.probes.worldEnter = (areaId: string, spawn = 'default') => {
        const rt = this.runtime;
        if (rt) void this.travel(() => rt.enterArea(areaId, spawn));
      };
    }
  }

  exit(): void {
    if (this.runtime) rememberWorld(this.runtime.state);
    this.unmount?.();
    this.hud?.dispose();
    this.objectsView?.dispose();
    this.view?.dispose();
    this.model?.dispose();
    this.area?.dispose();
    this.ctx.debug.toggle(false);
    this.ctx.debug.setProvider('world', null);
    this.ctx.render.canvas.removeEventListener('click', this.onCanvasClick);
    if (document.pointerLockElement) document.exitPointerLock();
    if (window.__ASTRAL__) {
      delete window.__ASTRAL__.probes.exploration;
      delete window.__ASTRAL__.probes.explorationTeleport;
      delete window.__ASTRAL__.probes.world;
      delete window.__ASTRAL__.probes.worldEnter;
    }
    this.area = null;
    this.view = null;
    this.director = null;
    this.explore = null;
    this.model = null;
    this.controller = null;
    this.hud = null;
    this.runtime = null;
    this.objectsView = null;
  }

  /** (Re)builds everything tied to the loaded area: scene, object meshes, render view, camera. */
  private buildArea(arrive: { position: readonly [number, number, number]; yaw: number }): void {
    const { data, config, render } = this.ctx;
    const rt = this.runtime!;
    const c = this.controller!;
    const level = rt.level;
    this.model?.root.removeFromParent();
    this.objectsView?.dispose();
    this.view?.dispose();
    this.area?.dispose();

    const elements = data.all(Collections.elements);
    this.levelDef = level;
    this.area = new AreaScene(level, elements.map((e) => ({ name: e.element, color: e.color })), Math.round(config.get().graphics.starCount * 0.6));
    this.area.camera.fov = config.get().camera.fov;
    this.lastFov = 0;
    const elementColor = new Map(elements.map((e) => [e.element, e.color]));
    this.objectsView = new WorldObjectsView({
      enemyColor: (id) => {
        const e = data.get(Collections.enemies, id);
        return elementColor.get(e.weaknesses[0]!) ?? '#ff3d6e';
      },
      enemyScale: (id) => data.get(Collections.enemies, id).presentation.scale,
    });
    this.area.scene.add(this.objectsView.root, this.model!.root);
    this.objectsView.build(rt.objects(), rt.enemies(), rt.hiddenAreas(), level.colliders);
    this.view = render.createView(this.area.scene, this.area.camera, { bloom: true, bloomRadius: 0.45, bloomThreshold: 0.6, bloomStrength: 0.55 });

    c.setSpawn({ position: level.spawn.position, yaw: level.spawn.yaw }, level.killHeight);
    c.teleport(...arrive.position, arrive.yaw);
    c.setInteractables(rt.prompts());
    this.explore!.reset(c, arrive.yaw);
    this.hud?.setArea(level.name, level.subtitle);
    const p = rt.progress();
    this.hud?.setProgress(p.percent, p.found, p.total);
  }

  update(dt: number): void {
    const c = this.controller;
    const director = this.director;
    const rt = this.runtime;
    if (!c || !director || !this.explore || !this.area || !this.model || !rt) return;
    const i = this.ctx.input;

    if (this.overlay !== 'none') this.overlayInput();
    else if (!this.transitioning) {
      // Camera Gallery (debug): F4 toggles; 1-6 play the shots; Esc closes it before leaving.
      if (i.wasPressed('cameraGallery')) this.setGallery(!this.galleryOpen);
      else if (this.galleryOpen && i.wasPressed('back')) this.setGallery(false);
      else if (i.wasPressed('back')) return this.back();
      if (this.galleryOpen) {
        const n = ['cameraShot1', 'cameraShot2', 'cameraShot3', 'cameraShot4', 'cameraShot5', 'cameraShot6'].findIndex((a) => i.wasPressed(a));
        if (n >= 0 && this.shots[n]) this.playShot(this.shots[n]!);
      }
    }
    // Scripted shots, overlays and transitions own the player: movement input is gated.
    const gated = this.galleryOpen || director.inputGated || this.overlay !== 'none' || this.transitioning;
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

    // World: enemies, plates, hidden areas and the prompt list follow the player.
    if (this.runtime && !this.transitioning && this.overlay !== 'anchors') this.runtime.update(frame, this.pose());
    if (this.runtime && this.runtime.encounter && this.overlay === 'none') this.openEncounter(this.runtime.encounter);
    if (this.runtime?.loaded) {
      c.setInteractables(this.runtime.prompts());
      this.area?.syncColliders(this.runtime.colliders);
      this.objectsView?.ensureEnemies(this.runtime.enemies());
      this.objectsView?.update(frame, this.runtime.objects(), this.runtime.enemies(), this.runtime.hiddenAreas(), this.area.camera.position);
    }

    this.explore.follow(c);
    const pose = director.update(frame);
    if (pose) this.applyPose(pose);
    this.shakePeak = Math.max(this.shakePeak, director.trauma);
    this.rollPeak = Math.max(this.rollPeak, Math.abs(this.lastRoll));
    this.model.apply(c.frame, c.x, c.y, c.z, c.yaw, frame);
    // Fade the character out when the camera is squeezed into it (wall hugs).
    const cp = this.area.camera.position;
    // Only in exploration: authored shots (e.g. over-the-shoulder) frame the body on purpose.
    this.model.setFade(director.mode !== 'exploration' ? Infinity : Math.hypot(cp.x - c.x, cp.y - (c.y + 1.35), cp.z - c.z));
    this.hud?.setGait(c.gait, c.speed > 0.25);
    this.hud?.setLetterbox(director.letterbox, this.cameraRules?.letterboxHeight ?? 0);
    this.area.update(dt);
  }

  private pose(): PlayerPose {
    const c = this.controller!;
    return { x: c.x, y: c.y, z: c.z, yaw: c.yaw };
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
    const cam = this.area!.camera;
    cam.position.set(p.position.x, p.position.y, p.position.z);
    cam.up.set(0, 1, 0);
    cam.lookAt(p.target.x, p.target.y, p.target.z);
    this.lastRoll = p.roll;
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
    this.shakePeak = 0;
    this.rollPeak = 0;
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

  // ---- World glue -------------------------------------------------------------------------------

  private itemName(id: string): string {
    return this.ctx.data.get(Collections.items, id).name;
  }

  private enemyName(id: string): string {
    return this.ctx.data.get(Collections.enemies, id).name;
  }

  /** World events go to the bus (quest layer, debug) and the HUD (toasts, progress). */
  private onWorldEvent<K extends keyof WorldEvents>(name: K, payload: WorldEvents[K]): void {
    (this.ctx.bus as unknown as { emit(n: string, p: unknown): void }).emit(name, payload);
    const hud = this.hud;
    if (!hud) return;
    switch (name) {
      case 'world:itemCollected': {
        const e = payload as WorldEvents['world:itemCollected'];
        hud.toast(`${this.itemName(e.itemId)} x${e.count}`);
        break;
      }
      case 'world:hiddenAreaDiscovered':
        hud.toast(`Hidden area discovered: ${(payload as WorldEvents['world:hiddenAreaDiscovered']).name}`);
        break;
      case 'world:puzzleSolved': {
        const e = payload as WorldEvents['world:puzzleSolved'];
        hud.toast(`Puzzle solved: ${this.levelDef?.puzzles.find((p) => p.id === e.puzzleId)?.name ?? e.puzzleId}`);
        break;
      }
      case 'world:anchorActivated':
        hud.toast('Space Anchor activated');
        break;
      case 'world:progressChanged': {
        const e = payload as WorldEvents['world:progressChanged'];
        hud.setProgress(e.percent, e.found, e.total);
        break;
      }
      case 'world:techniqueUsed': {
        const e = payload as WorldEvents['world:techniqueUsed'];
        if (e.affected > 0) hud.toast(`Technique stunned ${e.affected} enemy group${e.affected === 1 ? '' : 's'}`);
        break;
      }
      default:
        break;
    }
  }

  private onEvent(e: ControllerEvent): void {
    const { bus, data } = this.ctx;
    const rt = this.runtime;
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
        bus.emit('player:interact', { characterId: e.characterId, interactableId: e.interactable.id, kind: e.interactable.kind });
        if (!rt || this.transitioning) break;
        const r = rt.interact(e.interactable.id, this.pose());
        switch (r.type) {
          case 'message': {
            const got = r.rewards?.length ? ` Obtained: ${r.rewards.map((x) => `${this.itemName(x.item)} x${x.count}`).join(', ')}.` : '';
            this.hud?.message(r.speaker, r.text + got);
            break;
          }
          case 'toast':
            this.hud?.toast(r.text);
            break;
          case 'locked':
            this.hud?.message('Locked', r.text);
            break;
          case 'anchorMenu':
            this.openAnchors(r.anchorId);
            break;
          case 'transition':
            void this.travel(() => rt.enterArea(r.area, r.spawn));
            break;
          case 'none':
            break;
        }
        break;
      }
      case 'technique': {
        const c = data.get(Collections.characters, e.characterId);
        this.hud?.toast(`Technique · ${c.abilities.technique.name}`);
        rt?.technique(this.pose());
        bus.emit('player:technique', { characterId: e.characterId, position: e.position });
        break;
      }
      case 'overworldAttack': {
        const r = rt?.attack(this.pose());
        if (r?.type === 'breakable') this.hud?.toast(r.broken ? 'Broken!' : `Strike ${r.hits} / ${r.needed}`);
        else if (r?.type === 'miss') this.hud?.toast('Attack');
        bus.emit('player:overworldAttack', { characterId: e.characterId, position: e.position, yaw: e.yaw });
        break;
      }
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

  /** Fades out, swaps the loaded area (`load` returns where the player arrives), fades back in. */
  private async travel(load: () => { position: readonly [number, number, number]; yaw: number }): Promise<void> {
    if (this.transitioning || !this.runtime) return;
    this.transitioning = true;
    if (this.galleryOpen) this.setGallery(false);
    await this.ctx.transition.cover();
    if (!this.runtime) return;
    const arrive = load();
    this.buildArea(arrive);
    await this.ctx.transition.reveal();
    this.transitioning = false;
    // The name banner shows once the screen is revealed.
    if (this.runtime) this.hud?.showBanner(this.runtime.level.name, this.runtime.graph.regionOf(this.runtime.areaId).name);
  }

  // ---- Overlays ---------------------------------------------------------------------------------

  private overlayInput(): void {
    const i = this.ctx.input;
    if (this.overlay === 'encounter') {
      if (i.wasPressed('confirm') || i.wasPressed('interact') || i.wasPressed('back')) this.finishEncounter();
    } else if (this.overlay === 'anchors') {
      if (i.wasPressed('back')) this.closeAnchors();
      else if (i.wasPressed('moveForward')) this.moveAnchorSelection(-1);
      else if (i.wasPressed('moveBack')) this.moveAnchorSelection(1);
      else if (i.wasPressed('interact') || i.wasPressed('confirm')) {
        const row = this.anchorRows[this.anchorSel];
        if (row) void this.chooseAnchor(row.key);
      }
    }
  }

  private openEncounter(info: EncounterInfo): void {
    this.overlay = 'encounter';
    this.hud?.showEncounter({ enemies: info.enemies, advantage: info.advantage, trigger: info.trigger }, (id) => this.enemyName(id));
  }

  private finishEncounter(): void {
    if (this.overlay !== 'encounter') return;
    this.runtime?.endEncounter();
    this.overlay = 'none';
    this.hud?.showEncounter(null);
    this.hud?.toast('Returned to exploration');
  }

  private openAnchors(anchorId: string): void {
    const rows = this.runtime?.anchors() ?? [];
    if (rows.length === 0) return;
    this.anchorRows = rows;
    this.anchorSel = Math.max(0, rows.findIndex((r) => r.current && r.objectId === anchorId));
    this.overlay = 'anchors';
    this.renderAnchors();
  }

  private moveAnchorSelection(delta: number): void {
    this.anchorSel = Math.min(this.anchorRows.length - 1, Math.max(0, this.anchorSel + delta));
    this.renderAnchors();
  }

  private renderAnchors(): void {
    this.hud?.showAnchors(
      this.anchorRows.map((r) => ({ key: r.key, label: r.label, area: r.areaName, region: r.regionName, current: r.current })),
      this.anchorSel,
    );
  }

  private closeAnchors(): void {
    if (this.overlay !== 'anchors') return;
    this.overlay = 'none';
    this.hud?.showAnchors(null, 0);
  }

  private async chooseAnchor(key: string): Promise<void> {
    const rt = this.runtime;
    if (!rt || this.overlay !== 'anchors') return;
    const row = this.anchorRows.find((r) => r.key === key);
    this.closeAnchors();
    if (!row) return;
    // Travelling to the anchor you are standing at is a no-op.
    if (row.current && Math.hypot(...this.anchorOffset(row)) < 6) {
      this.hud?.toast('You are already here');
      return;
    }
    await this.travel(() => {
      const arrive = rt.teleportToAnchor(key);
      if (!arrive) throw new Error(`anchor ${key} is not available`);
      return arrive;
    });
  }

  private anchorOffset(row: AnchorEntry): [number, number] {
    const def = this.levelDef?.interactables.find((o) => o.id === row.objectId);
    const c = this.controller;
    if (!def || !c) return [99, 99];
    return [def.position[0] - c.x, def.position[2] - c.z];
  }

  // ---- Debug / probes ---------------------------------------------------------------------------

  private debugSections(): DebugSection[] {
    const rt = this.runtime;
    if (!rt?.loaded) return [];
    const p = rt.progress();
    const world = rt.worldProgress();
    const items = Object.entries(rt.state.data.items).map(([k, v]) => `${k} ${v}`);
    return [
      {
        title: 'WORLD',
        rows: [
          ['Area', rt.level.name],
          ['Region', rt.graph.regionOf(rt.areaId).name],
          ['Exploration', `${p.percent}% (${p.found}/${p.total})`],
          ['World', `${world.percent}% (${world.found}/${world.total})`],
          ['Enemies', rt.enemies().map((e) => e.state).join(', ') || '-'],
          ['Items', items.join(', ') || '-'],
        ],
      },
      { title: 'WORLD EVENTS', rows: rt.log.slice(-8).map((l) => [`${l.time.toFixed(1)}s ${l.name}`, l.text] as const) },
    ];
  }

  private worldProbe(): Record<string, unknown> {
    const rt = this.runtime;
    if (!rt?.loaded) return {};
    const p = rt.progress();
    return {
      area: rt.areaId,
      region: rt.regionId,
      transitioning: this.transitioning,
      overlay: this.overlay,
      progress: { percent: p.percent, found: p.found, total: p.total, chests: p.chests, collectibles: p.collectibles, puzzles: p.puzzles, anchors: p.anchors },
      worldProgress: rt.worldProgress().percent,
      items: { ...rt.state.data.items },
      visited: [...rt.state.data.visited],
      objects: Object.fromEntries(rt.objects().map((o) => [o.def.id, { state: o.state, visible: o.visible, x: o.x, z: o.z }])),
      enemies: rt.enemies().map((e) => ({ spawnId: e.spawnId, state: e.state, x: e.x, z: e.z, enemies: e.enemies })),
      hidden: rt.hiddenAreas().map((h) => ({ id: h.def.id, discovered: h.discovered, reveal: h.reveal })),
      encounter: rt.encounter,
      anchors: rt.anchors().map((a) => ({ key: a.key, area: a.areaId, current: a.current })),
      colliders: rt.colliders.length,
      log: rt.log.map((l) => `${l.name} ${l.text}`),
      clock: rt.state.data.clock,
      state: rt.toJSON(),
    };
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
    const cam = this.area?.camera;
    const rig = this.explore?.rig;
    if (!c || !cam || !rig || !this.runtime) return {};
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
      shakePeak: this.shakePeak,
      roll: this.lastRoll,
      rollPeak: this.rollPeak,
      position: [cam.position.x, cam.position.y, cam.position.z],
      playerNdc: [ndc.x, ndc.y, ndc.z],
      playerOnScreen: Math.abs(ndc.x) <= 1 && Math.abs(ndc.y) <= 1 && ndc.z < 1,
      playerOccluded: lineOfSightBlocked(this.runtime.colliders, v3(cam.position.x, cam.position.y, cam.position.z), v3(head.x, head.y, head.z)),
    };
  }

  private back(): void {
    if (this.ctx.states.busy) return;
    void this.ctx.states.reset(StateIds.title, { openMenu: true }, { transition: true });
  }
}

const clamp = (v: number): number => Math.max(-1, Math.min(1, v));
