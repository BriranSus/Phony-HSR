/**
 * Party session state that lives between battles: Technique Points and the Techniques cast on the
 * overworld that will take effect when the next battle starts. In memory until the Phase 21 save
 * system persists it with the rest of the player's progress.
 */
export interface CombatSession {
  techniquePoints: number;
  /** Character ids whose Technique is active for the next battle. */
  activeTechniques: string[];
}

let session: CombatSession | null = null;

export function combatSession(maxTechniquePoints: number): CombatSession {
  session ??= { techniquePoints: maxTechniquePoints, activeTechniques: [] };
  return session;
}

export function resetCombatSession(): void {
  session = null;
}

/** Casts a Technique: costs 1 Technique Point and arms its battle-start effect. False if none is left or it is already armed. */
export function armTechnique(s: CombatSession, characterId: string): boolean {
  if (s.techniquePoints <= 0 || s.activeTechniques.includes(characterId)) return false;
  s.techniquePoints--;
  s.activeTechniques.push(characterId);
  return true;
}

/** The armed Techniques for a battle that is starting (they are spent by it). */
export function takeArmedTechniques(s: CombatSession): string[] {
  const armed = s.activeTechniques;
  s.activeTechniques = [];
  return armed;
}

export function refillTechniquePoints(s: CombatSession, max: number): void {
  s.techniquePoints = max;
}
