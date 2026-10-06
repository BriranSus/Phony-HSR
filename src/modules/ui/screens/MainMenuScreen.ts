import { h } from '../dom';
import { UI_ICONS } from '../icons';

export interface MenuItemView {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly disabled?: boolean;
  /** Small label, e.g. "Phase 21" for systems that are not built yet. */
  readonly badge?: string;
}

/** Departure-board style main menu panel sliding in from the right. */
export class MainMenuScreen {
  readonly el: HTMLElement;
  private readonly rows: HTMLElement[] = [];
  private focus = 0;

  constructor(
    private readonly items: readonly MenuItemView[],
    private readonly onSelect: (id: string) => void,
    onBack: () => void,
  ) {
    const list = h('ul', { class: 'menu__list', attrs: { role: 'menu' } });
    items.forEach((item, i) => {
      const row = h(
        'li',
        {
          class: `menu-item${item.disabled ? ' is-disabled' : ''}`,
          attrs: { role: 'menuitem', 'aria-disabled': item.disabled ? 'true' : undefined, 'data-id': item.id },
          style: { 'animation-delay': `${120 + i * 70}ms` },
          on: {
            mouseenter: () => this.setFocus(i),
            click: (e) => {
              e.stopPropagation();
              this.activate(i);
            },
          },
        },
        h('span', { class: 'menu-item__index', text: String(i + 1).padStart(2, '0') }),
        h('div', {}, h('div', { class: 'menu-item__title', text: item.title }), h('div', { class: 'menu-item__desc', text: item.description })),
        item.badge ? h('span', { class: 'menu-item__badge', text: item.badge }) : h('span', { class: 'menu-item__chevron icon', trustedHtml: UI_ICONS.back }),
      );
      this.rows.push(row);
      list.append(row);
    });

    this.el = h(
      'section',
      { class: 'screen menu', attrs: { 'data-screen': 'main-menu' }, on: { click: () => onBack() } },
      h('div', { class: 'menu__scrim' }),
      h(
        'div',
        { class: 'menu__panel', on: { click: (e) => e.stopPropagation() } },
        h('div', { class: 'eyebrow' }, h('span', { class: 'diamond' }), 'Meridian Express'),
        h('h1', { class: 'menu__title', text: 'Departure Board' }),
        h('div', { class: 'menu__caption', text: 'Choose your next destination among the stars.' }),
        list,
        h(
          'div',
          { class: 'menu__footer' },
          h('span', {}, h('span', { class: 'keycap', text: 'W' }), h('span', { class: 'keycap', text: 'S' }), 'Select'),
          h('span', {}, h('span', { class: 'keycap', text: 'Enter' }), 'Confirm'),
          h('span', {}, h('span', { class: 'keycap', text: 'Esc' }), 'Back'),
        ),
      ),
    );
    this.setFocus(this.items.findIndex((i) => !i.disabled));
  }

  /** Fade out while a full-screen page (e.g. the Data Archive) is stacked above the menu. */
  setCovered(covered: boolean): void {
    this.el.classList.toggle('is-covered', covered);
  }

  moveFocus(delta: number): void {
    const n = this.items.length;
    let i = this.focus;
    for (let step = 0; step < n; step++) {
      i = (i + delta + n) % n;
      if (!this.items[i]?.disabled) break;
    }
    this.setFocus(i);
  }

  activateFocused(): void {
    this.activate(this.focus);
  }

  private setFocus(i: number): void {
    if (i < 0) return;
    this.focus = i;
    this.rows.forEach((r, j) => r.classList.toggle('is-focused', j === i));
  }

  private activate(i: number): void {
    const item = this.items[i];
    if (!item || item.disabled) return;
    this.onSelect(item.id);
  }
}
