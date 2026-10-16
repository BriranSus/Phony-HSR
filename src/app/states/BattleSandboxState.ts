import type { GameState } from '@core/state/StateManager';
import { Collections } from '@models/collections';
import { hashSeed, type BattleResult, type PartyMemberSpec } from '@modules/combat';
import { BattleSandboxScreen, type SandboxConfig } from '@modules/ui/screens/BattleSandboxScreen';
import type { AppContext } from '../AppContext';
import { StateIds } from '../AppContext';
import type { BattleParams } from './BattleState';

/**
 * Battle Sandbox: a debug screen (reachable from the main menu) that builds a party of 4 of the
 * real characters and an enemy group, with a seed, and starts the Phase-5 battle scene on it.
 */
const PRESETS = [
  { id: 'cocolia', label: 'Cocolia', waves: [['enemy.cocolia-mother-of-deception']], enemyLevel: 80 },
  { id: 'squad', label: 'Silvermane Squad', waves: [['enemy.silvermane-soldier', 'enemy.silvermane-soldier', 'enemy.silvermane-lieutenant']], enemyLevel: 40 },
  { id: 'spawns', label: 'Spawn Pack', waves: [['enemy.frostspawn', 'enemy.flamespawn', 'enemy.thunderspawn']], enemyLevel: 30 },
  { id: 'two-waves', label: 'Two Waves', waves: [['enemy.automaton-beetle', 'enemy.automaton-spider'], ['enemy.voidranger-reaver', 'enemy.voidranger-trampler']], enemyLevel: 50 },
] as const;

let last: SandboxConfig | null = null;

export class BattleSandboxState implements GameState {
  readonly id = StateIds.battleSandbox;
  private screen: BattleSandboxScreen | null = null;
  private unmount: (() => void) | null = null;

  constructor(private readonly ctx: AppContext) {}

  enter(): void {
    const { data, ui } = this.ctx;
    const party = data.get(Collections.parties, 'default');
    const chars = data.all(Collections.characters).sort((a, b) => a.name.localeCompare(b.name));
    const enemies = data.all(Collections.enemies).sort((a, b) => a.name.localeCompare(b.name));
    const defaults: SandboxConfig = last ?? {
      party: party.members.map((characterId) => ({ characterId, level: party.level })),
      waves: [['enemy.silvermane-soldier', 'enemy.frostspawn', 'enemy.automaton-beetle']],
      enemyLevel: 30,
      seed: 'astral',
      advantage: 'neutral',
      techniques: false,
    };
    this.screen = new BattleSandboxScreen(
      chars.map((c) => ({ id: c.id, name: c.name, element: c.element })),
      enemies.map((e) => ({ id: e.id, name: e.name, rank: e.rank })),
      PRESETS,
      defaults,
      (cfg) => this.start(cfg),
      () => void this.ctx.states.pop({ transition: true }),
    );
    this.unmount = ui.mount(this.screen.el);
  }

  exit(): void {
    this.unmount?.();
    this.screen = null;
  }

  pause(): void {
    if (this.screen) this.screen.el.style.display = 'none';
  }

  resume(): void {
    if (this.screen) this.screen.el.style.display = '';
  }

  private start(cfg: SandboxConfig): void {
    if (this.ctx.states.busy) return;
    last = cfg;
    const caps = this.ctx.data.get(Collections.progressionRules, 'default').levelCaps;
    const party: PartyMemberSpec[] = cfg.party.map((m) => ({ characterId: m.characterId, level: m.level, ascension: Math.max(0, caps.findIndex((cap) => m.level <= cap)) }));
    const params: BattleParams = {
      source: 'sandbox',
      party,
      waves: cfg.waves,
      enemyLevel: cfg.enemyLevel,
      seed: hashSeed(cfg.seed),
      advantage: cfg.advantage,
      techniques: cfg.techniques ? party.map((p) => p.characterId) : [],
      leaveLabel: 'Back to the Sandbox',
      onFinished: (r: BattleResult) => this.screen?.showLast(`Last battle: ${r.outcome} in ${r.turns} turns / ${r.cycles} cycles · seed "${cfg.seed}" · ${r.rewards.map((x) => `${x.item} x${x.count}`).join(', ') || 'no rewards'}`),
    };
    void this.ctx.states.push(StateIds.battle, params, { transition: true });
  }
}
