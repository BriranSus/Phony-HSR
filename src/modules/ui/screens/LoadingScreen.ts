import { h } from '../dom';
import { EMBLEM_SVG } from '../icons';

export interface LoadingTipView {
  readonly title: string;
  readonly text: string;
}

/** Boot loading screen: emblem with rotating rings, gameplay tip and a gold progress rail. */
export class LoadingScreen {
  readonly el: HTMLElement;
  private readonly fill: HTMLElement;
  private readonly percent: HTMLElement;
  private readonly label: HTMLElement;
  private readonly tipBox: HTMLElement;

  constructor(appTitle: string) {
    this.fill = h('div', { class: 'loading__fill' });
    this.percent = h('span', { class: 'loading__percent', text: '0%' });
    this.label = h('span', { class: 'loading__label', text: 'Initialising engine' });
    this.tipBox = h('div', { class: 'loading__tip' });
    this.el = h(
      'section',
      { class: 'screen loading', attrs: { 'data-screen': 'loading', role: 'progressbar', 'aria-valuemin': 0, 'aria-valuemax': 100 } },
      h('div', { class: 'loading__stars' }),
      h(
        'div',
        { class: 'loading__center' },
        h('div', { class: 'loading__ring loading__ring--a' }),
        h('div', { class: 'loading__ring loading__ring--b' }),
        h('div', { class: 'loading__emblem', trustedHtml: EMBLEM_SVG }),
      ),
      h('div', { class: 'loading__title', text: appTitle }),
      this.tipBox,
      h('div', { class: 'loading__footer' }, h('div', { class: 'loading__status' }, this.label, this.percent), h('div', { class: 'loading__track' }, this.fill)),
    );
  }

  setProgress(fraction: number, label?: string): void {
    const pct = Math.round(Math.min(1, Math.max(0, fraction)) * 100);
    this.fill.style.width = `${pct}%`;
    this.percent.textContent = `${pct}%`;
    this.el.setAttribute('aria-valuenow', String(pct));
    if (label) this.label.textContent = label;
  }

  setTip(tip: LoadingTipView | null): void {
    this.tipBox.replaceChildren();
    if (!tip) return;
    this.tipBox.append(
      h('div', { class: 'eyebrow loading__tip-title' }, h('span', { class: 'diamond' }), tip.title),
      h('p', { class: 'loading__tip-text', text: tip.text }),
    );
  }
}
