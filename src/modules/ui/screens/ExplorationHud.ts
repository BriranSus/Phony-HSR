import type { Element as GameElement } from '@models/common';
import type { WorldObjectKind } from '@models/world';
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
  readonly kind: WorldObjectKind;
  readonly label: string;
}

const icon = (inner: string): string => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round" stroke-linecap="round">${inner}</svg>`;
const KIND_ICON: Record<PromptView['kind'], string> = {
  sign: icon('<path d="M5 4h14v9H5zM12 13v7M9 20h6"/><path d="M8 7.5h8M8 10h5"/>'),
  chest: icon('<path d="M4 10h16v9H4zM4 10a8 5 0 0 1 16 0"/><path d="M11 12h2v3h-2z"/>'),
  npc: icon('<circle cx="12" cy="8" r="3.5"/><path d="M5 20c1-4 4-6 7-6s6 2 7 6"/>'),
  collectible: icon('<path d="M12 3l3 6 6 1-4.5 4.2L17.7 21 12 17.8 6.3 21l1.2-6.8L3 10l6-1z"/>'),
  breakable: icon('<path d="M5 5l5 5-3 2 6 3-2 4M19 4l-4 5M19 14l-3 1"/>'),
  switch: icon('<rect x="8" y="3" width="8" height="18" rx="4"/><circle cx="12" cy="9" r="2"/>'),
  plate: icon('<ellipse cx="12" cy="15" rx="8" ry="3"/><path d="M4 15v-2"/><path d="M20 15v-2"/><ellipse cx="12" cy="13" rx="8" ry="3"/>'),
  crate: icon('<path d="M4 7l8-4 8 4v10l-8 4-8-4z"/><path d="M4 7l8 4 8-4M12 11v10"/>'),
  gate: icon('<path d="M4 21V8a8 8 0 0 1 16 0v13"/><path d="M12 8v13M4 14h16"/>'),
  anchor: icon('<path d="M12 3l3 6-3 3-3-3zM12 12v9M7 21h10"/><circle cx="12" cy="17" r="0.8"/>'),
  portal: icon('<ellipse cx="12" cy="12" rx="6" ry="9"/><ellipse cx="12" cy="12" rx="2.5" ry="5"/>'),
};

/**
 * Exploration HUD (Phase 2): area title, the party list on the right (slot keys 1-4, active
 * character highlighted), the reference game's right-side interaction prompt list (F on the
 * selected row, scrollable when more prompts than `maxVisible` are in range), the gait readout,
 * a toast line for hook events and a message box for interactions.
 */
export interface AnchorRowView {
  readonly key: string;
  readonly label: string;
  readonly area: string;
  readonly region: string;
  readonly current: boolean;
}

export interface ExplorationHandlers {
  anchorChosen?: (key: string) => void;
  anchorsClosed?: () => void;
}

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
  private readonly progressEl: HTMLElement;
  private readonly progressLabel: HTMLElement;
  private readonly progressBar: HTMLElement;
  private readonly areaNameEl: HTMLElement;
  private readonly areaSubEl: HTMLElement;
  private readonly bannerEl: HTMLElement;
  private readonly anchorsEl: HTMLElement;
  private readonly tpEl: HTMLElement;
  private bannerTimer: ReturnType<typeof setTimeout> | null = null;
  private handlers: ExplorationHandlers = {};
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
    this.toastEl = h('div', { class: 'xtoasts', attrs: { 'aria-live': 'polite' } });
    this.messageSpeaker = h('div', { class: 'message__speaker' });
    this.messageText = h('div', { class: 'message__text' });
    this.messageEl = h('div', { class: 'message' }, this.messageSpeaker, this.messageText);
    this.barTop = h('div', { class: 'letterbox letterbox--top' });
    this.barBottom = h('div', { class: 'letterbox letterbox--bottom' });
    this.galleryEl = h('aside', { class: 'gallery interactive', attrs: { 'aria-label': 'Camera Gallery' } });
    this.areaNameEl = h('div', { class: 'hud__area-name', text: area.name });
    this.areaSubEl = h('div', { class: 'hud__area-sub', text: area.subtitle });
    this.progressLabel = h('span', { class: 'hud__progress-label', text: 'Exploration 0%' });
    this.progressBar = h('span', { class: 'hud__progress-bar' }, h('span', { class: 'hud__progress-fill' }));
    this.progressEl = h('div', { class: 'hud__progress', attrs: { 'data-id': 'exploration-progress' } }, this.progressLabel, this.progressBar);
    this.bannerEl = h('div', { class: 'area-banner', attrs: { 'aria-live': 'polite' } });
    this.anchorsEl = h('aside', { class: 'anchors interactive', attrs: { 'aria-label': 'Space Anchors' } });
    this.tpEl = h('div', { class: 'hud__tp', attrs: { 'aria-label': 'Technique Points', 'data-id': 'technique-points' } });
    this.el = h(
      'section',
      { class: 'screen screen--passthrough hud exploration', attrs: { 'data-screen': 'exploration' } },
      h(
        'div',
        { class: 'hud__area' },
        h('div', { class: 'eyebrow' }, h('span', { class: 'diamond' }), 'Exploration'),
        this.areaNameEl,
        this.areaSubEl,
        this.progressEl,
        this.tpEl,
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
      this.bannerEl,
      this.anchorsEl,
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
    this.el.classList.toggle("is-cinematic", amount > 0.001);
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

  /** Adds a line to the toast stack (pickups, discoveries, progress); each fades on its own. */
  toast(text: string): void {
    const item = h('div', { class: 'xtoast', text });
    this.toastEl.append(item);
    while (this.toastEl.children.length > 4) this.toastEl.firstElementChild?.remove();
    requestAnimationFrame(() => item.classList.add('is-visible'));
    setTimeout(() => {
      item.classList.remove('is-visible');
      setTimeout(() => item.remove(), 260);
    }, 2200);
  }

  setHandlers(handlers: ExplorationHandlers): void {
    this.handlers = handlers;
  }

  /** The area title block (updated on an area transition). */
  setArea(name: string, subtitle: string): void {
    this.areaNameEl.textContent = name;
    this.areaSubEl.textContent = subtitle;
  }

  /** Exploration progress of the current area. */
  setProgress(percent: number, found: number, total: number): void {
    this.progressLabel.textContent = `Exploration ${percent}%`;
    this.progressEl.title = `${found} of ${total} found`;
    this.progressEl.dataset.percent = String(percent);
    (this.progressBar.firstElementChild as HTMLElement).style.width = `${percent}%`;
  }

  /** Big area-name banner shown on entering an area. */
  showBanner(title: string, subtitle: string): void {
    this.bannerEl.replaceChildren(h('div', { class: 'area-banner__rule' }), h('div', { class: 'area-banner__title', text: title }), h('div', { class: 'area-banner__sub', text: subtitle }));
    this.bannerEl.classList.remove('is-visible');
    void this.bannerEl.offsetWidth;
    this.bannerEl.classList.add('is-visible');
    if (this.bannerTimer) clearTimeout(this.bannerTimer);
    this.bannerTimer = setTimeout(() => this.bannerEl.classList.remove('is-visible'), 2600);
  }

  /** The Space Anchor travel list (null closes it). Rows are clickable; the selection also follows W / S. */
  showAnchors(rows: readonly AnchorRowView[] | null, selected: number): void {
    this.anchorsEl.classList.toggle('is-open', rows !== null);
    if (!rows) {
      this.anchorsEl.replaceChildren();
      return;
    }
    this.anchorsEl.replaceChildren(
      h('div', { class: 'eyebrow' }, h('span', { class: 'diamond' }), 'Space Anchors'),
      ...rows.map((row, i) =>
        h(
          'button',
          {
            class: `anchors__row${i === selected ? ' is-selected' : ''}${row.current ? ' is-current' : ''}`,
            attrs: { type: 'button', 'data-anchor': row.key },
            on: { click: () => this.handlers.anchorChosen?.(row.key) },
          },
          h('span', { class: 'anchors__name', text: row.label }),
          h('span', { class: 'anchors__where', text: `${row.region} · ${row.area}${row.current ? ' · here' : ''}` }),
        ),
      ),
      h('div', { class: 'anchors__hint' }, h('span', { class: 'keycap', text: 'W' }), h('span', { class: 'keycap', text: 'S' }), ' Select ', h('span', { class: 'keycap', text: 'F' }), ' Travel ', h('span', { class: 'keycap', text: 'Esc' }), ' Close'),
    );
  }

  /** Technique Points as pips (cast on the overworld; each arms a battle-start effect). */
  setTechniquePoints(current: number, max: number): void {
    this.tpEl.dataset.points = String(current);
    this.tpEl.replaceChildren(h('span', { class: 'hud__tp-label', text: 'Technique' }), ...Array.from({ length: max }, (_, i) => h('span', { class: `hud__tp-pip${i < current ? ' is-full' : ''}` })));
  }

  message(speaker: string, text: string): void {
    this.messageSpeaker.textContent = speaker;
    this.messageText.textContent = text;
    this.messageEl.classList.add('is-visible');
    if (this.messageTimer) clearTimeout(this.messageTimer);
    this.messageTimer = setTimeout(() => this.messageEl.classList.remove('is-visible'), 3600);
  }

  dispose(): void {
    if (this.bannerTimer) clearTimeout(this.bannerTimer);
    if (this.messageTimer) clearTimeout(this.messageTimer);
  }
}
