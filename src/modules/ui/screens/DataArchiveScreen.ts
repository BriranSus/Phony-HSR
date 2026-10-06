import type { Element as GameElement, Path } from '@models/common';
import { h } from '../dom';
import { ELEMENT_ICONS, PATH_ICONS, UI_ICONS } from '../icons';

/**
 * "Data Archive": a read-only browser over the loaded content registry. It proves the data
 * pipeline end-to-end (JSON -> schema validation -> registry -> derived stats -> UI) and
 * previews the character-card language the Phase 16 character screen will use.
 */
export interface CharacterCardView {
  readonly id: string;
  readonly name: string;
  readonly title: string;
  readonly rarity: number;
  readonly element: GameElement;
  readonly elementColor: string;
  readonly path: Path;
  readonly pathName: string;
  readonly portraitColor: string;
  readonly stats: ReadonlyArray<readonly [string, string]>;
  readonly kit: ReadonlyArray<readonly [string, string]>;
}

export interface LightConeCardView {
  readonly name: string;
  readonly rarity: number;
  readonly path: Path;
  readonly passiveName: string;
  readonly passive: string;
  readonly stats: string;
}

export interface EnemyCardView {
  readonly name: string;
  readonly rank: string;
  readonly toughness: number;
  readonly maxToughness: number;
  readonly weaknesses: ReadonlyArray<{ element: GameElement; color: string }>;
  readonly detail: string;
}

export interface BreakRowView {
  readonly element: GameElement;
  readonly color: string;
  readonly multiplier: string;
  readonly effect: string;
  readonly delay: string;
  readonly summary: string;
}

export interface ArchiveViewModel {
  readonly characters: readonly CharacterCardView[];
  readonly lightCones: readonly LightConeCardView[];
  readonly enemies: readonly EnemyCardView[];
  readonly rules: ReadonlyArray<readonly [string, string]>;
  readonly breaks: readonly BreakRowView[];
  readonly summary: string;
}

type TabId = 'characters' | 'lightCones' | 'enemies' | 'rules';

const SILHOUETTE = `<svg viewBox="0 0 150 180" aria-hidden="true"><defs><linearGradient id="sil" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffffff" stop-opacity=".9"/><stop offset="1" stop-color="#ffffff" stop-opacity=".05"/></linearGradient></defs><circle cx="75" cy="46" r="24" fill="url(#sil)"/><path d="M75 74c-32 0-52 18-56 50l-6 56h124l-6-56c-4-32-24-50-56-50z" fill="url(#sil)"/></svg>`;

function stars(n: number): HTMLElement {
  const el = h('span', { class: `rarity-stars rarity-stars--${n}`, attrs: { 'aria-label': `${n} stars` } });
  for (let i = 0; i < n; i++) el.append(h('span', { class: 'icon', trustedHtml: UI_ICONS.star }));
  return el;
}

export class DataArchiveScreen {
  readonly el: HTMLElement;
  private readonly body: HTMLElement;
  private readonly tabs = new Map<TabId, HTMLElement>();
  private readonly order: TabId[] = ['characters', 'lightCones', 'enemies', 'rules'];
  private active: TabId = 'characters';

  constructor(
    private readonly vm: ArchiveViewModel,
    onBack: () => void,
  ) {
    const labels: Record<TabId, string> = { characters: 'Characters', lightCones: 'Light Cones', enemies: 'Enemies', rules: 'Combat Rules' };
    const tabBar = h('nav', { class: 'archive__tabs', attrs: { role: 'tablist' } });
    for (const id of this.order) {
      const b = h('button', { class: 'archive-tab', text: labels[id], attrs: { type: 'button', role: 'tab', 'data-tab': id }, on: { click: () => this.show(id) } });
      this.tabs.set(id, b);
      tabBar.append(b);
    }
    this.body = h('div', { class: 'archive__body' });
    this.el = h(
      'section',
      { class: 'screen archive', attrs: { 'data-screen': 'data-archive' } },
      h(
        'header',
        { class: 'archive__header' },
        h('div', {}, h('div', { class: 'eyebrow' }, h('span', { class: 'diamond' }), 'Data Archive'), h('h1', { class: 'archive__title', text: 'Content Registry' })),
        h('button', { class: 'pill-button', attrs: { type: 'button', 'data-id': 'back' }, on: { click: () => onBack() } }, h('span', { class: 'icon', trustedHtml: UI_ICONS.back }), 'Back'),
      ),
      tabBar,
      this.body,
      h('footer', { class: 'archive__footer' }, h('span', { text: vm.summary }), h('span', {}, h('span', { class: 'keycap', text: 'Q' }), ' ', h('span', { class: 'keycap', text: 'E' }), ' Switch tab   ', h('span', { class: 'keycap', text: 'Esc' }), ' Back')),
    );
    this.show('characters');
  }

  cycleTab(delta: number): void {
    const i = this.order.indexOf(this.active);
    this.show(this.order[(i + delta + this.order.length) % this.order.length] as TabId);
  }

  show(id: TabId): void {
    this.active = id;
    for (const [k, b] of this.tabs) b.classList.toggle('is-active', k === id);
    this.body.replaceChildren(this.render(id));
    this.body.scrollTop = 0;
  }

  private render(id: TabId): HTMLElement {
    switch (id) {
      case 'characters':
        return h('div', { class: 'card-grid' }, ...this.vm.characters.map((c, i) => this.characterCard(c, i)));
      case 'lightCones':
        return h('div', { class: 'card-grid' }, ...this.vm.lightCones.map((lc, i) => this.lightConeCard(lc, i)));
      case 'enemies':
        return h('div', { class: 'card-grid' }, ...this.vm.enemies.map((e, i) => this.enemyCard(e, i)));
      case 'rules':
        return this.rulesView();
    }
  }

  private characterCard(c: CharacterCardView, i: number): HTMLElement {
    return h(
      'article',
      { class: `char-card char-card--${c.rarity}`, style: { '--portrait': c.portraitColor, '--el': c.elementColor, 'animation-delay': `${i * 70}ms` }, dataset: { id: c.id } },
      h(
        'div',
        { class: 'char-card__art' },
        h('div', { class: 'char-card__monogram', text: c.name.slice(0, 1) }),
        h('div', { class: 'char-card__silhouette', trustedHtml: SILHOUETTE }),
        h('div', { class: 'char-card__element', attrs: { title: c.element }, trustedHtml: ELEMENT_ICONS[c.element] }),
        h('div', { class: 'char-card__path', attrs: { title: c.pathName }, trustedHtml: PATH_ICONS[c.path] }),
      ),
      h(
        'div',
        { class: 'char-card__body' },
        stars(c.rarity),
        h('div', { class: 'char-card__name', text: c.name }),
        h('div', { class: 'char-card__meta', text: `${c.title} · ${c.element} · ${c.pathName}` }),
        h('dl', { class: 'stat-table' }, ...c.stats.flatMap(([k, v]) => [h('dt', { text: k }), h('dd', { text: v })])),
        h('div', { class: 'kit-list' }, ...c.kit.map(([kind, name]) => h('span', { class: 'kit-chip' }, h('b', { text: kind }), name))),
      ),
    );
  }

  private lightConeCard(lc: LightConeCardView, i: number): HTMLElement {
    const rarityColor = lc.rarity === 5 ? 'var(--c-5star-a)' : lc.rarity === 4 ? 'var(--c-4star-a)' : 'var(--c-3star-a)';
    return h(
      'article',
      { class: 'info-card lc-card', style: { '--rarity': rarityColor, 'animation-delay': `${i * 70}ms` } },
      h('div', { class: 'info-card__head' }, h('span', { class: 'icon', trustedHtml: PATH_ICONS[lc.path] }), h('div', { class: 'info-card__title', text: lc.name })),
      stars(lc.rarity),
      h('div', { class: 'char-card__meta', text: `${lc.path} · ${lc.stats}` }),
      h('p', {}, h('b', { text: `${lc.passiveName}: ` }), lc.passive),
    );
  }

  private enemyCard(e: EnemyCardView, i: number): HTMLElement {
    return h(
      'article',
      { class: 'info-card', style: { 'animation-delay': `${i * 70}ms` } },
      h('div', { class: 'info-card__head' }, h('div', { class: 'info-card__title', text: e.name })),
      h('div', { class: 'char-card__meta', text: e.rank }),
      h('div', { class: 'weak-row' }, ...e.weaknesses.map((w) => h('span', { class: 'icon', style: { color: w.color }, attrs: { title: `Weak to ${w.element}` }, trustedHtml: ELEMENT_ICONS[w.element] }))),
      h('div', { class: 'toughness-bar', attrs: { title: `Toughness ${e.toughness}` } }, h('span', { style: { width: `${Math.min(100, (e.toughness / e.maxToughness) * 100)}%` } })),
      h('p', { text: e.detail }),
    );
  }

  private rulesView(): HTMLElement {
    const table = h(
      'table',
      { class: 'rules-table' },
      h('thead', {}, h('tr', {}, h('th', { text: 'Element' }), h('th', { text: 'Break DMG' }), h('th', { text: 'Break Effect' }), h('th', { text: 'Delay (BE 0%)' }), h('th', { class: 'col-summary', text: 'Summary' }))),
      h(
        'tbody',
        {},
        ...this.vm.breaks.map((b) =>
          h(
            'tr',
            {},
            h('td', {}, h('span', { class: 'el-tag', style: { color: b.color } }, h('span', { class: 'icon', trustedHtml: ELEMENT_ICONS[b.element] }), b.element)),
            h('td', { class: 'num', text: b.multiplier }),
            h('td', { text: b.effect }),
            h('td', { class: 'num', text: b.delay }),
            h('td', { class: 'col-summary', text: b.summary }),
          ),
        ),
      ),
    );
    return h('div', {}, h('div', { class: 'rule-chips' }, ...this.vm.rules.map(([k, v]) => h('span', { class: 'rule-chip' }, k, h('b', { text: v })))), h('div', { class: 'table-scroll' }, table));
  }
}
