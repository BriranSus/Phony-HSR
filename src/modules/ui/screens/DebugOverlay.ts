import { h } from '../dom';

export interface DebugSection {
  readonly title: string;
  readonly rows: ReadonlyArray<readonly [string, string]>;
}

/** Developer overlay (toggle with F3 / `). Content is supplied by the app at a throttled rate. */
export class DebugOverlay {
  readonly el: HTMLElement;
  private visible: boolean;

  constructor(visible: boolean) {
    this.visible = visible;
    this.el = h('aside', { class: `debug${visible ? '' : ' is-hidden'}`, attrs: { 'data-screen': 'debug' } });
  }

  get isVisible(): boolean {
    return this.visible;
  }

  toggle(force?: boolean): void {
    this.visible = force ?? !this.visible;
    this.el.classList.toggle('is-hidden', !this.visible);
  }

  render(sections: readonly DebugSection[]): void {
    if (!this.visible) return;
    this.el.replaceChildren(
      ...sections.flatMap((s) => [h('h4', { text: s.title }), ...s.rows.map(([k, v]) => h('div', { class: 'debug__row' }, h('span', { text: k }), h('span', { text: v })))]),
    );
  }
}
