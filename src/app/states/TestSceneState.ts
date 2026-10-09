import type { GameState } from '@core/state/StateManager';
import type { RenderView } from '@core/render/RenderService';
import { Collections } from '@models/collections';
import { ExplorationHud } from '@modules/ui';
import { OverworldController, type ControlInput, type ControllerEvent } from '@modules/player';
import { TestLevelScene } from '../scenes/TestLevelScene';
import { FollowCamera } from '../scenes/FollowCamera';
import { PlaceholderCharacter } from '../scenes/PlaceholderCharacter';
import type { AppContext } from '../AppContext';
import { StateIds } from '../AppContext';

const STEP = 1 / 60;

/**
 * Phase-2 exploration test level ("Enter Test Scene" on the Departure Board). Builds the level,
 * party, controller and follow camera from data, turns the action map into a `ControlInput` each
 * frame, runs the controller in fixed sub-steps, forwards its hook events to the global bus and
 * the HUD, and poses the placeholder model.
 */
export class TestSceneState implements GameState {
  readonly id = StateIds.testScene;
  private level: TestLevelScene | null = null;
  private view: RenderView | null = null;
  private camera: FollowCamera | null = null;
  private model: PlaceholderCharacter | null = null;
  private controller: OverworldController | null = null;
  private hud: ExplorationHud | null = null;
  private unmount: (() => void) | null = null;
  private promptsOpen = false;

  constructor(private readonly ctx: AppContext) {}

  enter(): void {
    const { data, config, render, input, ui, debug } = this.ctx;
    const levelDef = data.get(Collections.levels, 'level.test-grounds');
    const rules = data.get(Collections.locomotionRules, 'default');
    const party = data.get(Collections.parties, 'default');
    const elementColor = new Map(data.all(Collections.elements).map((e) => [e.element, e.color]));
    const members = party.members.map((id) => data.get(Collections.characters, id));

    this.level = new TestLevelScene(levelDef, data.all(Collections.elements).map((e) => ({ name: e.element, color: e.color })), Math.round(config.get().graphics.starCount * 0.6));
    this.level.camera.fov = config.get().camera.fov;
    this.view = render.createView(this.level.scene, this.level.camera, { bloom: true, bloomRadius: 0.45, bloomThreshold: 0.6, bloomStrength: 0.55 });
    this.camera = new FollowCamera(this.level.camera, input, () => config.get().camera);
    this.model = new PlaceholderCharacter(rules.capsule.height);
    this.level.scene.add(this.model.root);

    const hints: Array<[string, string]> = [
      ['WASD', 'Move'],
      ['Shift', 'Sprint'],
      ['Ctrl', 'Walk'],
      ['F', 'Interact'],
      ['E', 'Technique'],
      ['Q', 'Attack'],
      ['1-4', 'Switch'],
      ['RMB', 'Camera'],
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
    this.camera.reset(this.controller, levelDef.spawn.yaw);
    if (config.get().debug.overlay) debug.toggle(true);
    if (window.__ASTRAL__) window.__ASTRAL__.probes.exploration = () => this.probe();
  }

  exit(): void {
    this.unmount?.();
    this.hud?.dispose();
    this.view?.dispose();
    this.model?.dispose();
    this.level?.dispose();
    this.ctx.debug.toggle(false);
    if (window.__ASTRAL__) delete window.__ASTRAL__.probes.exploration;
    this.level = null;
    this.view = null;
    this.camera = null;
    this.model = null;
    this.controller = null;
    this.hud = null;
  }

  update(dt: number): void {
    const c = this.controller;
    const cam = this.camera;
    if (!c || !cam || !this.level || !this.model) return;
    const i = this.ctx.input;
    if (i.wasPressed('back')) return this.back();

    const stick = i.stick('left');
    const slot = ['partySlot1', 'partySlot2', 'partySlot3', 'partySlot4'].findIndex((a) => i.wasPressed(a));
    const wheel = this.promptsOpen ? Math.sign(i.wheelDelta) : 0;
    const first: ControlInput = {
      right: clamp(i.axis('moveLeft', 'moveRight') + stick.x),
      forward: clamp(i.axis('moveBack', 'moveForward') + stick.y),
      cameraYaw: cam.yaw,
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
    const n = Math.max(1, Math.ceil(frame / STEP - 1e-6));
    for (let k = 0; k < n; k++) {
      c.step(frame / n, k === 0 ? first : { ...first, walkTogglePressed: false, interactPressed: false, techniquePressed: false, attackPressed: false, slotPressed: null, promptScroll: 0 });
    }
    cam.wheelZoom = !this.promptsOpen;
    cam.update(frame, c);
    this.model.apply(c.frame, c.x, c.y, c.z, c.yaw, frame);
    this.hud?.setGait(c.gait, c.speed > 0.25);
    this.level.update(dt);
  }

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
      cameraYaw: this.camera?.yaw ?? 0,
    };
  }

  private back(): void {
    if (this.ctx.states.busy) return;
    void this.ctx.states.reset(StateIds.title, { openMenu: true }, { transition: true });
  }
}

const clamp = (v: number): number => Math.max(-1, Math.min(1, v));
