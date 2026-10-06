import { h } from '../dom';
import { EMBLEM_SVG, UI_ICONS } from '../icons';

export interface TitleScreenOptions {
  readonly title: string;
  readonly subtitle: string;
  readonly version: string;
  readonly buildLabel: string;
  readonly onStart: () => void;
  /** Side buttons whose systems arrive in later phases. */
  readonly onSideButton: (id: string, label: string) => void;
}

/** Title screen overlay over the 3D backdrop: wordmark, "click to start" and side shortcuts. */
export class TitleScreen {
  readonly el: HTMLElement;
  private readonly start: HTMLElement;
  private readonly toast: HTMLElement;
  private toastTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(o: TitleScreenOptions) {
    const side = (id: string, label: string, icon: string): HTMLElement =>
      h(
        'button',
        {
          class: 'side-button',
          attrs: { type: 'button', 'aria-label': label, 'data-id': id },
          on: {
            click: (e) => {
              e.stopPropagation();
              o.onSideButton(id, label);
            },
          },
        },
        h('span', { class: 'icon', trustedHtml: icon }),
        h('span', { class: 'side-button__label', text: label }),
      );

    this.start = h('div', { class: 'title__start', attrs: { role: 'button', tabindex: 0, 'data-id': 'start' } }, h('span', { class: 'title__start-text', text: 'CLICK TO START' }));
    this.toast = h('div', { class: 'title__toast' });

    this.el = h(
      'section',
      {
        class: 'screen title',
        attrs: { 'data-screen': 'title' },
        on: { click: () => o.onStart() },
      },
      h('div', { class: 'title__vignette' }),
      h(
        'div',
        { class: 'title__logo' },
        h('div', { class: 'title__emblem', trustedHtml: EMBLEM_SVG }),
        h('div', { class: 'title__wordmark' }, h('div', { class: 'title__name', text: o.title }), h('div', { class: 'title__sub', text: o.subtitle })),
      ),
      h(
        'div',
        { class: 'title__side' },
        side('announcements', 'Announcements', UI_ICONS.announce),
        side('account', 'Account', UI_ICONS.account),
        side('settings', 'Settings', UI_ICONS.settings),
        side('exit', 'Exit', UI_ICONS.exit),
      ),
      this.start,
      this.toast,
      h(
        'div',
        { class: 'title__footer' },
        h('div', {}, h('strong', { text: `v${o.version}` }), ` · ${o.buildLabel}`),
        h('div', { text: 'Unofficial fan project · all art, audio and names are original or procedurally generated' }),
      ),
    );
  }

  showToast(text: string): void {
    this.toast.textContent = text;
    this.toast.classList.add('is-visible');
    if (this.toastTimer) clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => this.toast.classList.remove('is-visible'), 2200);
  }

  /** Hide interactive chrome (start prompt, side buttons) while another screen covers the title. */
  setCovered(covered: boolean): void {
    this.el.classList.toggle('is-covered', covered);
  }

  dispose(): void {
    if (this.toastTimer) clearTimeout(this.toastTimer);
  }
}
