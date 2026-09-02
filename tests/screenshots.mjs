/**
 * Screenshots via a real browser, against a running server.
 *
 * Manual (not in the suite): it needs a server and a Chrome install, and a test
 * that shells out to a browser starts failing for environmental reasons and
 * gets ignored.
 *
 * Why it exists anyway: jsdom has no layout engine. It proves the app responds;
 * it cannot show misalignment, overflow or overlap. Constraint 5.
 *
 *   npm run build && npm start   # in one terminal
 *   npm run shots                # in another
 *
 * THE TRAP, and it cost a full debugging round: Chrome's `--screenshot` with
 * `--window-size` does NOT set the layout viewport. The page lays out at the
 * default desktop width and the PNG is merely cropped to the window size, which
 * looks exactly like a horizontal-overflow bug and is not one. Every "mobile"
 * shot taken that way is a lie.
 *
 * So this drives Chrome over the DevTools Protocol and calls
 * Emulation.setDeviceMetricsOverride, which is what actually resizes the
 * viewport. It also measures scrollWidth against innerWidth and fails the run
 * on real overflow, so the check does not depend on someone eyeballing a PNG.
 */

import { mkdirSync, existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawn } from 'node:child_process';

const root = join(import.meta.dirname, '..');
const outDir = join(root, 'tests', 'shots');
const BASE = process.env.SHOTS_BASE_URL ?? 'http://127.0.0.1:3000';
const PORT = 9222;

const VIEWPORTS = [
  { name: 'mobile', width: 390, height: 1200, mobile: true },
  { name: 'desktop', width: 1280, height: 1000, mobile: false },
];

const ROUTES = [
  { name: 'connect', path: '/' },
  { name: 'connect-error', path: '/?auth_error=state_mismatch' },
];

function findChrome() {
  return [
    process.env.CHROME_PATH,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ]
    .filter(Boolean)
    .find((p) => existsSync(p));
}

const chromePath = findChrome();
if (!chromePath) {
  console.error('No Chrome or Edge found. Set CHROME_PATH to the executable.');
  process.exit(1);
}

// A screenshot of a connection-refused page looks like a broken layout rather
// than a server that is not running. Fail with the actionable message instead.
const reachable = await fetch(BASE).then(
  (r) => r.ok,
  () => false,
);
if (!reachable) {
  console.error(`Nothing is serving ${BASE}. Start it with: npm run build && npm start`);
  process.exit(1);
}

mkdirSync(outDir, { recursive: true });

const browser = spawn(
  chromePath,
  [
    '--headless=new',
    '--disable-gpu',
    '--no-sandbox',
    '--hide-scrollbars',
    `--remote-debugging-port=${PORT}`,
    'about:blank',
  ],
  { stdio: 'ignore' },
);

/** Chrome needs a moment before its debugging endpoint answers. */
async function waitForDevtools(attempts = 40) {
  for (let i = 0; i < attempts; i++) {
    try {
      const targets = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
      const page = targets.find((t) => t.type === 'page');
      if (page?.webSocketDebuggerUrl) return page;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  return null;
}

const target = await waitForDevtools();
if (!target) {
  console.error('Chrome did not expose a DevTools endpoint.');
  browser.kill();
  process.exit(1);
}

const sock = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  sock.addEventListener('open', resolve, { once: true });
  sock.addEventListener('error', reject, { once: true });
});

const send = (() => {
  let id = 0;
  const pending = new Map();
  sock.addEventListener('message', (e) => {
    const msg = JSON.parse(e.data);
    const resolve = pending.get(msg.id);
    if (resolve) {
      pending.delete(msg.id);
      resolve(msg.result ?? {});
    }
  });
  return (method, params = {}) =>
    new Promise((resolve) => {
      const i = ++id;
      pending.set(i, resolve);
      sock.send(JSON.stringify({ id: i, method, params }));
    });
})();

await send('Page.enable');

/**
 * Layout facts worth failing on, measured in the page rather than eyeballed.
 *
 * `documentElement.scrollWidth` is not enough: it gets clamped to the viewport
 * in some overflow cases and reports no problem while content visibly runs off
 * the edge (verified by planting a 900px min-width and watching it report 390).
 * So this also walks the elements and takes the furthest right edge, which is
 * what actually determines whether the page scrolls sideways.
 */
const MEASURE = `(() => {
  const vw = window.innerWidth;
  let widest = 0;
  let culprit = '';
  for (const el of document.body.querySelectorAll('*')) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) continue;
    if (r.right > widest) {
      widest = r.right;
      culprit = el.tagName.toLowerCase() + (el.className ? '.' + String(el.className).split(' ')[0] : '');
    }
  }
  return JSON.stringify({
    innerWidth: vw,
    scrollWidth: document.documentElement.scrollWidth,
    contentRight: Math.round(widest),
    widestElement: culprit,
    overflowing: Math.round(widest) > vw + 1 || document.documentElement.scrollWidth > vw + 1
  });
})()`;

let made = 0;
let overflowed = 0;
const index = [];

for (const route of ROUTES) {
  for (const vp of VIEWPORTS) {
    // This, not --window-size, is what actually sets the layout viewport.
    await send('Emulation.setDeviceMetricsOverride', {
      width: vp.width,
      height: vp.height,
      deviceScaleFactor: 1,
      mobile: vp.mobile,
    });

    await send('Page.navigate', { url: BASE + route.path });
    await new Promise((r) => setTimeout(r, 1200));

    const { result } = await send('Runtime.evaluate', {
      expression: MEASURE,
      returnByValue: true,
    });
    const measured = JSON.parse(result.value);

    /*
     * Compare against the width we ASKED for, not the one the page reports.
     *
     * When content is wider than the emulated viewport, Chrome widens the
     * viewport to fit it: window.innerWidth comes back as the content width and
     * every relative check then says "no overflow". Verified by planting a
     * 900px min-width at a 390px viewport and watching innerWidth report 900.
     * The requested width is the only fixed reference.
     */
    const metrics = {
      ...measured,
      requestedWidth: vp.width,
      overflowing: measured.contentRight > vp.width + 1,
    };

    const file = `${route.name}-${vp.name}.png`;
    const shot = await send('Page.captureScreenshot', {
      format: 'png',
      captureBeyondViewport: true,
    });

    if (shot.data) {
      writeFileSync(join(outDir, file), Buffer.from(shot.data, 'base64'));
      made++;
      index.push({ file, route: route.path, viewport: `${vp.width}x${vp.height}`, ...metrics });
    }

    // The body must never scroll sideways. Reported per shot, because "which
    // width breaks" is the first thing you need to know.
    if (metrics.overflowing) {
      overflowed++;
      console.log(
        `OVERFLOW ${file}  content reaches ${metrics.contentRight}px in a ` +
          `${vp.width}px viewport (widest: ${metrics.widestElement})`,
      );
    } else {
      console.log(`shot  ${file}  ${vp.width}x${vp.height}  ${route.path}`);
    }
  }
}

writeFileSync(join(outDir, 'index.json'), JSON.stringify({ base: BASE, shots: index }, null, 2));

sock.close();
browser.kill();

const expected = ROUTES.length * VIEWPORTS.length;
console.log(`\n${made}/${expected} screenshots in tests/shots/`);
if (overflowed) console.error(`${overflowed} view(s) scroll horizontally`);
process.exit(made === expected && overflowed === 0 ? 0 : 1);
