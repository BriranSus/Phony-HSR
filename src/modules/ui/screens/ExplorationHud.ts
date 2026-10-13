import type { Element as GameElement } from '@models/common';
import { h } from '../dom';
import { ELEMENT_ICONS, UI_ICONS } from '../icons';

export interface PartySlotView {
  readonly id: string;
  readonly name: string;
  readonly element: GameElement;
  readonly color: string;
}

export interface PromptView {
  readonly id: string;
  readonly kind: 'sign' | 'chest' | 'npc';
  readonly label: string;
}

const KIND_ICON: Record<PromptView['kind'], string> = {
  sign: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"><path d="M5 4h14v9H5zM12 13v7M9 20h6"/><path d="M8 7.5h8M8 10h5"/></svg>`,
  chest: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"><path d="M4 10h16v9H4zM4 10a8 5 0 0 1 16 0"/><path d="M11 12h2v3h-2z"/></svg>`,
  npc: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><circle cx="12" cy="8" r="3.5"/><path d="M5 20c1-4 4-6 7-6s6 2 7 6"/></svg>`,
};

/**
 * Exploration HUD (Phase 2): area title, the party list on the right (slot keys 1-4, active
 * character highlighted), the reference game's right-side interaction prompt list (F on the
 * selected row, scrollable when more prompts than `maxVisible` are in range), the gait readout,
 * a toast line for hook events and a message box for interactions.
 */
export class ExplorationHud {
  readonly el: HTMLElement;
  private readonly partyEl: HTMLElement;
  private readonly promptsEl: HTMLElement;
  private readonly gaitEl: HTMLElement;
  private readonly toastEl: HTMLElement;
  private readonly messageEl: HTMLElement;
  private readonly messageText: HTMLElement;
  private readonly messageSpeaker: HTMLElement;
  private readonly barTop: HTMLElement;
  private readonly barBottom: HTMLElement;
  private readonly galleryEl: HTMLElement;
  private toastTimer: ReturnType<typeof setTimeout> | null = null;
  private messageTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    area: { name: string; subtitle: string },
    party: readonly PartySlotView[],
    private readonly maxVisible: number,
    hints: ReadonlyArray<readonly [string, string]>,
    onBack: () => void,
  ) {
    this.partyEl = h('ol', { class: 'party interactive', attrs: { 'aria-label': 'Party' } });
    party.forEach((p, i) =>
      this.partyEl.append(
        h(
          'li',
          { class: 'party__slot', style: { '--el': p.color }, dataset: { slot: String(i + 1), id: p.id } },
          h('span', { class: 'party__key keycap', text: String(i + 1) }),
          h('span', { class: 'party__name', text: p.name }),
          h('span', { class: 'party__el', attrs: { title: p.element }, trustedHtml: ELEMENT_ICONS[p.element] }),
        ),
      ),
    );
    this.promptsEl = h('div', { class: 'prompts', attrs: { 'aria-live': 'polite' } });
    this.gaitEl = h('div', { class: 'gait', dataset: { gait: 'run' } }, h('span', { class: 'gait__label', text: 'Run' }));
    this.toastEl = h('div', { class: 'xtoast' });
    this.messageSpeaker = h('div', { class: 'message__speaker' });
    this.messageText = h('div', { class: 'message__text' });
    this.messageEl = h('div', { class: 'message' }, this.messageSpeaker, this.messageText);
    this.barTop = h('div', { class: 'letterbox letterbox--top' });
    this.barBottom = h('div', { class: 'letterbox letterbox--bottom' });
    this.galleryEl = h('aside', { class: 'gallery interactive', attrs: { 'aria-label': 'Camera Gallery' } });
    this.el = h(
      'section',
      { class: 'screen screen--passthrough hud exploration', attrs: { 'data-screen': 'exploration' } },
      h(
        'div',
        { class: 'hud__area' },
        h('div', { class: 'eyebrow' }, h('span', { class: 'diamond' }), 'Exploration'),
        h('div', { class: 'hud__area-name', text: area.name }),
        h('div', { class: 'hud__area-sub', text: area.subtitle }),
      ),
      h(
        'div',
        { class: 'hud__back interactive' },
        h(
          'button',
          { class: 'pill-button', attrs: { type: 'button', 'data-id': 'back', 'aria-label': 'Back to the Departure Board (Esc)' }, on: { click: () => onBack() } },
          h('span', { class: 'icon', trustedHtml: UI_ICONS.back }),
          h('span', { class: 'pill-button__label', text: 'Esc · Departure Board' }),
        ),
      ),
      this.partyEl,
      this.promptsEl,
      this.gaitEl,
      this.toastEl,
      this.messageEl,
      this.barTop,
      this.barBottom,
      this.galleryEl,
      h('div', { class: 'hud__hints' }, ...hints.map(([k, label]) => h('span', {}, h('span', { class: 'keycap', text: k }), label))),
    );
  }

  setLeader(slot: number): void {
    [...this.partyEl.children].forEach((row, i) => row.classList.toggle('is-active', i === slot));
  }

  setGait(gait: string, moving: boolean): void {
    if (this.gaitEl.dataset.gait === gait && this.gaitEl.classList.contains('is-moving') === moving) return;
    this.gaitEl.dataset.gait = gait;
    this.gaitEl.classList.toggle('is-moving', moving);
    (this.gaitEl.firstElementChild as HTMLElement).textContent = gait[0]!.toUpperCase() + gait.slice(1);
  }

  /** Render the prompt list; only a window of `maxVisible` rows around the selection is shown. */
  setPrompts(prompts: readonly PromptView[], selected: number): void {
    const n = prompts.length;
    const start = Math.max(0, Math.min(selected - Math.floor(this.maxVisible / 2), n - this.maxVisible));
    const visible = prompts.slice(start, start + this.maxVisible);
    this.promptsEl.classList.toggle('is-open', n > 0);
    this.promptsEl.replaceChildren(
      ...(start > 0 ? [h('div', { class: 'prompts__more prompts__more--up', text: '▲' })] : []),
      ...visible.map((p, i) =>
        h(
          'div',
          { class: `prompt${start + i === selected ? ' is-selected' : ''}`, dataset: { prompt: p.id } },
          h('span', { class: 'prompt__key keycap', text: 'F' }),
          h('span', { class: 'prompt__icon', trustedHtml: KIND_ICON[p.kind] }),
          h('span', { class: 'prompt__label', text: p.label }),
        ),
      ),
      ...(start + this.maxVisible < n ? [h('div', { class: 'prompts__more', text: '▼' })] : []),
      ...(n > 1 ? [h('div', { class: 'prompts__hint', text: 'Scroll to select' })] : []),
    );
  }

  /** Cinematic letterbox bars (amount 0..1, bar height as a viewport fraction); hides HUD chrome. */
  setLetterbox(amount: number, height: number): void {
    const px = `${(amount * height * 100).toFixed(2)}vh`;
    this.barTop.style.height = px;
    this.barBottom.style.height = px;
    this.el.classList.toggle('is-cinematic', amount > 0.01);
  }

  /** Camera Gallery panel: shots (key, name, mode) with the playing one highlighted; null hides it. */
  setGallery(items: ReadonlyArray<{ key: string; name: string; mode: string; id: string }> | null, playing: string | null): void {
    this.galleryEl.classList.toggle('is-open', items !== null);
    this.el.classList.toggle('is-gallery', items !== null);
    // The panel steps aside while a shot plays so the framing is unobstructed.
    this.galleryEl.classList.toggle('is-playing', items !== null && playing !== null);
    if (!items) {
      this.galleryEl.replaceChildren();
      return;
    }
    this.galleryEl.replaceChildren(
      h('div', { class: 'eyebrow' }, h('span', { class: 'diamond' }), 'Camera Gallery'),
      ...items.map((it) =>
        h(
          'div',
          { class: `gallery__row${it.id === playing ? ' is-playing' : ''}`, dataset: { shot: it.id } },
          h('span', { class: 'keycap', text: it.key }),
          h('span', { class: 'gallery__name', text: it.name }),
          h('span', { class: 'gallery__mode', text: it.mode }),
        ),
      ),
      h('div', { class: 'gallery__hint' }, h('span', { class: 'keycap', text: 'F4' }), ' / ', h('span', { class: 'keycap', text: 'Esc' }), ' Close'),
    );
  }

  toast(text: string): void {
    this.toastEl.textContent = text;
    this.toastEl.classList.add('is-visible');
    if (this.toastTimer) clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => this.toastEl.classList.remove('is-visible'), 1800);
  }

  message(speaker: string, text: string): void {
    this.messageSpeaker.textContent = speaker;
    this.messageText.textContent = text;
    this.messageEl.classList.add('is-visible');
    if (this.messageTimer) clearTimeout(this.messageTimer);
    this.messageTimer = setTimeout(() => this.messageEl.classList.remove('is-visible'), 3600);
  }

  dispose(): void {
    if (this.toastTimer) clearTimeout(this.toastTimer);
    if (this.messageTimer) clearTimeout(this.messageTimer);
  }
}
