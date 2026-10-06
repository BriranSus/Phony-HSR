import { h } from '../dom';

/** Shown when boot fails (no WebGL, invalid data in strict mode...). */
export function createFatalScreen(title: string, detail: string): HTMLElement {
  return h(
    'section',
    { class: 'screen fatal', attrs: { 'data-screen': 'fatal' } },
    h('div', { class: 'fatal__box' }, h('div', { class: 'eyebrow' }, h('span', { class: 'diamond' }), 'Boot failure'), h('h2', { text: title }), h('pre', { text: detail })),
  );
}
