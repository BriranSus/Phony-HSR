/**
 * Phase-5 battle walkthroughs (Playwright, real keys and mouse):
 *
 *  - `fightToEnd`: a small auto-player (Ultimate when ready, Skill / Basic otherwise) used by every
 *    walkthrough that needs a battle to finish;
 *  - `battleWalkthrough`: an overworld encounter becomes a battle with the right advantage; Basic
 *    ATK, Skill (Skill Points), target cycling, an Ultimate (letterbox and shake), a Weakness
 *    Break, the victory screen, and the return to the overworld with the rewards applied;
 *  - `sandboxWalkthrough`: the Battle Sandbox from the main menu with Cocolia, ending in the
 *    defeat screen.
 */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export const battleProbe = (page) => page.evaluate(() => window.__ASTRAL__.probes.battle?.() ?? null);

async function waitFor(page, fail, what, fn, timeout = 20000) {
  const t0 = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() - t0 > timeout) {
      fail(`battle: timed out waiting for ${what}`);
      return null;
    }
    await sleep(40);
  }
}

/** Plays a battle to the end with a simple policy. `onTick(probe)` runs on every poll. */
export async function fightToEnd(page, fail, { maxMs = 120000, useUltimates = true, keys = ['KeyQ', 'KeyE'], onTick } = {}) {
  const t0 = Date.now();
  let flip = 0;
  for (;;) {
    const p = await battleProbe(page);
    if (!p) {
      fail('battle: the battle probe disappeared');
      return null;
    }
    if (onTick) await onTick(p);
    if (p.outcome !== 'ongoing') return p;
    if (Date.now() - t0 > maxMs) {
      fail(`battle: did not finish within ${maxMs / 1000}s (turn ${p.turns})`);
      return p;
    }
    if (p.accepting) {
      const allies = p.units.filter((u) => u.side === 'ally');
      const ready = useUltimates ? allies.findIndex((u) => u.presence === 'active' && u.energy !== null && u.energy >= u.maxEnergy) : -1;
      if (ready >= 0) await page.keyboard.press(`Digit${ready + 1}`, { delay: 60 });
      else {
        flip++;
        const key = keys.length === 1 || p.sp < 1 ? keys[0] : keys[flip % 2];
        await page.keyboard.press(key, { delay: 60 });
      }
      await sleep(180);
    } else await sleep(120);
  }
}

const stackTop = (page) => page.evaluate(() => window.__ASTRAL__.stack().at(-1));

/** An overworld encounter becomes a battle; exercises the controls and returns to the overworld. */
export async function battleWalkthrough(page, prefix, shot, fail, probe) {
  const world = () => page.evaluate(() => window.__ASTRAL__.probes.world());
  const teleport = (x, z, yaw) => page.evaluate(([a, b, c]) => window.__ASTRAL__.probes.explorationTeleport(a, b, c), [x, z, yaw]);
  const vw = page.viewportSize();
  const before = await world();
  if (before.area !== 'level.snowfield-camp') fail(`battle: expected the Snowfield Camp, got ${before.area}`);
  const creditBefore = before.items.credit ?? 0;

  // The beetle group notices the player from afar; close in to 4 m, stun it with the Technique
  // (E) and strike it with a left click.
  await teleport(-10, -18, 0);
  const noticed = await waitFor(page, fail, 'the beetle group to notice the player', async () => {
    const e = (await world()).enemies.find((x) => x.spawnId === 'spawn.beetle');
    return e && (e.state === 'alert' || e.state === 'chase') ? e : null;
  }, 15000);
  if (!noticed) return;
  await teleport(noticed.x, noticed.z - 4, 0);
  await page.keyboard.press('KeyE', { delay: 90 });
  const castAt = Date.now();
  await waitFor(page, fail, 'the beetle group to be stunned', async () => (await world()).enemies.find((x) => x.spawnId === 'spawn.beetle')?.state === 'stunned', 8000);
  const stunned = (await world()).enemies.find((x) => x.spawnId === 'spawn.beetle');
  await teleport(stunned.x, stunned.z - 1.6, 0);
  // The Technique and the attack share a 0.45 s action cooldown; the stun lasts 4 s, so click as soon as it is over.
  await sleep(Math.max(0, 560 - (Date.now() - castAt)));
  await page.mouse.click(vw.width / 2, vw.height / 2);
  await waitFor(page, fail, 'the battle to start', async () => (await stackTop(page)) === 'battle' && (await battleProbe(page))?.accepting, 25000);
  let b = await battleProbe(page);
  if (!b) return;
  if (b.source !== 'world') fail(`battle: expected a world battle, got ${b.source}`);
  if (b.advantage !== 'playerStrike') fail(`battle: attacking a stunned group should be a player strike, got ${b.advantage}`);
  if (b.units.filter((u) => u.side === 'enemy').length !== 2) fail('battle: the beetle group should be an Automaton Beetle and a Frostspawn');
  for (const [sel, n] of [['.battle .turnbar li', 4], ['.battle .pcard', 4], ['.battle .eplate', 2], ['.battle .sp__pip', 5]]) {
    if ((await page.$$(sel)).length < n) fail(`battle: HUD is missing ${sel} (wanted ${n})`);
  }
  await sleep(600);
  await shot(`${prefix}-18-battle`);

  // Basic ATK: +1 Skill Point. The next ally's Skill: -1.
  const sp0 = b.sp;
  await page.keyboard.press('KeyQ', { delay: 60 });
  await waitFor(page, fail, 'the next turn after Basic ATK', async () => {
    const p = await battleProbe(page);
    return p?.accepting && p.turns > b.turns;
  });
  b = await battleProbe(page);
  if (b.sp !== Math.min(5, sp0 + 1)) fail(`battle: Basic ATK should add a Skill Point (${sp0} -> ${b.sp})`);
  // Target cycling: A / D move the highlight (with two enemies the selection changes).
  await waitFor(page, fail, 'the player to be asked again', async () => (await battleProbe(page))?.accepting);
  b = await battleProbe(page);
  const sel0 = b.selectedEnemy;
  await page.keyboard.press('KeyD', { delay: 60 });
  await sleep(150);
  const sel1 = (await battleProbe(page)).selectedEnemy;
  if (b.units.filter((u) => u.side === 'enemy' && u.presence === 'active').length > 1 && sel0 === sel1) fail('battle: D should cycle the highlighted enemy');
  if (!(await page.$('.battle .eplate.is-selected'))) fail('battle: the selected enemy is not highlighted');
  const spBefore = b.sp;
  const turnsBefore = b.turns;
  await page.keyboard.press('KeyE', { delay: 60 });
  await waitFor(page, fail, 'the next turn after Skill', async () => {
    const p = await battleProbe(page);
    return p && (p.outcome !== 'ongoing' || (p.accepting && p.turns > turnsBefore));
  });
  b = await battleProbe(page);
  if (b.outcome === 'ongoing' && b.sp !== spBefore - 1) fail(`battle: a Skill should cost a Skill Point (${spBefore} -> ${b.sp})`);

  // Fight on, capturing the Weakness Break and the Ultimate (letterbox and shake) as they happen.
  let brokeShot = false;
  let ultShot = false;
  let sawLetterbox = false;
  let sawTrauma = false;
  const end = await fightToEnd(page, fail, {
    maxMs: 90000,
    onTick: async (p) => {
      if (!brokeShot && p.log.some((l) => l.includes('Weakness Broken'))) {
        brokeShot = true;
        await sleep(150);
        await shot(`${prefix}-20-battle-break`);
      }
      if (p.letterbox > 0.5) sawLetterbox = true;
      if (p.trauma > 0.05) sawTrauma = true;
      if (!ultShot && p.letterbox > 0.8 && p.cameraMode === 'ultimate') {
        ultShot = true;
        await shot(`${prefix}-19-battle-ultimate`);
      }
    },
  });
  if (!end) return;
  if (!brokeShot) fail('battle: no Weakness Break was seen');
  if (!sawLetterbox || !sawTrauma) fail(`battle: the Ultimate should letterbox and shake the camera (letterbox ${sawLetterbox}, shake ${sawTrauma})`);
  if (!ultShot) fail('battle: no Ultimate frame was captured');
  if (end.outcome !== 'victory') fail(`battle: expected a victory, got ${end.outcome}`);
  await page.waitForSelector('.battle__result.is-open[data-outcome="victory"]', { timeout: 10000 }).catch(() => fail('battle: the victory screen did not open'));
  await sleep(500);
  if ((await page.$$('.battle__result .result__rewards li')).length < 1) fail('battle: the victory screen lists no rewards');
  await shot(`${prefix}-21-battle-victory`);
  const fin = await battleProbe(page);

  // Back to the overworld: the group is gone and the rewards are in the world's item ledger.
  await page.keyboard.press('Enter', { delay: 60 });
  await waitFor(page, fail, 'the return to the overworld', async () => (await stackTop(page)) === 'test-scene' && (await world()).overlay === 'none', 25000);
  const after = await world();
  if (after.enemies.some((e) => e.spawnId === 'spawn.beetle')) fail('battle: the defeated group is still in the world');
  if (!((after.items.credit ?? 0) > creditBefore)) fail(`battle: rewards were not applied (credit ${creditBefore} -> ${after.items.credit})`);
  if (!after.log.some((l) => l.startsWith('enemyDefeated'))) fail('battle: no enemyDefeated event');
  if (!after.log.some((l) => l.startsWith('encounterEnded') && l.includes('victory'))) fail('battle: encounterEnded should report the victory');
  await probe();
  console.log(`  [${prefix}] battle: ${end.turns} turns / ${end.cycle} cycles, rewards ${JSON.stringify(fin?.result?.rewards)}`);
}

/** The Battle Sandbox from the main menu: Cocolia against a Lv1 party ends in the defeat screen. */
export async function sandboxWalkthrough(page, prefix, shot, fail) {
  const stackIs = (ids) => page.waitForFunction((expected) => window.__ASTRAL__?.stack().join('>') === expected, ids.join('>'), { timeout: 30000, polling: 100 }).catch(async () => { throw new Error('stack is ' + (await page.evaluate(() => window.__ASTRAL__.stack().join('>'))) + ' wanted ' + ids.join('>')); });
  await page.click('[data-id="battle-sandbox"]');
  await stackIs(['title', 'main-menu', 'battle-sandbox']);
  await sleep(600);
  for (let i = 0; i < 4; i++) if (!(await page.$(`[data-id="party-${i}"]`))) fail(`sandbox: party slot ${i} is missing`);
  await shot(`${prefix}-sandbox`);
  await page.click('[data-id="preset-cocolia"]');
  for (let i = 0; i < 4; i++) await page.fill(`[data-id="party-level-${i}"]`, '1');
  await page.fill('[data-id="seed"]', 'e2e-cocolia');
  await page.click('.sandbox [data-id="start"]');
  await stackIs(['title', 'main-menu', 'battle-sandbox', 'battle']);
  await waitFor(page, fail, 'the sandbox battle to start', async () => (await battleProbe(page))?.accepting, 25000);
  const b = await battleProbe(page);
  if (!b.units.some((u) => u.side === 'enemy' && u.name.startsWith('Cocolia'))) fail('sandbox: Cocolia is not in the battle');
  if (b.source !== 'sandbox') fail('sandbox: wrong battle source');
  if (!(await page.$('.battle .eplate.is-boss'))) fail('sandbox: the boss plate is missing');
  await sleep(500);
  await shot(`${prefix}-sandbox-cocolia`);
  // Basic ATKs only: a Lv1 party cannot survive Cocolia.
  const end = await fightToEnd(page, fail, { maxMs: 90000, useUltimates: false, keys: ['KeyQ'] });
  if (!end) return;
  if (end.outcome !== 'defeat') fail(`sandbox: expected a defeat, got ${end.outcome}`);
  await page.waitForSelector('.battle__result.is-open[data-outcome="defeat"]', { timeout: 10000 }).catch(() => fail('sandbox: the defeat screen did not open'));
  await sleep(500);
  if (!(await page.$('.battle__result [data-id="retry"]'))) fail('sandbox: the defeat screen should offer Retry');
  await shot(`${prefix}-22-battle-defeat`);
  await page.keyboard.press('Enter', { delay: 60 });
  await stackIs(['title', 'main-menu', 'battle-sandbox']);
  await sleep(500);
  const last = await page.textContent('[data-id="last-result"]');
  if (!last?.includes('defeat')) fail(`sandbox: the sandbox should report the defeat, got "${last}"`);
  await page.click('.sandbox [data-id="back"]');
  await stackIs(['title', 'main-menu']);
  console.log(`  [${prefix}] sandbox: Cocolia battle ended in a defeat (${end.turns} turns), result screen and return verified`);
}
