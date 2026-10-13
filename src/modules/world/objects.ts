import type { Requirement, WorldObject } from '@models/world';

/**
 * Interactable state machines (pure). Each object kind has a small set of states and the events
 * that move between them; the runtime applies side effects (rewards, colliders, events) around
 * these transitions.
 *
 *   chest        closed  --interact--> opened
 *   collectible  present --interact--> collected
 *   breakable    intact  --hit x N---> broken
 *   switch       off --interact--> on        (toggle mode: on --interact--> off; any --reset--> off)
 *   plate        idle <--press / release--> pressed
 *   gate         closed  --open------> open
 *   anchor       dormant --interact--> active
 *   sign / npc / portal / crate: idle (stateless)
 */
export type ObjectEvent = 'interact' | 'hit' | 'press' | 'release' | 'open' | 'reset';

export function initialState(def: WorldObject): string {
  switch (def.kind) {
    case 'chest':
      return 'closed';
    case 'collectible':
      return 'present';
    case 'breakable':
      return 'intact';
    case 'switch':
      return 'off';
    case 'plate':
      return 'idle';
    case 'gate':
      return 'closed';
    case 'anchor':
      return 'dormant';
    default:
      return 'idle';
  }
}

/** The state after `event`, or null if the event does nothing in `state`. `hits` = hits already taken. */
export function nextState(def: WorldObject, state: string, event: ObjectEvent, hits = 0): string | null {
  switch (def.kind) {
    case 'chest':
      return state === 'closed' && event === 'interact' ? 'opened' : null;
    case 'collectible':
      return state === 'present' && event === 'interact' ? 'collected' : null;
    case 'breakable':
      if (state !== 'intact' || event !== 'hit') return null;
      return hits + 1 >= def.hits ? 'broken' : 'intact';
    case 'switch':
      if (event === 'reset') return state === 'on' ? 'off' : null;
      if (event !== 'interact') return null;
      if (state === 'off') return 'on';
      return def.mode === 'toggle' ? 'off' : null;
    case 'plate':
      if (event === 'press') return state === 'idle' ? 'pressed' : null;
      if (event === 'release') return state === 'pressed' ? 'idle' : null;
      return null;
    case 'gate':
      return state === 'closed' && event === 'open' ? 'open' : null;
    case 'anchor':
      return state === 'dormant' && event === 'interact' ? 'active' : null;
    default:
      return null;
  }
}

/** Objects that no longer appear in the F-prompt list. */
export function isSpent(def: WorldObject, state: string): boolean {
  switch (def.kind) {
    case 'chest':
      return state === 'opened';
    case 'collectible':
      return state === 'collected';
    case 'breakable':
      return state === 'broken';
    case 'gate':
      return state === 'open';
    case 'plate':
      return true;
    case 'switch':
      return def.mode === 'press' && state === 'on';
    default:
      return false;
  }
}

/** Prompt text for the current state. */
export function promptLabel(def: WorldObject, state: string): string {
  if (def.kind === 'anchor' && state === 'dormant') return `Activate: ${def.label.replace(/^Space Anchor:\s*/, '')}`;
  return def.label;
}

/** What the requirement checks need to know about the world. */
export interface RequirementContext {
  puzzleSolved(id: string): boolean;
  objectState(id: string): string | undefined;
  itemCount(id: string): number;
  hiddenDiscovered(id: string): boolean;
}

export function requirementMet(r: Requirement, ctx: RequirementContext): boolean {
  switch (r.kind) {
    case 'puzzle':
      return ctx.puzzleSolved(r.id);
    case 'object':
      return ctx.objectState(r.id) === r.state;
    case 'item':
      return ctx.itemCount(r.id) >= r.count;
    case 'hidden':
      return ctx.hiddenDiscovered(r.id);
  }
}

export function unmetRequirements(reqs: readonly Requirement[], ctx: RequirementContext): Requirement[] {
  return reqs.filter((r) => !requirementMet(r, ctx));
}
