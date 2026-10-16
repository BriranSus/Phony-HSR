/**
 * Phase-4 world walkthrough (Playwright), driven through the real input path (F, left click, E,
 * Esc) with the `exploration` probe only used to place the player. It exercises, in order:
 *
 *   chest (reward, cannot reopen) -> order puzzle (wrong order resets, unlock, key item) ->
 *   hidden area (discovery + fade-in) -> Space Anchor -> area transition with state kept ->
 *   plate / crate puzzle -> cracked wall -> anchor teleport -> key-gated portal -> enemies:
 *   detection, Technique stun, left click with the right advantage, contact ambush, encounter
 *   battle and return -> exploration percentage rising throughout.
 */
import { battleProbe, battleWalkthrough, fightToEnd } from './battleWalkthrough.mjs';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function worldWalkthrough(page, prefix, shot, fail, probe) {
  const world = () => page.evaluate(() => window.__ASTRAL__.probes.world());
  const teleport = (x, z, yaw, y = 0) => page.evaluate(([a, b, c, d]) => window.__ASTRAL__.probes.explorationTeleport(a, b, c, d), [x, z, yaw, y]);
  const waitFor = async (what, fn, timeout = 8000) => {
    const t0 = Date.now();
    for (;;) {
      const v = await fn();
      if (v) return v;
      if (Date.now() - t0 > timeout) {
        fail(`world: timed out waiting for ${what}`);
        return null;
      }
      await sleep(40);
    }
  };
  const press = (key) => page.keyboard.press(key, { delay: 90 });
  /** Stand next to an object until it is the selected prompt, then press F. */
  const use = async (id, x, z, yaw, y = 0) => {
    await teleport(x, z, yaw, y);
    const ok = await waitFor(`prompt ${id}`, async () => (await probe()).selected === id, 4000);
    if (!ok) return false;
    await press('KeyF');
    await sleep(160);
    return true;
  };
  const objectState = async (id) => (await world()).objects[id]?.state;
  const percent = async () => (await world()).progress.percent;
  const inLog = async (name) => (await world()).log.some((l) => l.startsWith(name));
  const stackTop = () => page.evaluate(() => window.__ASTRAL__.stack().at(-1));
  /** Waits for the encounter's battle, returns its first probe, plays it out and returns to the overworld. */
  const battleFlow = async (expectAdvantage) => {
    const ok = await waitFor('the battle', async () => (await stackTop()) === 'battle' && (await battleProbe(page))?.accepting, 25000);
    if (!ok) return false;
    const b = await battleProbe(page);
    if (b.source !== 'world' || b.advantage !== expectAdvantage) fail(`expected a ${expectAdvantage} world battle, got ${b.source}/${b.advantage}`);
    return b;
  };
  const finishBattle = async () => {
    const end = await fightToEnd(page, fail, { maxMs: 90000 });
    if (end?.outcome !== 'victory') fail(`world battle should be won, got ${end?.outcome}`);
    await sleep(900);
    await press('Enter');
    await waitFor('return to exploration', async () => (await stackTop()) === 'test-scene' && (await world()).overlay === 'none', 25000);
  };

  const start = await world();
  if (start.area !== 'level.test-grounds') fail(`world: expected to start in the Calibration Grounds, got ${start.area}`);
  let last = start.progress.percent;
  const rises = async (label) => {
    const now = await percent();
    if (!(now > last)) fail(`world: exploration percentage should rise after ${label} (${last} -> ${now})`);
    last = now;
  };
  if (!(await page.$('.hud__progress'))) fail('world: the exploration percentage HUD element is missing');

  // 1. Chest: rewards from data, opens once.
  await use('chest.platform', 13, -1.6, Math.PI, 2);
  let w = await world();
  if (w.objects['chest.platform'].state !== 'opened') fail('chest did not open');
  if (w.items.credit !== 1200 || w.items['ancient-part'] !== 3) fail(`chest rewards wrong: ${JSON.stringify(w.items)}`);
  if (!(await page.$('.message.is-visible'))) fail('chest reward message not shown');
  await rises('opening a chest');
  await shot(`${prefix}-10-chest`);
  await press('KeyF');
  await sleep(200);
  w = await world();
  if (w.items.credit !== 1200) fail('chest granted its reward twice');
  if ((await probe()).prompts.includes('chest.platform')) fail('opened chest is still in the prompt list');

  // 2. Order puzzle: wrong order resets, right order unlocks the gate and its chest (key item).
  await use('switch.frost', 13.5, 15.8, Math.PI);
  if (!(await inLog('puzzleFailed'))) fail('pressing the wrong switch first should fail the puzzle');
  if ((await objectState('switch.frost')) !== 'off') fail('a failed puzzle should reset its switches');
  await use('switch.ember', 10.5, 13.8, Math.PI);
  await use('switch.frost', 13.5, 15.8, Math.PI);
  if ((await objectState('gate.puzzle')) !== 'closed') fail('gate opened before the puzzle was solved');
  await use('switch.gale', 16.5, 13.8, Math.PI);
  await waitFor('the gate to open', async () => (await objectState('gate.puzzle')) === 'open');
  w = await world();
  if (w.progress.puzzles.found !== 1) fail('solved puzzle did not count toward exploration');
  await rises('solving the puzzle');
  await shot(`${prefix}-11-puzzle`);
  await use('chest.puzzle', 14, 19.9, 0);
  w = await world();
  if (w.items['quest.camp-pass'] !== 1) fail('the sealed chest should hold the Camp Pass');
  await rises('opening the sealed chest');

  // 3. Hidden area: walk into the veiled alcove; it is discovered and fades in.
  await teleport(-20, -20.5, 0);
  await waitFor('the alcove to be discovered', async () => (await world()).hidden.find((h) => h.id === 'hidden.alcove')?.discovered);
  await sleep(300);
  const mid = (await world()).hidden[0].reveal;
  await waitFor('the alcove veil to fade out', async () => (await world()).hidden[0].reveal >= 1, 8000);
  if (!(mid < 1)) fail(`the veil should fade in over time (reveal was ${mid} after discovery)`);
  if (!(await inLog('hiddenAreaDiscovered'))) fail('no hiddenAreaDiscovered event');
  await shot(`${prefix}-12-hidden`);
  await use('collect.hidden-1', -19.8, -21.8, Math.PI);
  w = await world();
  if (!(w.items['silvermane-badge'] >= 1)) fail('hidden collectible was not granted');
  await rises('collecting a hidden pickup');

  // 4. Space Anchor: activates, opens the travel list; Esc closes it.
  await use('anchor.calibration', -2, 13, Math.PI);
  await page.waitForSelector('.anchors.is-open', { timeout: 3000 }).catch(() => fail('anchor travel list did not open'));
  if ((await objectState('anchor.calibration')) !== 'active') fail('anchor was not activated');
  await rises('activating an anchor');
  await shot(`${prefix}-13-anchors`);
  await press('Escape');
  await waitFor('anchor list to close', async () => (await world()).overlay === 'none');

  // 5. Area transition keeps party and state.
  const leaderBefore = (await probe()).leader;
  await use('portal.to-deck', -20, 16.5, 0);
  await waitFor('the Observation Deck', async () => {
    const x = await world();
    return x.area === 'level.observation-deck' && !x.transitioning;
  }, 15000);
  w = await world();
  if (!(w.items.credit >= 1200) || w.items['quest.camp-pass'] !== 1) fail(`area transition lost the world state: ${JSON.stringify(w.items)}`);
  if (!w.visited.includes('level.test-grounds') || !w.visited.includes('level.observation-deck')) fail('visited areas missing');
  if ((await probe()).leader !== leaderBefore) fail('area transition changed the party leader');
  await page.waitForSelector('.area-banner.is-visible', { timeout: 3000 }).catch(() => fail('area name banner did not show on entry'));
  await sleep(500);
  await shot(`${prefix}-14-deck`);

  // 6. Plate / crate puzzle: three pushes put the crate on one plate, the player holds the other.
  for (const z of [4.7, 2.7, 0.7]) await use('crate.weight', -5, z, Math.PI);
  await waitFor('the west plate', async () => (await objectState('plate.west')) === 'pressed');
  if ((await objectState('gate.vault')) !== 'closed') fail('vault opened with one plate held');
  await teleport(5, -3, 0);
  await waitFor('the vault to open', async () => (await objectState('gate.vault')) === 'open');
  await shot(`${prefix}-15-plates`);
  await use('chest.vault', 0, -7.6, Math.PI);
  w = await world();
  if (!(w.items['silvermane-medal'] >= 1)) fail('vault chest reward missing');

  // 7. Cracked wall (left click) reveals the annex.
  await teleport(8.3, 0, Math.PI / 2);
  const vw = page.viewportSize();
  // Three hits break the wall; a click that lands inside an action cooldown is ignored (slow frames), so keep going.
  for (let n = 0; n < 8; n++) {
    if ((await world()).hidden.find((h) => h.id === 'hidden.annex')?.discovered) break;
    await page.mouse.click(vw.width / 2, vw.height / 2);
    await sleep(n < 3 ? 650 : 900);
  }
  await waitFor('the annex to be discovered', async () => (await world()).hidden.find((h) => h.id === 'hidden.annex')?.discovered);
  await use('anchor.deck', 7, 4.7, Math.PI);

  // 8. Anchor teleport: pick the Calibration Grounds anchor from the list.
  await page.waitForSelector('.anchors.is-open', { timeout: 3000 }).catch(() => fail('anchor list did not open at the deck anchor'));
  const rows = await page.$$('.anchors__row');
  if (rows.length !== 2) fail(`expected 2 activated anchors, got ${rows.length}`);
  await press('KeyW');
  await press('KeyF');
  await waitFor('anchor travel to the Calibration Grounds', async () => {
    const x = await world();
    return x.area === 'level.test-grounds' && !x.transitioning;
  }, 15000);
  const arrived = await probe();
  if (Math.hypot(arrived.x + 2, arrived.z - 12.4) > 1.5) fail(`anchor travel arrived at ${arrived.x.toFixed(1)}, ${arrived.z.toFixed(1)}`);

  // 9. The Camp Pass opens the portal to the Snowfield (region Jarilo-VI).
  await use('portal.to-snowfield', 20, -16.6, 0);
  await waitFor('the Snowfield Camp', async () => {
    const x = await world();
    return x.area === 'level.snowfield-camp' && !x.transitioning;
  }, 15000);
  w = await world();
  if (w.region !== 'region.jarilo-vi') fail(`expected region.jarilo-vi, got ${w.region}`);
  if (w.enemies.length !== 3) fail(`expected 3 overworld enemy groups, got ${w.enemies.length}`);
  await sleep(500);
  await shot(`${prefix}-16-snowfield`);

  // 10a. Contact from behind: the idle Frostspawn notices the player (detected), catches them
  // facing away and an ambush battle starts (enemies act first).
  await teleport(10, -16.5, Math.PI);
  await waitFor('the Frostspawn to notice the player', async () => (await world()).enemies.find((e) => e.spawnId === 'spawn.frost')?.state !== 'idle');
  if (!(await inLog('enemyDetected'))) fail('no enemyDetected event');
  const amb = await battleFlow('ambush');
  if (!amb) return;
  if (amb.turnOrder[0] === 'Dan Heng') fail('an ambush should let the enemies act first');
  await sleep(500);
  await shot(`${prefix}-17-encounter`);
  await finishBattle();
  w = await world();
  if (w.enemies.some((e) => e.spawnId === 'spawn.frost')) fail('defeated enemy is still in the world');
  if (!(await inLog('enemyDefeated'))) fail('no enemyDefeated event');

  // 10b. Technique stun + left click = player strike; Basic / Skill / Ultimate / Break / victory.
  await battleWalkthrough(page, prefix, shot, fail, probe);

  // 10c. Attacking an enemy that already noticed the player is a neutral battle.
  const patrol = (await world()).enemies.find((x) => x.spawnId === 'spawn.patrol');
  if (patrol) {
    // Stand 2 m in front of the patrol (the way it faces), looking at it: it notices a visible player.
    await teleport(patrol.x + Math.sin(patrol.yaw) * 2, patrol.z + Math.cos(patrol.yaw) * 2, patrol.yaw + Math.PI);
    await waitFor('the patrol to notice the player', async () => {
      const e = (await world()).enemies.find((x) => x.spawnId === 'spawn.patrol');
      return !e || e.state === 'alert' || e.state === 'chase' || (await stackTop()) === 'battle';
    });
    if ((await stackTop()) !== 'battle') await page.mouse.click(vw.width / 2, vw.height / 2);
    const neutral = await battleFlow('neutral');
    if (neutral) await finishBattle();
  } else fail('the patrol group is missing');

  // The percentage rose all the way: chests, puzzles, anchors and pickups are all counted.
  const total = (await world()).worldProgress;
  if (!(total > 0)) fail('world exploration percentage is 0 after the walkthrough');
  console.log(`  [${prefix}] world: ${last}% of the Calibration Grounds, ${total}% of the world, items ${JSON.stringify((await world()).items)}`);
}
