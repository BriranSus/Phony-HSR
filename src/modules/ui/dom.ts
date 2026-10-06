/**
 * Tiny DOM builder used by all screens (no framework dependency). Screens are plain classes that
 * build an element tree once and update text/attributes in place, which keeps per-frame UI cost low.
 */
export type Child = Node | string | number | null | undefined | false;

export interface ElementProps {
  class?: string;
  id?: string;
  text?: string;
  /** Trusted, static markup only (built-in SVG icons). Never pass user or data strings here. */
  trustedHtml?: string;
  attrs?: Record<string, string | number | boolean | undefined>;
  style?: Record<string, string>;
  dataset?: Record<string, string>;
  on?: Partial<{ [E in keyof HTMLElementEventMap]: (e: HTMLElementEventMap[E]) => void }>;
}

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, props: ElementProps = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (props.class) el.className = props.class;
  if (props.id) el.id = props.id;
  if (props.text !== undefined) el.textContent = props.text;
  if (props.trustedHtml !== undefined) el.innerHTML = props.trustedHtml;
  if (props.attrs) {
    for (const [k, v] of Object.entries(props.attrs)) {
      if (v === undefined || v === false) continue;
      el.setAttribute(k, v === true ? '' : String(v));
    }
  }
  if (props.style) for (const [k, v] of Object.entries(props.style)) el.style.setProperty(k, v);
  if (props.dataset) for (const [k, v] of Object.entries(props.dataset)) el.dataset[k] = v;
  if (props.on) {
    for (const [event, handler] of Object.entries(props.on)) {
      el.addEventListener(event, handler as EventListener);
    }
  }
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    el.append(typeof c === 'number' ? String(c) : c);
  }
  return el;
}

/** Wait for an element animation; resolves immediately when animations are unsupported. */
export async function animate(el: Element, keyframes: Keyframe[], options: KeyframeAnimationOptions): Promise<void> {
  if (typeof el.animate !== 'function') return;
  const anim = el.animate(keyframes, { fill: 'forwards', ...options });
  try {
    await anim.finished;
  } catch {
    // Cancelled animations are fine.
  }
}

export function clear(el: Element): void {
  while (el.firstChild) el.removeChild(el.firstChild);
}
