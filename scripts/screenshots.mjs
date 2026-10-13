/**
 * End-to-end smoke test + screenshot capture.
 *
 *   npm run screenshots            (builds, serves dist/ with `vite preview`, drives Chromium)
 *   npm run screenshots -- --dev   (uses the dev server instead of a production build)
 *   npm run screenshots -- --swiftshader   (force software WebGL)
 *
 * The hardware GPU is used through ANGLE when available; otherwise it falls back to SwiftShader.
 *
 * Walks the full Phase-1 boot flow: loading -> title -> main menu -> data archive -> test scene
 * (with simulated input) -> back to the menu. Fails on any console error or page error.
 * Screenshots are written to docs/screenshots/.
 */
import { build, createServer, preview } from 'vite';
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, 'docs', 'screenshots');
const useDev = process.argv.includes('--dev');
const forceSoftware = process.argv.includes('--swiftshader');
const GPU_ARGS = {
  hardware: ['--use-angle=' + (process.platform === 'win32' ? 'd3d11' : 'default'), '--enable-gpu', '--ignore-gpu-blocklist'],
  software: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
};

/** Launch Chromium with hardware WebGL if it works, else SwiftShader. */
async function launchBrowser() {
  for (const mode of forceSoftware ? ['software'] : ['hardware', 'software']) {
    const browser = await chromium.launch({ args: GPU_ARGS[mode] });
    const page = await browser.newPage();
    const renderer = await page.evaluate(() => {
      const gl = document.createElement('canvas').getContext('webgl2') ?? document.createElement('canvas').getContext('webgl');
      if (!gl) return null;
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      return String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
    });
    await page.close();
    if (renderer) {
      console.log(`WebGL renderer (${mode}): ${renderer}`);
      return browser;
    }
    await browser.close();
  }
  throw new Error('No WebGL backend available in headless Chromium');
}
const WIDTH = 1600;
const HEIGHT = 900;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Extra layout passes: desktop 16:9 small, 4:3, and a phone in portrait. */
const VIEWPORTS = [
  { name: '1280x720', width: 1280, height: 720 },
  { name: '1024x768', width: 1024, height: 768 },
  { name: '390x844', width: 390, height: 844 },
];

const shot0 = (shots) => async (page, name) => {
  const file = path.join(outDir, `${name}.png`);
  await page.screenshot({ path: file });
  shots.push(file);
  console.log(`  captured ${name}.png`);
};

/**
 * Layout checks that catch the classic responsive failures: horizontal page overflow, and elements
 * of a screen that overlap each other (pairs of selectors whose boxes must not intersect).
 */
async function layoutProblems(page, label, pairs) {
  return page.evaluate(
    ({ label, pairs }) => {
      const out = [];
      const doc = document.documentElement;
      if (doc.scrollWidth > window.innerWidth + 1) out.push(`${label}: page overflows horizontally (${doc.scrollWidth} > ${window.innerWidth})`);
      for (const el of document.querySelectorAll('.screen')) {
        if (el.scrollLeft > 0 || el.scrollWidth > el.clientWidth + 1) out.push(`${label}: screen "${el.dataset.screen}" is wider than the viewport (${el.scrollWidth} > ${el.clientWidth})`);
      }
      for (const el of document.querySelectorAll('.archive__body, .menu__panel, .menu__list')) {
        if (el.scrollWidth > el.clientWidth + 1 && getComputedStyle(el).overflowX !== 'auto') out.push(`${label}: ${el.className} overflows sideways (${el.scrollWidth} > ${el.clientWidth})`);
      }
      const box = (sel) => {
        const els = [...document.querySelectorAll(sel)].filter((e) => {
          if (!e.checkVisibility({ opacityProperty: true, visibilityProperty: true })) return false;
          // Treat near-transparent ancestors (covered screens fading out) as invisible too.
          for (let n = e; n; n = n.parentElement) if (Number(getComputedStyle(n).opacity) < 0.05) return false;
          return true;
        });
        return els.map((e) => e.getBoundingClientRect());
      };
      for (const [a, b] of pairs) {
        for (const ra of box(a)) for (const rb of box(b)) {
          const ix = Math.min(ra.right, rb.right) - Math.max(ra.left, rb.left);
          const iy = Math.min(ra.bottom, rb.bottom) - Math.max(ra.top, rb.top);
          if (ix > 1 && iy > 1) out.push(`${label}: "${a}" overlaps "${b}"`);
        }
      }
      for (const sel of ['.menu-item', '.menu__footer', '.archive__tabs', '.hud__area', '.hud__hints', '.hud__back', '.party', '.gait']) {
        for (const r of box(sel)) if (r.bottom > window.innerHeight + 1 || r.right > window.innerWidth + 1) out.push(`${label}: ${sel} is cut off by the viewport`);
      }
      return out;
    },
    { label, pairs },
  );
}

/**
 * Phase-2 exploration walkthrough: approach the sign (prompt list + F), run, sprint, switch
 * characters, fire the Technique / attack hooks; asserts the controller state through the
 * `window.__ASTRAL__.probes.exploration` probe and the hook events on the bus.
 */
async function exploreWalkthrough(page, prefix, shot, errors, check, pairs, full = true) {
  const probe = () => page.evaluate(() => window.__ASTRAL__.probes.exploration());
  const fail = (m) => errors.push(`[${prefix}] ${m}`);
  await page.evaluate(() => {
    const w = window;
    w.__hooks = { footstep: 0, technique: 0, overworldAttack: 0, leaderChanged: 0, interact: 0 };
    for (const k of Object.keys(w.__hooks)) w.__ASTRAL__.ctx.bus.on(`player:${k}`, () => w.__hooks[k]++);
  });
  const spawn = await probe();
  await shot(`${prefix}-01-spawn`);

  // Approach the notice sign: a short run forward brings it into the prompt radius.
  // Hold W until the sign enters the prompt radius (bounded), then stop.
  await page.keyboard.down('KeyW');
  for (let t = 0; t < 40; t++) {
    await sleep(50);
    if ((await probe()).prompts.includes('sign.welcome')) break;
  }
  await page.keyboard.up('KeyW');
  await sleep(500);
  let p = await probe();
  if (!p.prompts.includes('sign.welcome')) fail(`expected the sign prompt, got [${p.prompts}] at ${p.x.toFixed(2)},${p.z.toFixed(2)}`);
  const row = await page.$('.prompt.is-selected[data-prompt="sign.welcome"]');
  if (!row) fail('the sign prompt row is not shown / selected');
  await check('exploration prompt', pairs);
  await shot(`${prefix}-02-prompt`);
  await page.keyboard.press('KeyF');
  await page.waitForSelector('.message.is-visible', { timeout: 3000 }).catch(() => fail('interaction message did not open'));
  await sleep(300);
  await shot(`${prefix}-03-interact`);

  // Run (default gait) then sprint (Shift held).
  await page.keyboard.down('KeyW');
  await sleep(1000);
  p = await probe();
  if (p.state !== 'run' || Math.abs(p.speed - 5) > 0.2) fail(`expected run at 5 m/s, got ${p.state} ${p.speed.toFixed(2)}`);
  if (!(p.z < spawn.z - 2)) fail('the character did not move forward');
  await page.keyboard.up('KeyW');
  await shot(`${prefix}-04-run`);
  // Sprint from the spawn so slow captures cannot run the character into the north wall.
  await page.evaluate(() => window.__ASTRAL__.probes.explorationTeleport(0, 6, Math.PI));
  await sleep(200);
  await page.keyboard.down('KeyW');
  await page.keyboard.down('ShiftLeft');
  await sleep(700);
  p = await probe();
  if (p.state !== 'sprint' || Math.abs(p.speed - 7.5) > 0.3) fail(`expected sprint at 7.5 m/s, got ${p.state} ${p.speed.toFixed(2)} at ${p.x.toFixed(2)},${p.z.toFixed(2)} gated=${p.camera.gated} held=${await page.evaluate(() => window.__ASTRAL__.ctx.input.activeActions().join("+"))}`);
  await shot(`${prefix}-05-sprint`);
  await page.keyboard.up('ShiftLeft');
  await page.keyboard.up('KeyW');
  await sleep(500);

  // Switch to party slot 3 (position kept), then use the Technique and the overworld attack.
  const before = await probe();
  await page.keyboard.press('Digit3');
  await sleep(250);
  p = await probe();
  if (p.leader !== 'char.himeko') fail(`expected Himeko after pressing 3, got ${p.leader}`);
  if (Math.hypot(p.x - before.x, p.z - before.z) > 0.3) fail('switching moved the character');
  if (!(await page.$('.party__slot.is-active[data-slot="3"]'))) fail('party slot 3 is not highlighted');
  await shot(`${prefix}-06-switch`);
  await page.keyboard.press('KeyE');
  await sleep(600);
  // Overworld attack is left click only (as on PC); Q does nothing in the overworld.
  await page.keyboard.press('KeyQ');
  await sleep(300);
  if ((await page.evaluate(() => window.__hooks.overworldAttack)) !== 0) fail('Q must not trigger the overworld attack');
  const vw = page.viewportSize();
  await page.mouse.click(vw.width / 2, vw.height / 2);
  await sleep(300);
  const hooks = await page.evaluate(() => window.__hooks);
  for (const k of ['footstep', 'technique', 'overworldAttack', 'leaderChanged', 'interact']) if (!hooks[k]) fail(`no player:${k} event`);
  if (hooks.overworldAttack !== 1) fail(`left click should attack once, got ${hooks.overworldAttack}`);
  console.log(`  [${prefix}] hooks: ${JSON.stringify(hooks)}`);

  await cameraWalkthrough(page, prefix, shot, fail, probe, full);
}

/**
 * Phase-3 camera checks: the player stays visible while running along the perimeter wall and in a
 * corner with the camera forced toward the wall (projected on screen and not occluded by level
 * geometry); rotate / zoom / recenter; then the Camera Gallery shots and input gating.
 */
/** `full` adds the 360-degree wall/corner spin sweep (run once, at the primary viewport). */
async function cameraWalkthrough(page, prefix, shot, fail, probe, full = true) {
  const teleport = (x, z, yaw) => page.evaluate(([a, b, c]) => window.__ASTRAL__.probes.explorationTeleport(a, b, c), [x, z, yaw]);
  const visible = async (label) => {
    const p = await probe();
    const c = p.camera;
    const outside = Math.abs(c.position[0]) >= 23.4 || Math.abs(c.position[2]) >= 23.4;
    if (!c.playerOnScreen || c.playerOccluded || outside) fail(`${label}: player hidden (onScreen=${c.playerOnScreen} occluded=${c.playerOccluded} cam=${c.position.map((v) => v.toFixed(2))})`);
    return p;
  };

  // Wait until rendered frames have caught up with a teleport (the camera is back near the player),
  // so a stalled headless frame is never sampled as a stale pose.
  const settle = () =>
    page
      .waitForFunction(() => {
        const p = window.__ASTRAL__.probes.exploration();
        return Math.hypot(p.camera.position[0] - p.x, p.camera.position[2] - p.z) < 10;
      }, null, { timeout: 10000, polling: 50 })
      .catch(() => fail("camera did not settle after teleport"));

  // East wall, camera yaw pointing the camera into the wall (camera wants to sit on the +X side).
  await teleport(22.6, 16, -Math.PI / 2);
  await settle();
  await sleep(300);
  await visible('east wall start');
  await shot(`${prefix}-07-wall`);
  await page.keyboard.down('KeyD');
  for (let t = 0; t < 12; t++) {
    await sleep(200);
    await visible(`east wall run ${t}`);
  }
  await page.keyboard.up('KeyD');
  // North-east corner, camera pushed into the corner.
  await teleport(22.6, -22.6, -Math.PI * 0.75);
  await settle();
  await sleep(400);
  await visible('north-east corner');
  await shot(`${prefix}-08-corner`);
  await page.keyboard.down('KeyW');
  await page.keyboard.down('KeyA');
  for (let t = 0; t < 6; t++) {
    await sleep(200);
    await visible(`corner run ${t}`);
  }
  await page.keyboard.up('KeyA');
  await page.keyboard.up('KeyW');

  // Hug every wall and corner (plus the validator's failing samples) and spin 360 degrees with Z,
  // checking visibility on every sample.
  const spinSpots = [
    ['east wall', 23.05, 0], ['west wall', -23.05, 0], ['north wall', 0, -23.05], ['south wall', 0, 23.05],
    ['NE corner', 23.05, -23.05], ['NW corner', -23.05, -23.05], ['SE corner', 23.05, 23.05], ['SW corner', -23.05, 23.05],
    ['regression (23.05, 17.79)', 23.05, 17.79], ['regression (23.05, 1.59)', 23.05, 1.59], ['regression (-23.03, -12.95)', -23.03, -12.95],
    ['regression (-22.95, 1.21)', -22.95, 1.21], ['regression ramp (-19.14, 6.41)', -19.14, 6.41],
  ];
  let spinSamples = 0;
  for (const [label, x, z] of full ? spinSpots : []) {
    await teleport(x, z, 0);
    await settle();
    await sleep(250);
    let last = (await probe()).camera.yaw;
    let turned = 0;
    let lastPos = "";
    await page.keyboard.down('KeyZ');
    for (let k = 0; k < 80 && turned < Math.PI * 2; k++) {
      await sleep(80);
      // Only judge new frames: an unchanged pose means the page has not rendered since the last sample.
      const peek = (await probe()).camera.position.join();
      if (peek === lastPos) continue;
      lastPos = peek;
      const p = await visible(`${label} spin ${(turned * 57.3).toFixed(0)}deg`);
      if (p.camera.distance < 0.75) fail(`${label}: camera collapsed to ${p.camera.distance.toFixed(2)} m`);
      turned += Math.abs(Math.atan2(Math.sin(p.camera.yaw - last), Math.cos(p.camera.yaw - last)));
      last = p.camera.yaw;
      spinSamples++;
    }
    await page.keyboard.up('KeyZ');
    if (turned < Math.PI * 2 - 0.2) fail(`${label}: spin only covered ${(turned * 57.3).toFixed(0)} deg`);
  }
  console.log(`  wall/corner spins: ${spinSpots.length} spots, ${spinSamples} samples`);
  await teleport(23.05, 17.79, -Math.PI / 2);
  await sleep(400);
  await shot(`${prefix}-07b-wall-hug`);
  // West landing at full zoom (regression: occluded at distance 9).
  await teleport(-4.9, -7.25, Math.PI * 0.8);
  const vw0 = page.viewportSize();
  await page.mouse.move(vw0.width / 2, vw0.height / 2);
  for (let k = 0; k < 6; k++) await page.mouse.wheel(0, 600);
  for (let k = 0; k < 10; k++) {
    await sleep(150);
    await visible(`west landing full zoom ${k}`);
  }
  await shot(`${prefix}-08b-landing-zoom`);
  for (let k = 0; k < 6; k++) await page.mouse.wheel(0, -600);

  // Rotate (Z), zoom (wheel), recenter (X).
  await teleport(0, 6, Math.PI);
  await sleep(300);
  const before = (await probe()).camera;
  await page.keyboard.down('KeyZ');
  await sleep(500);
  await page.keyboard.up('KeyZ');
  const vw = page.viewportSize();
  await page.mouse.move(vw.width / 2, vw.height / 2);
  await page.mouse.wheel(0, 400);
  await sleep(600);
  let cam = (await probe()).camera;
  if (Math.abs(cam.yaw - before.yaw) < 0.5) fail(`Z should rotate the camera (yaw ${before.yaw.toFixed(2)} -> ${cam.yaw.toFixed(2)})`);
  if (!(cam.zoom > before.zoom)) fail('the wheel should zoom out');
  await shot(`${prefix}-09-rotate-zoom`);
  await page.keyboard.press('KeyX');
  await sleep(1200);
  let p = await probe();
  if (Math.abs(Math.atan2(Math.sin(p.camera.yaw - p.yaw), Math.cos(p.camera.yaw - p.yaw))) > 0.05) fail(`X should recenter behind the player (cam ${p.camera.yaw.toFixed(2)} vs player ${p.yaw.toFixed(2)})`);

  // Camera Gallery: every mode, with input gating.
  await page.keyboard.press('F4', { delay: 90 });
  await page.waitForSelector('.gallery.is-open', { timeout: 3000 }).catch(() => fail('gallery did not open'));
  const captures = [
    ['shot.combat-overview', 'combat', 2.0],
    ['shot.skill-close-up', 'skill', 1.2],
    ['shot.ultimate', 'ultimate', 1.05],
    ['shot.boss-intro', 'boss', 2.5],
    ['shot.dialogue-two-shot', 'dialogue', 2.0],
    ['shot.cinematic-flyover', 'cinematic', 4.5],
  ];
  for (const [n, [id, mode, at]] of captures.entries()) {
    const start = (await probe()).x;
    await page.keyboard.press(`Digit${n + 1}`, { delay: 90 });
    await page.keyboard.down('KeyW');
    // Wait on the shot's own clock (frames can be slower than wall time in headless capture).
    for (let w = 0; w < 200; w++) {
      p = await probe();
      if ((p.camera.shotTime ?? 0) >= at) break;
      await sleep(50);
    }
    await page.keyboard.up('KeyW');
    if (p.camera.playing !== id || p.camera.mode !== mode) fail(`gallery ${id}: mode ${p.camera.mode}, playing ${p.camera.playing}`);
    if (!p.camera.gated || Math.abs(p.x - start) > 0.01) fail(`gallery ${id}: player input not gated`);
    if (id === 'shot.ultimate' && !(p.camera.trauma > 0 && p.camera.letterbox > 0.5)) fail(`ultimate: expected shake + letterbox (trauma ${p.camera.trauma})`);
    if (!(await page.$('.gallery.is-open.is-playing'))) fail(`gallery ${id}: panel should hide while the shot plays`);
    if (id === 'shot.ultimate' || id === 'shot.boss-intro') {
      // Sample the shake over the following second: trauma and roll must both be observable.
      for (let k = 0; k < 6; k++) {
        await sleep(150);
        p = await probe();
      }
      if (!(p.camera.shakePeak > 0.5 && p.camera.rollPeak > 0.002)) fail(`${id}: shake not observable (peak trauma ${p.camera.shakePeak}, roll ${p.camera.rollPeak})`);
      else console.log(`  ${id}: peak trauma ${p.camera.shakePeak.toFixed(2)}, peak roll ${p.camera.rollPeak.toFixed(4)} rad`);
    }
    await shot(`${prefix}-gallery-${n + 1}-${mode}`);
  }
  await page.keyboard.press('Escape');
  await sleep(900);
  p = await probe();
  if (p.camera.gallery || p.camera.mode !== 'exploration' || p.camera.gated) fail('closing the gallery should return to exploration');
}

async function captureViewport(browser, url, vp, shot, errors) {
  const page = await browser.newPage({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: 1 });
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(`[${vp.name}] console: ${msg.text()}`);
  });
  page.on('pageerror', (err) => errors.push(`[${vp.name}] pageerror: ${err.message}`));
  const stackIs = (ids) => page.waitForFunction((expected) => window.__ASTRAL__?.stack().join('>') === expected, ids.join('>'), { timeout: 30000, polling: 100 });
  const settled = () =>
    page.waitForFunction(
      () =>
        !document.querySelector('.transition.is-active') &&
        document.getAnimations().every((a) => {
          const t = a.effect?.getComputedTiming();
          return a.playState !== 'running' || !t || t.iterations === Infinity;
        }),
      null,
      { timeout: 30000, polling: 100 },
    );
  const check = async (label, pairs) => errors.push(...(await layoutProblems(page, `[${vp.name}] ${label}`, pairs)));

  await page.goto(`${url}?cfg.ui.minLoadingMs=0`);
  await stackIs(['title']);
  await settled();
  await sleep(1500);
  await page.keyboard.press('Enter');
  await stackIs(['title', 'main-menu']);
  await settled();
  await sleep(300);
  await check('main menu', [
    ['.menu-item', '.menu__footer'],
    ['.menu__panel', '.title__wordmark'],
    ['.menu__panel', '.title__footer'],
    ['.menu-item', '.title__footer'],
    ['.title__footer > div:first-child', '.title__footer > div:last-child'],
    ['.menu__panel', '.title__side'],
  ]);
  await shot(page, `vp-${vp.name}-main-menu`);

  await page.click('[data-id="archive"]');
  await stackIs(['title', 'main-menu', 'data-archive']);
  await settled();
  await sleep(300);
  await check('archive characters', [['.archive__tabs', '.archive__body']]);
  await shot(page, `vp-${vp.name}-archive`);
  await page.click('[data-tab="rules"]');
  await settled();
  await sleep(300);
  await check('archive rules', [['.archive__tabs', '.archive__body']]);
  await shot(page, `vp-${vp.name}-archive-rules`);
  await page.keyboard.press('Escape');
  await stackIs(['title', 'main-menu']);

  await page.click('[data-id="test-scene"]');
  await stackIs(['test-scene']);
  await settled();
  await sleep(1200);
  const explorePairs = [
    ['.hud__area', '.party'],
    ['.hud__back', '.party'],
    ['.party', '.prompts.is-open'],
    ['.hud__hints', '.gait'],
    ['.prompts.is-open', '.hud__hints'],
  ];
  if (vp.width >= 1200) {
    await exploreWalkthrough(page, `vp-${vp.name}-explore`, (n) => shot(page, n), errors, check, explorePairs, false);
  } else {
    await check('exploration', explorePairs);
    await shot(page, `vp-${vp.name}-explore`);
  }
  await page.close();
}

async function startServer() {
  if (useDev) {
    const server = await createServer({ root, logLevel: 'warn', server: { port: 5199, strictPort: false } });
    await server.listen();
    return { url: server.resolvedUrls.local[0], close: () => server.close() };
  }
  await build({ root, logLevel: 'warn' });
  const server = await preview({ root, logLevel: 'warn', preview: { port: 4199, strictPort: false } });
  return { url: server.resolvedUrls.local[0], close: () => new Promise((r) => server.httpServer.close(r)) };
}

async function main() {
  await mkdir(outDir, { recursive: true });
  const server = await startServer();
  console.log(`serving ${server.url}`);
  const browser = await launchBrowser();
  const errors = [];
  const shots = [];
  try {
    const page = await browser.newPage({ viewport: { width: WIDTH, height: HEIGHT }, deviceScaleFactor: 1 });
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(`console: ${msg.text()}`);
    });
    page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));

    const shot = async (name) => {
      const file = path.join(outDir, `${name}.png`);
      await page.screenshot({ path: file });
      shots.push(file);
      console.log(`  captured ${name}.png`);
    };
    const stackIs = (ids) =>
      page.waitForFunction((expected) => window.__ASTRAL__?.stack().join('>') === expected, ids.join(">"), { timeout: 30000, polling: 100 });
    /** Wait until every finite CSS/Web animation has finished (infinite pulses are ignored). */
    const uiSettled = () =>
      page.waitForFunction(
        () =>
          document.getAnimations().every((a) => {
            const t = a.effect?.getComputedTiming();
            return a.playState !== 'running' || !t || t.iterations === Infinity;
          }),
        null,
        { timeout: 30000, polling: 100 },
      );
    const transitionIdle = () => page.waitForFunction(() => !document.querySelector('.transition.is-active'), null, { timeout: 30000, polling: 100 });

    // Hold the loading screen longer than the default 1.6 s so it can be captured mid-progress
    // (uses the runtime config override system: ?cfg.<section>.<key>=<value>).
    await page.goto(`${server.url}?cfg.ui.minLoadingMs=6000`);
    await page.waitForSelector('[data-screen="loading"]', { timeout: 30000 });
    await page.waitForFunction(() => {
      const n = Number(document.querySelector('[data-screen="loading"]')?.getAttribute('aria-valuenow') ?? 0);
      return n >= 50 && n < 80;
    }, null, { timeout: 30000, polling: 100 });
    await shot('01-loading');

    await stackIs(['title']);
    await transitionIdle();
    await sleep(2600);
    await shot('02-title');

    await page.mouse.click(WIDTH / 2, HEIGHT * 0.8);
    await stackIs(['title', 'main-menu']);
    await uiSettled();
    await sleep(300);
    await shot('03-main-menu');

    await page.click('[data-id="archive"]');
    await stackIs(['title', 'main-menu', 'data-archive']);
    await uiSettled();
    await sleep(300);
    await shot('04-archive-characters');
    await page.click('[data-tab="lightCones"]');
    await uiSettled();
    await sleep(300);
    const unresolved = await page.evaluate(() => [...document.querySelectorAll('.lc-card p')].map((p) => p.textContent).filter((t) => /[{}?]/.test(t ?? '')));
    if (unresolved.length) errors.push(`archive: unresolved Light Cone placeholders: ${unresolved.join(' | ')}`);
    await shot('04b-archive-light-cones');
    await page.click('[data-tab="relics"]');
    await uiSettled();
    await sleep(300);
    await shot('04c-archive-relic-sets');
    await page.click('[data-tab="enemies"]');
    await uiSettled();
    await sleep(300);
    await shot('05-archive-enemies');
    await page.click('[data-tab="rules"]');
    await uiSettled();
    await sleep(300);
    await shot('06-archive-rules');
    await page.keyboard.press('Escape');
    await stackIs(['title', 'main-menu']);

    // Slow the scene transition down (public TransitionOverlay API) so a frame of it can be captured
    // reliably under software rendering, then restore the configured duration.
    const transitionMs = await page.evaluate(() => window.__ASTRAL__.ctx.config.get().ui.transitionMs);
    await page.evaluate(() => window.__ASTRAL__.ctx.transition.setDuration(5000));
    await page.click('[data-id="test-scene"]');
    // Capture the scene transition once the shutters are closed and the emblem is showing.
    await page.waitForFunction(
      () => {
        const e = document.querySelector('.transition.is-active .tr-emblem');
        return !!e && Number(getComputedStyle(e).opacity) > 0.85;
      },
      null,
      { timeout: 15000, polling: 30 },
    );
    await shot('07-transition');
    await stackIs(['test-scene']);
    await transitionIdle();
    await page.evaluate((ms) => window.__ASTRAL__.ctx.transition.setDuration(ms), transitionMs);
    await sleep(1200);
    await exploreWalkthrough(page, '08-explore', (n) => shot(n), errors, (label, pairs) => layoutProblems(page, label, pairs).then((p) => errors.push(...p)), [
      ['.hud__area', '.party'],
      ['.party', '.prompts.is-open'],
    ]);
    // The debug overlay is off by default; F3 (action "toggleDebug") shows it.
    await page.keyboard.press('F3');
    await page.waitForSelector('.debug:not(.is-hidden)', { timeout: 5000 });
    await sleep(400);
    await shot('09-explore-debug');
    await page.keyboard.press('Escape');
    await stackIs(['title', 'main-menu']);
    await transitionIdle();
    console.log('  returned to title > main-menu');
    await page.close();

    for (const vp of VIEWPORTS) await captureViewport(browser, server.url, vp, shot0(shots), errors);
  } finally {
    await browser.close();
    await server.close();
  }

  if (errors.length) {
    console.error(`\nFAILED with ${errors.length} error(s):`);
    for (const e of errors) console.error(`  - ${e}`);
    process.exit(1);
  }
  console.log(`\nOK: ${shots.length} screenshots, no console errors.`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
