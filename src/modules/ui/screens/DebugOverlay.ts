import { h } from '../dom';

export interface DebugSection {
  readonly title: string;
  /** Show the rows in a scrollable box (an event log). */
  readonly scroll?: boolean;
  readonly rows: ReadonlyArray<readonly [string, string]>;
}

/** Developer overlay (toggle with F3 / `). Content is supplied by the app at a throttled rate. */
export class DebugOverlay {
  readonly el: HTMLElement;
  private visible: boolean;
  private readonly providers = new Map<string, () => readonly DebugSection[]>();
  private readonly scrolls = new Map<string, { top: number; client: number; height: number }>();

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

  /** Lets a running state add its own sections (the world layer shows progress and its event log). */
  setProvider(key: string, provider: (() => readonly DebugSection[]) | null): void {
    if (provider) this.providers.set(key, provider);
    else this.providers.delete(key);
  }

  render(base: readonly DebugSection[]): void {
    if (!this.visible) return;
    const sections = [...base, ...[...this.providers.values()].flatMap((p) => p())];
    this.el.replaceChildren(
      ...sections.flatMap((s) => {
        const rows = s.rows.map(([k, v]) => h('div', { class: 'debug__row' }, h('span', { text: k }), h('span', { text: v })));
        if (!s.scroll) return [h('h4', { text: s.title }), ...rows];
        const box = h('div', { class: 'debug__scroll' }, ...rows);
        // Keep following the newest line unless the reader scrolled up.
        const prev = this.scrolls.get(s.title);
        requestAnimationFrame(() => {
          box.scrollTop = prev && prev.top + prev.client < prev.height - 4 ? prev.top : box.scrollHeight;
        });
        box.addEventListener('scroll', () => this.scrolls.set(s.title, { top: box.scrollTop, client: box.clientHeight, height: box.scrollHeight }));
        return [h('h4', { text: s.title }), box];
      }),
    );
  }
}
