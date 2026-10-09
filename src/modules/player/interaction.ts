import type { Interactable } from '@models/locomotion';

/**
 * Proximity interaction list (the reference game's right-side prompt list): every interactable
 * within `radius` (horizontal distance, similar height), nearest first. When several are in range
 * the selection can be scrolled; the selection follows the same object while the list changes.
 */
export interface PromptEntry {
  readonly interactable: Interactable;
  readonly distance: number;
}

const HEIGHT_WINDOW = 1.6;

export function interactablesInRange(items: readonly Interactable[], x: number, y: number, z: number, radius: number): PromptEntry[] {
  return items
    .map((it) => ({ interactable: it, distance: Math.hypot(it.position[0] - x, it.position[2] - z), dy: Math.abs(it.position[1] - y) }))
    .filter((e) => e.distance <= radius && e.dy <= HEIGHT_WINDOW)
    .sort((a, b) => a.distance - b.distance || a.interactable.id.localeCompare(b.interactable.id))
    .map(({ interactable, distance }) => ({ interactable, distance }));
}

export class PromptList {
  private entries: PromptEntry[] = [];
  private selectedId: string | null = null;

  get items(): readonly PromptEntry[] {
    return this.entries;
  }

  get selectedIndex(): number {
    const i = this.entries.findIndex((e) => e.interactable.id === this.selectedId);
    return i < 0 ? 0 : i;
  }

  get selected(): Interactable | null {
    return this.entries[this.selectedIndex]?.interactable ?? null;
  }

  /** Replace the in-range entries. Returns true if the visible list or selection changed. */
  update(entries: PromptEntry[]): boolean {
    const before = this.entries.map((e) => e.interactable.id).join('|') + '#' + (this.selected?.id ?? '');
    this.entries = entries;
    if (!entries.some((e) => e.interactable.id === this.selectedId)) this.selectedId = entries[0]?.interactable.id ?? null;
    const after = this.entries.map((e) => e.interactable.id).join('|') + '#' + (this.selected?.id ?? '');
    return before !== after;
  }

  /** Move the selection by `delta` (mouse wheel / d-pad), clamped to the list. */
  scroll(delta: number): boolean {
    if (this.entries.length < 2 || delta === 0) return false;
    const i = Math.min(this.entries.length - 1, Math.max(0, this.selectedIndex + Math.sign(delta)));
    const id = this.entries[i]?.interactable.id ?? null;
    if (id === this.selectedId) return false;
    this.selectedId = id;
    return true;
  }
}
