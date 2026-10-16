import type { Element as GameElement } from '@models/common';
import { h } from '../dom';

/**
 * Battle Sandbox (debug / test setup): choose 4 of the characters, an enemy group of up to two waves
 * (Cocolia included), levels, a seed and the opening advantage, then start a battle.
 */
export interface SandboxCharacter {
  readonly id: string;
  readonly name: string;
  readonly element: GameElement;
}

export interface SandboxEnemy {
  readonly id: string;
  readonly name: string;
  readonly rank: string;
}

export interface SandboxConfig {
  readonly party: ReadonlyArray<{ characterId: string; level: number }>;
  readonly waves: readonly (readonly string[])[];
  readonly enemyLevel: number;
  readonly seed: string;
  readonly advantage: 'neutral' | 'playerStrike' | 'ambush';
  readonly techniques: boolean;
}

export interface SandboxPreset {
  readonly id: string;
  readonly label: string;
  readonly waves: readonly (readonly string[])[];
  readonly enemyLevel?: number;
}

const SLOTS = 5;

export class BattleSandboxScreen {
  readonly el: HTMLElement;
  private readonly partySelects: HTMLSelectElement[] = [];
  private readonly partyLevels: HTMLInputElement[] = [];
  private readonly waveSelects: HTMLSelectElement[][] = [[], []];
  private readonly levelInput: HTMLInputElement;
  private readonly seedInput: HTMLInputElement;
  private readonly advantage: HTMLSelectElement;
  private readonly techniques: HTMLInputElement;
  private readonly messageEl: HTMLElement;
  private readonly lastEl: HTMLElement;

  constructor(
    characters: readonly SandboxCharacter[],
    enemies: readonly SandboxEnemy[],
    presets: readonly SandboxPreset[],
    defaults: SandboxConfig,
    private readonly onStart: (config: SandboxConfig) => void,
    onBack: () => void,
  ) {
    const enemyOptions = (): HTMLOptionElement[] => [h('option', { text: '(none)', attrs: { value: '' } }), ...enemies.map((e) => h('option', { text: `${e.name}${e.rank === 'normal' ? '' : ` (${e.rank})`}`, attrs: { value: e.id } }))];
    const party = h('div', { class: 'sandbox__group' }, h('h3', { text: 'Party (4 characters)' }));
    for (let i = 0; i < 4; i++) {
      const sel = h('select', { attrs: { 'data-id': `party-${i}`, 'aria-label': `Party slot ${i + 1}` } }, ...characters.map((c) => h('option', { text: `${c.name} · ${c.element}`, attrs: { value: c.id } })));
      sel.value = defaults.party[i]?.characterId ?? characters[i]?.id ?? '';
      const lv = h('input', { attrs: { type: 'number', min: 1, max: 80, value: defaults.party[i]?.level ?? 80, 'data-id': `party-level-${i}`, 'aria-label': `Level of slot ${i + 1}` } });
      this.partySelects.push(sel);
      this.partyLevels.push(lv);
      party.append(h('label', { class: 'sandbox__row' }, h('span', { class: 'keycap', text: String(i + 1) }), sel, h('span', { class: 'sandbox__lv', text: 'Lv' }), lv));
    }
    const enemy = h('div', { class: 'sandbox__group' }, h('h3', { text: 'Enemy group' }));
    for (let w = 0; w < 2; w++) {
      const row = h('div', { class: 'sandbox__wave' }, h('span', { class: 'sandbox__wave-label', text: `Wave ${w + 1}${w === 1 ? ' (optional)' : ''}` }));
      for (let i = 0; i < SLOTS; i++) {
        const sel = h('select', { attrs: { 'data-id': `wave-${w + 1}-${i}`, 'aria-label': `Wave ${w + 1} enemy ${i + 1}` } }, ...enemyOptions());
        sel.value = defaults.waves[w]?.[i] ?? '';
        this.waveSelects[w]!.push(sel);
        row.append(sel);
      }
      enemy.append(row);
    }
    enemy.append(
      h(
        'div',
        { class: 'sandbox__presets' },
        ...presets.map((p) =>
          h('button', { class: 'pill-button', attrs: { type: 'button', 'data-id': `preset-${p.id}` }, on: { click: () => this.applyPreset(p) } }, h('span', { class: 'pill-button__label', text: p.label })),
        ),
      ),
    );
    this.levelInput = h('input', { attrs: { type: 'number', min: 1, max: 95, value: defaults.enemyLevel, 'data-id': 'enemy-level', 'aria-label': 'Enemy level' } });
    this.seedInput = h('input', { attrs: { type: 'text', value: defaults.seed, 'data-id': 'seed', 'aria-label': 'Seed', maxlength: 24 } });
    this.advantage = h(
      'select',
      { attrs: { 'data-id': 'advantage', 'aria-label': 'Opening advantage' } },
      h('option', { text: 'Neutral', attrs: { value: 'neutral' } }),
      h('option', { text: 'Player Strike (allies advance 25%)', attrs: { value: 'playerStrike' } }),
      h('option', { text: 'Ambush (enemies act first)', attrs: { value: 'ambush' } }),
    );
    this.advantage.value = defaults.advantage;
    this.techniques = h('input', { attrs: { type: 'checkbox', 'data-id': 'techniques', 'aria-label': 'Cast Techniques before the battle' } });
    this.techniques.checked = defaults.techniques;
    const options = h(
      'div',
      { class: 'sandbox__group sandbox__options' },
      h('h3', { text: 'Options' }),
      h('label', { class: 'sandbox__row' }, h('span', { text: 'Enemy level' }), this.levelInput),
      h('label', { class: 'sandbox__row' }, h('span', { text: 'Seed' }), this.seedInput),
      h('label', { class: 'sandbox__row' }, h('span', { text: 'Advantage' }), this.advantage),
      h('label', { class: 'sandbox__row' }, h('span', { text: 'Cast Techniques' }), this.techniques),
    );
    this.messageEl = h('div', { class: 'sandbox__message', attrs: { 'aria-live': 'polite' } });
    this.lastEl = h('div', { class: 'sandbox__last', attrs: { 'data-id': 'last-result' } });
    this.el = h(
      'section',
      { class: 'screen sandbox', attrs: { 'data-screen': 'battle-sandbox' } },
      h('div', { class: 'sandbox__panel' }, h('div', { class: 'eyebrow' }, h('span', { class: 'diamond' }), 'Phase 5 · Debug'), h('h2', { class: 'sandbox__title', text: 'Battle Sandbox' }), h('div', { class: 'sandbox__cols' }, party, enemy, options), this.messageEl, this.lastEl, h(
        'div',
        { class: 'sandbox__buttons' },
        h('button', { class: 'pill-button', attrs: { type: 'button', 'data-id': 'back' }, on: { click: onBack } }, h('span', { class: 'pill-button__label', text: 'Back' })),
        h('button', { class: 'pill-button pill-button--primary', attrs: { type: 'button', 'data-id': 'start' }, on: { click: () => this.start() } }, h('span', { class: 'pill-button__label', text: 'Start Battle' })),
      )),
    );
  }

  private applyPreset(p: SandboxPreset): void {
    for (let w = 0; w < 2; w++) for (let i = 0; i < SLOTS; i++) this.waveSelects[w]![i]!.value = p.waves[w]?.[i] ?? '';
    if (p.enemyLevel) this.levelInput.value = String(p.enemyLevel);
  }

  /** Shows a one-line summary of the last battle. */
  showLast(text: string): void {
    this.lastEl.textContent = text;
  }

  private start(): void {
    const party = this.partySelects.map((s, i) => ({ characterId: s.value, level: Math.max(1, Math.min(80, Number(this.partyLevels[i]!.value) || 80)) }));
    if (new Set(party.map((p) => p.characterId)).size !== party.length) {
      this.messageEl.textContent = 'Pick four different characters.';
      return;
    }
    const waves = this.waveSelects.map((row) => row.map((s) => s.value).filter((v) => v !== '')).filter((w) => w.length > 0);
    if (waves.length === 0) {
      this.messageEl.textContent = 'Pick at least one enemy in wave 1.';
      return;
    }
    if (this.waveSelects[0]!.every((s) => s.value === '') && waves.length > 0) {
      this.messageEl.textContent = 'Wave 1 needs an enemy before wave 2.';
      return;
    }
    this.messageEl.textContent = '';
    this.onStart({
      party,
      waves,
      enemyLevel: Math.max(1, Math.min(95, Number(this.levelInput.value) || 30)),
      seed: this.seedInput.value.trim() || 'astral',
      advantage: this.advantage.value as SandboxConfig['advantage'],
      techniques: this.techniques.checked,
    });
  }
}
