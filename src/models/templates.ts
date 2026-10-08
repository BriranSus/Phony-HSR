import type { Ability, Effect, ParamRef, StatModifier, SuperimposedModifier, Trigger, Value } from './ability';
import type { Character } from './character';
import type { LightCone } from './lightcone';
import type { RelicSet } from './relic';
import type { LevelScaled, Superimposed } from './scaling';

/**
 * Description templates.
 *
 * Every player-facing description of an ability, Trace, Eidolon, Light Cone passive or relic set
 * bonus is a template whose numbers come from the same data the engine executes, so text and
 * mechanics cannot drift apart. Two placeholder forms are supported:
 *
 * - `{n}` (zero-based index) into the source's ordered value list:
 *   - abilities: each effect in order (then each trigger's effects): damage `multiplier`; heal/shield
 *     `multiplier` then `flat`; applyStatus `params` values in key order. Then the ability's `modifiers`.
 *   - Light Cone passives: `modifiers` values in order, then `params` in key order.
 *   - Traces, Eidolons, relic set bonuses: `modifiers` values in order, then trigger applyStatus params.
 * - `{name}`: a named value: an ability's per-level `params` (`{p1}` = the reference game's `#1`),
 *   a Light Cone's superimposed `params`, or a literal applyStatus param name.
 *
 * Values given as `{ "param": ... }` references are not listed separately: they already appear under
 * their param name.
 *
 * A trailing `%` (`{0}%`) formats the value as a percentage. `templateProblems()` lists placeholders
 * that do not resolve; the data registry runs it for every shipped record, so a broken placeholder
 * fails the data load instead of rendering as "?".
 */

/** A value a placeholder can point at: an ability-level-scaled value or a Superimposition S1..S5 tuple. */
export type TemplateValue = { readonly kind: 'level'; readonly value: LevelScaled } | { readonly kind: 'superimposed'; readonly value: Superimposed };

export interface TemplateSlots {
  readonly indexed: readonly TemplateValue[];
  readonly named: Readonly<Record<string, TemplateValue>>;
}

const PLACEHOLDER = /\{([A-Za-z0-9_]+)\}(%?)/g;

const level = (value: LevelScaled): TemplateValue => ({ kind: 'level', value });
const isRef = (v: unknown): v is ParamRef => typeof v === 'object' && v !== null && 'param' in v;
/** Literal values only; references are reachable by their param name. */
const lit = (v: Value | undefined): TemplateValue[] => (v === undefined || isRef(v) ? [] : [level(v)]);

function effectValues(effects: readonly Effect[]): { indexed: TemplateValue[]; named: Record<string, TemplateValue> } {
  const indexed: TemplateValue[] = [];
  const named: Record<string, TemplateValue> = {};
  for (const e of effects) {
    switch (e.kind) {
      case 'damage':
        indexed.push(...lit(e.multiplier));
        break;
      case 'heal':
      case 'shield':
        indexed.push(...lit(e.multiplier), ...lit(e.flat));
        break;
      case 'applyStatus':
        for (const [k, v] of Object.entries(e.params ?? {})) {
          if (isRef(v)) continue;
          indexed.push(level(v));
          named[k] = level(v);
        }
        break;
      default:
        break;
    }
  }
  return { indexed, named };
}

const triggerEffects = (triggers: readonly Trigger[]): Effect[] => triggers.flatMap((t) => t.effects);

export function abilityTemplateSlots(a: Ability): TemplateSlots {
  const fx = effectValues([...a.effects, ...triggerEffects(a.triggers)]);
  const params = Object.fromEntries(Object.entries(a.params).map(([k, table]) => [k, level({ table })]));
  return { indexed: [...fx.indexed, ...a.modifiers.flatMap((m) => lit(m.value))], named: { ...fx.named, ...params } };
}

/** Traces, Eidolons and relic set bonuses: modifiers first, then trigger applyStatus params. */
export function passiveTemplateSlots(p: { readonly modifiers: readonly StatModifier[]; readonly triggers: readonly Trigger[] }): TemplateSlots {
  const fx = effectValues(triggerEffects(p.triggers));
  return { indexed: [...p.modifiers.flatMap((m) => lit(m.value)), ...fx.indexed], named: fx.named };
}

export function lightConeTemplateSlots(lc: LightCone): TemplateSlots {
  const params = Object.entries(lc.passive.params);
  const sup = (value: Superimposed): TemplateValue => ({ kind: 'superimposed', value });
  return {
    indexed: [...lc.passive.modifiers.flatMap((m: SuperimposedModifier) => (isRef(m.value) ? [] : [sup(m.value)])), ...params.map(([, v]) => sup(v))],
    named: Object.fromEntries(params.map(([k, v]) => [k, sup(v)])),
  };
}

function lookup(slots: TemplateSlots, key: string): TemplateValue | undefined {
  return /^\d+$/.test(key) ? slots.indexed[Number(key)] : slots.named[key];
}

/** Placeholders in `template` that do not resolve against `slots`. */
export function templateProblems(template: string, slots: TemplateSlots): string[] {
  const missing: string[] = [];
  for (const m of template.matchAll(PLACEHOLDER)) {
    const key = m[1] ?? '';
    if (!lookup(slots, key)) missing.push(`{${key}}`);
  }
  return missing;
}

/**
 * Fill a template. `format(value, percent)` renders a resolved value; it is only called for
 * placeholders that resolve (use `templateProblems` to validate beforehand).
 */
export function fillTemplate(template: string, slots: TemplateSlots, format: (value: TemplateValue, percent: boolean) => string): string {
  return template.replace(PLACEHOLDER, (whole, key: string, pct: string) => {
    const v = lookup(slots, key);
    return v ? format(v, pct === '%') : whole;
  });
}

const describe = (where: string, template: string, slots: TemplateSlots): string[] =>
  templateProblems(template, slots).map((p) => `${where}: description placeholder ${p} does not resolve`);

/** Unresolvable placeholders anywhere in a character (abilities, memosprite, traces, Eidolons). */
export function characterTemplateProblems(c: Character): string[] {
  const abilities = [
    c.abilities.basic,
    c.abilities.skill,
    c.abilities.ultimate,
    c.abilities.talent,
    c.abilities.technique,
    ...c.abilities.extra,
    ...(c.memosprite?.abilities ?? []),
    ...c.summons.flatMap((s) => s.abilities),
  ];
  return [
    ...abilities.flatMap((a) => describe(a.id, a.description, abilityTemplateSlots(a))),
    ...c.traces.flatMap((t) => (t.passive ? describe(`trace ${t.id}`, t.passive.description, passiveTemplateSlots(t.passive)) : [])),
    ...c.eidolons.flatMap((e) => describe(`E${e.rank}`, e.description, passiveTemplateSlots(e))),
  ];
}

export function lightConeTemplateProblems(lc: LightCone): string[] {
  return describe('passive', lc.passive.description, lightConeTemplateSlots(lc));
}

export function relicSetTemplateProblems(s: RelicSet): string[] {
  return s.bonuses.flatMap((b) => describe(`${b.pieces}-piece bonus`, b.description, passiveTemplateSlots(b)));
}
