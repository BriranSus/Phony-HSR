import type { Puzzle } from '@models/world';

export type SequencePuzzle = Extract<Puzzle, { type: 'sequence' }>;
export type PlatesPuzzle = Extract<Puzzle, { type: 'plates' }>;

export interface SequenceStep {
  readonly progress: number;
  /** advance: right switch, more to go; solved: the last one; failed: wrong order (progress resets). */
  readonly outcome: 'advance' | 'solved' | 'failed';
}

/** One switch press in an order puzzle. A wrong or repeated switch resets the whole sequence. */
export function pressSequence(puzzle: SequencePuzzle, progress: number, switchId: string): SequenceStep {
  if (puzzle.switches[progress] !== switchId) return { progress: 0, outcome: 'failed' };
  const next = progress + 1;
  return { progress: next, outcome: next >= puzzle.switches.length ? 'solved' : 'advance' };
}

/** A plate puzzle holds when every one of its plates is pressed at the same moment. */
export function platesSatisfied(puzzle: PlatesPuzzle, pressed: ReadonlySet<string>): boolean {
  return puzzle.plates.every((id) => pressed.has(id));
}
