import type { StateTransitioner } from '@core/state/StateManager';
import { animate, h } from './dom';
import { EMBLEM_SVG } from './icons';

/**
 * Scene transition: two navy shutters close diagonally with a gold light seam and the emblem,
 * then open again. Implements the core StateTransitioner contract so the StateManager stays
 * presentation-agnostic.
 */
export class TransitionOverlay implements StateTransitioner {
  private readonly el: HTMLElement;
  private readonly top: HTMLElement;
  private readonly bottom: HTMLElement;
  private readonly seam: HTMLElement;
  private readonly emblem: HTMLElement;

  constructor(
    host: HTMLElement,
    private durationMs: number,
  ) {
    this.top = h('div', { class: 'tr-shutter tr-shutter--top' });
    this.bottom = h('div', { class: 'tr-shutter tr-shutter--bottom' });
    this.seam = h('div', { class: 'tr-seam' });
    this.emblem = h('div', { class: 'tr-emblem', trustedHtml: EMBLEM_SVG });
    this.el = h('div', { class: 'transition', attrs: { 'aria-hidden': 'true' } }, this.top, this.bottom, this.seam, this.emblem);
    host.append(this.el);
  }

  setDuration(ms: number): void {
    this.durationMs = ms;
  }

  get active(): boolean {
    return this.el.classList.contains('is-active');
  }

  async cover(): Promise<void> {
    const d = this.durationMs * 0.55;
    this.el.classList.add('is-active');
    const easing = 'cubic-bezier(.7,0,.25,1)';
    await Promise.all([
      animate(this.top, [{ transform: 'translateY(-105%) skewY(-6deg)' }, { transform: 'translateY(0) skewY(-6deg)' }], { duration: d, easing }),
      animate(this.bottom, [{ transform: 'translateY(105%) skewY(-6deg)' }, { transform: 'translateY(0) skewY(-6deg)' }], { duration: d, easing }),
      animate(this.seam, [{ opacity: 0, transform: 'scaleX(0) skewY(-6deg)' }, { opacity: 1, transform: 'scaleX(1) skewY(-6deg)' }], { duration: d, easing, delay: d * 0.45 }),
      animate(this.emblem, [{ opacity: 0, transform: 'translate(-50%,-50%) scale(.6) rotate(-45deg)' }, { opacity: 1, transform: 'translate(-50%,-50%) scale(1) rotate(0deg)' }], { duration: d, easing, delay: d * 0.4 }),
    ]);
  }

  async reveal(): Promise<void> {
    const d = this.durationMs * 0.45;
    const easing = 'cubic-bezier(.6,0,.3,1)';
    await Promise.all([
      animate(this.emblem, [{ opacity: 1 }, { opacity: 0, transform: 'translate(-50%,-50%) scale(1.25)' }], { duration: d * 0.6, easing }),
      animate(this.seam, [{ opacity: 1 }, { opacity: 0 }], { duration: d * 0.6, easing }),
      animate(this.top, [{ transform: 'translateY(0) skewY(-6deg)' }, { transform: 'translateY(-105%) skewY(-6deg)' }], { duration: d, easing, delay: d * 0.25 }),
      animate(this.bottom, [{ transform: 'translateY(0) skewY(-6deg)' }, { transform: 'translateY(105%) skewY(-6deg)' }], { duration: d, easing, delay: d * 0.25 }),
    ]);
    this.el.classList.remove('is-active');
  }
}
