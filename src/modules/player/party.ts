/**
 * Exploration party: up to four characters in slot order (number keys 1..4). Switching changes
 * only who is shown and controlled; the controller keeps its position, facing and velocity, as in
 * the reference game.
 */
export class PartyRoster {
  private active = 0;

  constructor(readonly members: readonly string[]) {
    if (members.length < 1 || members.length > 4) throw new RangeError('a party has 1..4 members');
  }

  get activeSlot(): number {
    return this.active;
  }

  get leader(): string {
    return this.members[this.active] as string;
  }

  /** Switch to slot (0-based). Returns false for an empty slot or the current leader. */
  switchTo(slot: number): boolean {
    if (!Number.isInteger(slot) || slot < 0 || slot >= this.members.length || slot === this.active) return false;
    this.active = slot;
    return true;
  }

  /** Make a specific character the leader (by id). */
  switchToCharacter(id: string): boolean {
    return this.switchTo(this.members.indexOf(id));
  }
}
