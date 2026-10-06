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
    await sleep(2200);
    await shot('08-test-scene');

    // Exercise input: hold W + D + Shift, orbit by dragging, zoom with the wheel.
    await page.keyboard.down('KeyW');
    await page.keyboard.down('KeyD');
    await page.keyboard.down('ShiftLeft');
    await page.mouse.move(WIDTH / 2, HEIGHT / 2);
    await page.mouse.down();
    for (let i = 1; i <= 20; i++) {
      await page.mouse.move(WIDTH / 2 + i * 14, HEIGHT / 2 + i * 2);
      await sleep(16);
    }
    await page.mouse.wheel(0, -150);
    await sleep(300);
    const held = await page.evaluate(() => window.__ASTRAL__?.ctx.input.activeActions() ?? []);
    console.log(`  input actions held: ${held.join(', ')}`);
    for (const a of ['moveForward', 'moveRight', 'sprint', 'cameraDrag']) {
      if (!held.includes(a)) errors.push(`input: expected action "${a}" to be held`);
    }
    await shot('09-test-scene-input');
    await page.mouse.up();
    await page.keyboard.up('KeyW');
    await page.keyboard.up('KeyD');
    await page.keyboard.up('ShiftLeft');

    await page.keyboard.press('Escape');
    await stackIs(['title', 'main-menu']);
    await transitionIdle();
    console.log('  returned to title > main-menu');
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
