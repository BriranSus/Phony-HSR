import type { GameState } from '@core/state/StateManager';
import type { DataRegistry } from '@core/data/DataRegistry';
import { Collections } from '@models/collections';
import { ELEMENTS } from '@models/common';
import type { Element as GameElement } from '@models/common';
import { baseActionValue, breakActionDelay, grownStat } from '@models/formulas';
import { ELITE_OR_HIGHER } from '@models/enemy';
import { DataArchiveScreen, type ArchiveViewModel } from '@modules/ui';
import type { AppContext } from '../AppContext';
import { StateIds } from '../AppContext';

const RANK_LABEL: Record<string, string> = {
  normal: 'Normal Enemy',
  elite: 'Elite Enemy',
  boss: 'Boss',
  weeklyBoss: 'Weekly Boss',
  storyBoss: 'Story Boss',
  event: 'Event Enemy',
};

const fmt = (n: number, digits = 0): string => n.toLocaleString('en-US', { maximumFractionDigits: digits, minimumFractionDigits: digits });
const pct = (n: number, digits = 0): string => `${fmt(n * 100, digits)}%`;

/** Builds the archive view model purely from the data registry and the shared formulas. */
export function buildArchiveViewModel(data: DataRegistry): ArchiveViewModel {
  const combat = data.get(Collections.combatRules, 'default');
  const prog = data.get(Collections.progressionRules, 'default');
  const elementColor = new Map<GameElement, string>(data.all(Collections.elements).map((e) => [e.element, e.color]));
  const pathName = new Map(data.all(Collections.paths).map((p) => [p.path, p.name]));
  const color = (e: GameElement): string => elementColor.get(e) ?? '#ffffff';
  const maxAsc = prog.levelCaps.length - 1;

  const characters = data
    .all(Collections.characters)
    .sort((a, b) => b.rarity - a.rarity || a.name.localeCompare(b.name))
    .map((c) => {
      const s = c.baseStats;
      const at80 = (base: number): number => grownStat(base, prog.maxLevel, maxAsc, prog.character);
      return {
        id: c.id,
        name: c.name,
        title: c.lore.title,
        rarity: c.rarity,
        element: c.element,
        elementColor: color(c.element),
        path: c.path,
        pathName: pathName.get(c.path) ?? c.path,
        portraitColor: c.presentation.portraitColor,
        stats: [
          ['HP (Lv. 80)', fmt(at80(s.hp))],
          ['ATK (Lv. 80)', fmt(at80(s.atk))],
          ['DEF (Lv. 80)', fmt(at80(s.def))],
          ['SPD', fmt(s.spd)],
          ['Base Action Value', fmt(baseActionValue(s.spd, combat), 1)],
          ['Max Energy', fmt(c.maxEnergy)],
        ] as const,
        kit: [
          ['Basic', c.abilities.basic.name],
          ['Skill', c.abilities.skill.name],
          ['Ultimate', c.abilities.ultimate.name],
          ['Talent', c.abilities.talent.name],
          ...(c.memosprite ? ([['Memosprite', c.memosprite.name]] as const) : []),
        ] as const,
      };
    });

  const lightCones = data
    .all(Collections.lightCones)
    .sort((a, b) => b.rarity - a.rarity)
    .map((lc) => {
      const at80 = (base: number): number => grownStat(base, prog.maxLevel, maxAsc, prog.lightCone);
      const s1 = lc.passive.modifiers.map((m) => pct(m.value[0]));
      const s5 = lc.passive.modifiers.map((m) => pct(m.value[4]));
      const passive = lc.passive.description.replace(/\{(\d+)\}%?/g, (_m, i: string) => {
        const k = Number(i);
        return s1[k] !== undefined ? `${s1[k]} (S5 ${s5[k]})` : '?';
      });
      return {
        name: lc.name,
        rarity: lc.rarity,
        path: lc.path,
        passiveName: lc.passive.name,
        passive,
        stats: `Lv. 80 HP ${fmt(at80(lc.baseStats.hp))} · ATK ${fmt(at80(lc.baseStats.atk))} · DEF ${fmt(at80(lc.baseStats.def))}`,
      };
    });

  const enemies = data.all(Collections.enemies).map((e) => {
    const maxToughness = Math.max(...data.all(Collections.enemies).map((x) => x.toughness));
    const resList = Object.entries(e.resistances)
      .map(([el, v]) => `${el} RES ${pct(v)}`)
      .join(', ');
    return {
      name: e.name,
      rank: `${RANK_LABEL[e.rank] ?? e.rank} · ${e.faction}`,
      toughness: e.toughness,
      maxToughness,
      weaknesses: e.weaknesses.map((w) => ({ element: w, color: color(w) })),
      detail: [
        `Toughness ${e.toughness}`,
        `SPD ${e.baseStats.spd}`,
        e.phases.length ? `${e.phases.length} phases` : null,
        resList || null,
        ELITE_OR_HIGHER.has(e.rank) ? 'Elite-tier break rules (Bleed 7%, Wind Shear x3)' : 'Normal-tier break rules',
      ]
        .filter(Boolean)
        .join(' · '),
    };
  });

  const breaks = ELEMENTS.map((el) => {
    const b = combat.weaknessBreak.elements[el];
    const status = data.get(Collections.statusEffects, b.status);
    return {
      element: el,
      color: color(el),
      multiplier: `${fmt(b.breakDmgMultiplier, 1)}x`,
      effect: status.name,
      delay: pct(breakActionDelay(el, 0, combat)),
      summary: b.summary,
    };
  });

  const rules = [
    ['Action Value', `${fmt(combat.actionValue.numerator)} / SPD`],
    ['Skill Points', `start ${combat.skillPoints.start} · max ${combat.skillPoints.max}`],
    ['Energy', `Basic ${combat.energy.basic} · Skill ${combat.energy.skill} · Ult ${combat.energy.ultimate}`],
    ['CRIT', `${pct(combat.crit.baseRate)} / ${pct(combat.crit.baseDmg)}`],
    ['Enemy RES', `${pct(combat.resistance.defaultEnemyRes)} (weak ${pct(combat.resistance.weakEnemyRes)})`],
    ['Unbroken DMG', `x${combat.brokenMultiplier.unbroken}`],
    ['Cycles', `${combat.actionValue.firstCycle} AV, then ${combat.actionValue.cycle} AV`],
  ] as const;

  const counts = data.counts();
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  return {
    characters,
    lightCones,
    enemies,
    breaks,
    rules,
    summary: `${total} validated records across ${Object.keys(counts).length} collections`,
  };
}

export class DataArchiveState implements GameState {
  readonly id = StateIds.archive;
  /** Full-screen page: the title backdrop below is paused instead of rendered underneath. */
  readonly isOverlay = false;
  private screen: DataArchiveScreen | null = null;
  private unmount: (() => void) | null = null;

  constructor(private readonly ctx: AppContext) {}

  enter(): void {
    this.screen = new DataArchiveScreen(buildArchiveViewModel(this.ctx.data), () => this.back());
    this.unmount = this.ctx.ui.mount(this.screen.el);
  }

  exit(): void {
    this.unmount?.();
    this.screen = null;
  }

  update(): void {
    const input = this.ctx.input;
    if (this.ctx.states.busy || !this.screen) return;
    if (input.wasPressed('back')) this.back();
    if (input.wasPressed('tabPrev')) this.screen.cycleTab(-1);
    if (input.wasPressed('tabNext')) this.screen.cycleTab(1);
  }

  private back(): void {
    if (!this.ctx.states.busy) void this.ctx.states.pop();
  }
}
