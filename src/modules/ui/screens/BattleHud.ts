import type { Element as GameElement } from '@models/common';
import { h } from '../dom';
import { ELEMENT_ICONS } from '../icons';

/**
 * Combat HUD (spec §28), in the Honkai: Star Rail layout: the turn-order bar on top, enemy plates
 * (name, HP, toughness, Weakness icons, status chips) over the enemies, the party cards bottom-left
 * (HP, Energy, Ultimate key), Skill Points and the Basic ATK / Skill buttons bottom-right, floating
 * damage numbers, a combat log and the victory / defeat screen. It is a dumb view: `BattleState`
 * pushes values from the engine's event stream, so the numbers shown always match what is playing.
 */
export interface HudUnit {
  readonly uid: string;
  readonly name: string;
  readonly side: 'ally' | 'enemy';
  readonly color: string;
  readonly element?: GameElement;
  readonly hp: number;
  readonly maxHp: number;
  readonly energy?: { readonly current: number; readonly max: number };
  readonly weaknesses?: readonly GameElement[];
  readonly toughness?: number;
  readonly maxToughness?: number;
  /** 1-based party slot (the Ultimate key). */
  readonly slot?: number;
  readonly rank?: string;
}

export interface HudHandlers {
  action(slot: 'basic' | 'skill'): void;
  ultimate(uid: string): void;
  target(uid: string): void;
  leave(): void;
  retry(): void;
}

export interface TurnEntry {
  readonly uid: string;
  readonly name: string;
  readonly color: string;
  readonly side: 'ally' | 'enemy';
}

export interface ActionButton {
  readonly name: string;
  readonly enabled: boolean;
  readonly hint?: string;
}

export interface ResultView {
  readonly outcome: 'victory' | 'defeat';
  readonly cycles: number;
  readonly turns: number;
  readonly defeated: readonly string[];
  readonly rewards: ReadonlyArray<{ readonly name: string; readonly count: number }>;
  readonly leaveLabel: string;
  readonly canRetry: boolean;
}

export type FloatKind = 'damage' | 'crit' | 'weak' | 'break' | 'heal' | 'dot' | 'text';

export interface Projected {
  readonly x: number;
  readonly y: number;
  readonly visible: boolean;
}

interface Float {
  readonly el: HTMLElement;
  readonly uid: string;
  readonly born: number;
  readonly dx: number;
}

const pct = (v: number, max: number): string => `${Math.max(0, Math.min(100, max > 0 ? (v / max) * 100 : 0)).toFixed(1)}%`;
const fmt = (n: number): string => Math.max(0, Math.round(n)).toLocaleString('en-US');

export class BattleHud {
  readonly el: HTMLElement;
  private readonly waveEl: HTMLElement;
  private readonly turnbar: HTMLElement;
  private readonly platesEl: HTMLElement;
  private readonly floatsEl: HTMLElement;
  private readonly partyEl: HTMLElement;
  private readonly spEl: HTMLElement;
  private readonly basicBtn: HTMLButtonElement;
  private readonly skillBtn: HTMLButtonElement;
  private readonly promptEl: HTMLElement;
  private readonly logEl: HTMLElement;
  private readonly bannerEl: HTMLElement;
  private readonly resultEl: HTMLElement;
  private readonly barTop: HTMLElement;
  private readonly barBottom: HTMLElement;
  private readonly cards = new Map<string, HTMLElement>();
  private readonly plates = new Map<string, HTMLElement>();
  private readonly floats: Float[] = [];
  private bannerTimer: ReturnType<typeof setTimeout> | null = null;
  private selected: string | null = null;
  private floatSeconds = 1.1;

  constructor(
    private readonly handlers: HudHandlers,
    private readonly statusName: (id: string) => string,
  ) {
    this.waveEl = h('div', { class: 'battle__wave', attrs: { 'data-id': 'wave' } });
    this.turnbar = h('ol', { class: 'turnbar', attrs: { 'aria-label': 'Turn order' } });
    this.platesEl = h('div', { class: 'battle__plates' });
    this.floatsEl = h('div', { class: 'battle__floats' });
    this.partyEl = h('div', { class: 'battle__party interactive', attrs: { 'aria-label': 'Party' } });
    this.spEl = h('div', { class: 'sp', attrs: { 'aria-label': 'Skill Points', 'data-id': 'sp' } });
    this.basicBtn = this.actionButton('basic', 'Q');
    this.skillBtn = this.actionButton('skill', 'E');
    this.promptEl = h('div', { class: 'battle__prompt', attrs: { 'data-id': 'prompt', 'aria-live': 'polite' } });
    this.logEl = h('div', { class: 'battle__log interactive', attrs: { 'data-id': 'log' } });
    this.bannerEl = h('div', { class: 'battle__banner', attrs: { 'aria-live': 'polite' } });
    this.resultEl = h('div', { class: 'battle__result interactive', attrs: { 'data-id': 'result' } });
    this.barTop = h('div', { class: 'letterbox letterbox--top' });
    this.barBottom = h('div', { class: 'letterbox letterbox--bottom' });
    this.el = h(
      'section',
      { class: 'screen screen--passthrough battle', attrs: { 'data-screen': 'battle' } },
      h('div', { class: 'battle__top' }, this.waveEl, this.turnbar),
      this.platesEl,
      this.floatsEl,
      this.logEl,
      this.partyEl,
      h('div', { class: 'battle__actions interactive' }, this.promptEl, this.spEl, h('div', { class: 'battle__buttons' }, this.basicBtn, this.skillBtn)),
      h(
        'div',
        { class: 'battle__hints' },
        ...(
          [
            ['Q', 'Basic ATK'],
            ['E', 'Skill'],
            ['1-4', 'Ultimate'],
            ['A / D', 'Target'],
            ['L', 'Log'],
          ] as const
        ).map(([k, label]) => h('span', {}, h('span', { class: 'keycap', text: k }), label)),
      ),
      this.bannerEl,
      this.resultEl,
      this.barTop,
      this.barBottom,
    );
    this.setSp(0, 5);
  }

  private actionButton(slot: 'basic' | 'skill', key: string): HTMLButtonElement {
    return h(
      'button',
      { class: 'act', attrs: { type: 'button', 'data-slot': slot, 'aria-label': slot === 'basic' ? 'Basic ATK' : 'Skill' }, on: { click: () => this.handlers.action(slot) } },
      h('span', { class: 'keycap', text: key }),
      h('span', { class: 'act__name', text: slot === 'basic' ? 'Basic ATK' : 'Skill' }),
      h('span', { class: 'act__hint' }),
    );
  }

  // ---- Units ------------------------------------------------------------------------------------

  /** Builds the party cards and the first wave's enemy plates. */
  setRoster(units: readonly HudUnit[]): void {
    this.partyEl.replaceChildren();
    this.cards.clear();
    for (const u of units.filter((x) => x.side === 'ally')) {
      const card = h(
        'div',
        { class: 'pcard', style: { '--el': u.color }, dataset: { uid: u.uid }, on: { click: () => this.handlers.target(u.uid) } },
        h('span', { class: 'pcard__key keycap', text: String(u.slot ?? '') }),
        h('div', { class: 'pcard__name', text: u.name }),
        h('div', { class: 'pcard__hp' }, h('span', { class: 'bar' }, h('span', { class: 'bar__fill' })), h('span', { class: 'pcard__num', text: '' })),
        h('div', { class: 'pcard__energy' }, h('span', { class: 'bar bar--energy' }, h('span', { class: 'bar__fill' })), h('span', { class: 'pcard__num', text: '' })),
        h('div', { class: 'pcard__status' }),
      );
      card.addEventListener('click', (e) => {
        // The key hint doubles as the Ultimate button.
        if ((e.target as HTMLElement).closest('.pcard__key')) this.handlers.ultimate(u.uid);
      });
      this.partyEl.append(card);
      this.cards.set(u.uid, card);
      this.setHp(u.uid, u.hp, u.maxHp);
      if (u.energy) this.setEnergy(u.uid, u.energy.current, u.energy.max);
    }
    this.setEnemies(units.filter((x) => x.side === 'enemy'));
  }

  /** (Re)builds the enemy plates for a wave. */
  setEnemies(enemies: readonly HudUnit[]): void {
    for (const [uid, el] of this.plates) {
      el.remove();
      this.plates.delete(uid);
    }
    for (const u of enemies) {
      const weak = h('span', { class: 'eplate__weak' }, ...(u.weaknesses ?? []).map((w) => h('span', { class: 'eplate__el', attrs: { title: `Weak to ${w}` }, trustedHtml: ELEMENT_ICONS[w], dataset: { element: w } })));
      const plate = h(
        'div',
        { class: `eplate${u.rank === 'boss' || u.rank === 'weeklyBoss' || u.rank === 'storyBoss' ? ' is-boss' : ''}`, dataset: { uid: u.uid }, on: { click: () => this.handlers.target(u.uid) } },
        h('div', { class: 'eplate__head' }, h('span', { class: 'eplate__name', text: u.name }), weak),
        h('div', { class: 'eplate__toughness' }, h('span', { class: 'bar bar--toughness' }, h('span', { class: 'bar__fill' }))),
        h('div', { class: 'eplate__hp' }, h('span', { class: 'bar bar--enemy' }, h('span', { class: 'bar__fill' }))),
        h('div', { class: 'eplate__status' }),
      );
      this.platesEl.append(plate);
      this.plates.set(u.uid, plate);
      this.setHp(u.uid, u.hp, u.maxHp);
      this.setToughness(u.uid, u.toughness ?? 0, u.maxToughness ?? 0, false);
    }
    this.applySelection();
  }

  private unitEl(uid: string): HTMLElement | undefined {
    return this.cards.get(uid) ?? this.plates.get(uid);
  }

  private fill(root: HTMLElement | undefined, selector: string, ratio: string): void {
    const f = root?.querySelector<HTMLElement>(`${selector} .bar__fill`);
    if (f) f.style.width = ratio;
  }

  setHp(uid: string, hp: number, max: number): void {
    const el = this.unitEl(uid);
    if (!el) return;
    this.fill(el, el.classList.contains('pcard') ? '.pcard__hp' : '.eplate__hp', pct(hp, max));
    const num = el.querySelector<HTMLElement>('.pcard__hp .pcard__num');
    if (num) num.textContent = `${fmt(hp)} / ${fmt(max)}`;
    el.dataset.hp = String(Math.round(hp));
    el.classList.toggle('is-low', max > 0 && hp / max < 0.3 && hp > 0);
  }

  setEnergy(uid: string, current: number, max: number): void {
    const el = this.cards.get(uid);
    if (!el) return;
    this.fill(el, '.pcard__energy', pct(current, max));
    const num = el.querySelector<HTMLElement>('.pcard__energy .pcard__num');
    if (num) num.textContent = `${Math.floor(current)} / ${max}`;
    el.classList.toggle('is-ready', current >= max - 1e-9);
    el.dataset.energy = String(Math.floor(current));
  }

  setToughness(uid: string, current: number, max: number, broken: boolean): void {
    const el = this.plates.get(uid);
    if (!el) return;
    this.fill(el, '.eplate__toughness', pct(current, max));
    el.classList.toggle('is-broken', broken);
    el.dataset.toughness = String(Math.round(current));
  }

  setStatuses(uid: string, statusIds: readonly string[]): void {
    const el = this.unitEl(uid);
    const box = el?.querySelector<HTMLElement>('.pcard__status, .eplate__status');
    if (!box) return;
    box.replaceChildren(...statusIds.slice(0, 6).map((id) => h('span', { class: 'chip', text: this.statusName(id), dataset: { status: id } })));
  }

  setDown(uid: string, down: boolean): void {
    this.unitEl(uid)?.classList.toggle('is-down', down);
  }

  // ---- Turn, resources, actions -----------------------------------------------------------------

  setCycle(cycle: number, wave: number, waves: number): void {
    this.waveEl.textContent = `Cycle ${cycle}  ·  Wave ${wave} / ${waves}`;
    this.waveEl.dataset.cycle = String(cycle);
    this.waveEl.dataset.wave = String(wave);
  }

  setTurnOrder(entries: readonly TurnEntry[], activeUid: string | null): void {
    this.turnbar.replaceChildren(
      ...entries.map((e, i) =>
        h(
          'li',
          { class: `turn turn--${e.side}${e.uid === activeUid && i === 0 ? ' is-active' : ''}`, style: { '--el': e.color }, dataset: { uid: e.uid }, attrs: { title: e.name } },
          h('span', { class: 'turn__glyph', text: e.name.slice(0, 1) }),
        ),
      ),
    );
  }

  setActive(uid: string | null): void {
    for (const [id, el] of this.cards) el.classList.toggle('is-active', id === uid);
    for (const [id, el] of this.plates) el.classList.toggle('is-active', id === uid);
  }

  setSelected(uid: string | null): void {
    this.selected = uid;
    this.applySelection();
  }

  private applySelection(): void {
    for (const [id, el] of this.plates) el.classList.toggle('is-selected', id === this.selected);
    for (const [id, el] of this.cards) el.classList.toggle('is-selected', id === this.selected);
  }

  setSp(current: number, max: number): void {
    this.spEl.dataset.sp = String(current);
    this.spEl.replaceChildren(h('span', { class: 'sp__label', text: 'Skill Points' }), ...Array.from({ length: max }, (_, i) => h('span', { class: `sp__pip${i < current ? ' is-full' : ''}` })));
  }

  setActions(basic: ActionButton | null, skill: ActionButton | null, prompt: string): void {
    for (const [btn, a] of [
      [this.basicBtn, basic],
      [this.skillBtn, skill],
    ] as const) {
      btn.disabled = !a?.enabled;
      btn.classList.toggle('is-disabled', !a?.enabled);
      const name = btn.querySelector<HTMLElement>('.act__name');
      const hint = btn.querySelector<HTMLElement>('.act__hint');
      if (a && name) name.textContent = a.name;
      if (hint) hint.textContent = a?.hint ?? '';
    }
    this.promptEl.textContent = prompt;
    this.el.classList.toggle('is-waiting', basic !== null || skill !== null);
  }

  // ---- Feedback ---------------------------------------------------------------------------------

  /** A floating number or word above a unit. */
  float(uid: string, text: string, kind: FloatKind): void {
    const el = h('div', { class: `float float--${kind}`, text });
    this.floatsEl.append(el);
    this.floats.push({ el, uid, born: performance.now(), dx: (Math.random() - 0.5) * 36 });
    while (this.floats.length > 24) this.floats.shift()?.el.remove();
  }

  setFloatSeconds(s: number): void {
    this.floatSeconds = s;
  }

  log(text: string): void {
    const line = h('div', { class: 'battle__logline', text });
    this.logEl.append(line);
    while (this.logEl.children.length > 60) this.logEl.firstElementChild?.remove();
    this.logEl.scrollTop = this.logEl.scrollHeight;
  }

  toggleLog(force?: boolean): void {
    this.el.classList.toggle('is-log-hidden', force === undefined ? !this.el.classList.contains('is-log-hidden') : !force);
  }

  banner(text: string, sub = '', seconds = 1.1): void {
    this.bannerEl.replaceChildren(h('div', { class: 'battle__banner-title', text }), ...(sub ? [h('div', { class: 'battle__banner-sub', text: sub })] : []));
    this.bannerEl.classList.remove('is-visible');
    void this.bannerEl.offsetWidth;
    this.bannerEl.classList.add('is-visible');
    if (this.bannerTimer) clearTimeout(this.bannerTimer);
    this.bannerTimer = setTimeout(() => this.bannerEl.classList.remove('is-visible'), seconds * 1000);
  }

  /** Cinematic letterbox (Ultimate shots): bars of `amount` x `height` of the viewport; the HUD steps aside. */
  setLetterbox(amount: number, height: number): void {
    const px = `${(amount * height * 100).toFixed(2)}vh`;
    this.barTop.style.height = px;
    this.barBottom.style.height = px;
    this.el.classList.toggle('is-cinematic', amount > 0.001);
  }

  showResult(r: ResultView | null): void {
    this.resultEl.classList.toggle('is-open', r !== null);
    this.el.classList.toggle('is-finished', r !== null);
    if (!r) {
      this.resultEl.replaceChildren();
      return;
    }
    this.resultEl.dataset.outcome = r.outcome;
    this.resultEl.replaceChildren(
      h('div', { class: 'result__eyebrow', text: r.outcome === 'victory' ? 'Battle complete' : 'Party wiped' }),
      h('div', { class: 'result__title', text: r.outcome === 'victory' ? 'Victory' : 'Defeat' }),
      h('div', { class: 'result__stats', text: `${r.cycles} cycle${r.cycles === 1 ? '' : 's'}  ·  ${r.turns} turns  ·  ${r.defeated.length} defeated` }),
      r.rewards.length
        ? h('ul', { class: 'result__rewards' }, ...r.rewards.map((x) => h('li', { dataset: { item: x.name } }, h('span', { text: x.name }), h('span', { class: 'result__count', text: `x${x.count.toLocaleString('en-US')}` }))))
        : h('div', { class: 'result__none', text: r.outcome === 'victory' ? 'No rewards.' : 'The enemies remain.' }),
      h(
        'div',
        { class: 'result__buttons' },
        r.canRetry ? h('button', { class: 'pill-button', attrs: { type: 'button', 'data-id': 'retry' }, on: { click: () => this.handlers.retry() } }, h('span', { class: 'pill-button__label', text: 'Retry' })) : null,
        h('button', { class: 'pill-button pill-button--primary', attrs: { type: 'button', 'data-id': 'leave' }, on: { click: () => this.handlers.leave() } }, h('span', { class: 'pill-button__label', text: `${r.leaveLabel} (Enter)` })),
      ),
    );
  }

  /** Called every frame: positions the enemy plates and floating numbers over their units. */
  project(at: (uid: string) => Projected | null): void {
    for (const [uid, el] of this.plates) {
      const p = at(uid);
      if (!p || !p.visible || el.classList.contains('is-down')) {
        el.style.visibility = 'hidden';
        continue;
      }
      el.style.visibility = 'visible';
      el.style.transform = `translate(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px) translate(-50%, -100%)`;
    }
    const now = performance.now();
    for (let i = this.floats.length - 1; i >= 0; i--) {
      const f = this.floats[i]!;
      const age = (now - f.born) / 1000;
      if (age > this.floatSeconds) {
        f.el.remove();
        this.floats.splice(i, 1);
        continue;
      }
      const p = at(f.uid);
      if (!p) continue;
      const t = age / this.floatSeconds;
      f.el.style.opacity = String(t < 0.7 ? 1 : 1 - (t - 0.7) / 0.3);
      f.el.style.transform = `translate(${(p.x + f.dx).toFixed(1)}px, ${(p.y + 60 - t * 70).toFixed(1)}px) translate(-50%, -50%) scale(${(1 + (1 - Math.min(1, t * 6)) * 0.5).toFixed(2)})`;
    }
  }

  dispose(): void {
    if (this.bannerTimer) clearTimeout(this.bannerTimer);
  }
}
