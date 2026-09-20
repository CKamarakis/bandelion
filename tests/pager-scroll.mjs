/**
 * Does turning a page scroll back to the top of the list?
 *
 * Manual (not in the suite), for the same reason as screenshots.mjs: it needs a
 * running server and a Chrome install, and a test that shells out to a browser
 * starts failing for environmental reasons and gets ignored.
 *
 *   npm run build && npm start   # in one terminal
 *   node tests/pager-scroll.mjs  # in another
 *
 * Why it exists: the pager sits below 100 rows, so pressing it left you at the
 * bottom of a page whose contents had entirely changed. Nothing in the suite
 * can see that — scroll position needs a layout engine, and jsdom has none.
 *
 * Verified against the bug it describes: with the scrollIntoView call removed,
 * this reports scrollY 15803 and the list's top 15392px above the viewport.
 * With it, scrollY 387 and the anchor 24px down, which is its scroll-margin.
 */

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';

const CHROME = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
].find((p) => existsSync(p));

const PORT = 9444;
const chrome = spawn(CHROME, [
  `--remote-debugging-port=${PORT}`,
  '--headless=new',
  '--disable-gpu',
  '--no-first-run',
  '--user-data-dir=' + process.env.TEMP + '\\pager-probe',
  'about:blank',
]);

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
await wait(3000);

const targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const page = targets.find((t) => t.type === 'page');

const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));

let id = 0;
const pending = new Map();
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) {
    pending.get(m.id)(m);
    pending.delete(m.id);
  }
};
const send = (method, params = {}) =>
  new Promise((res) => {
    const i = ++id;
    pending.set(i, res);
    ws.send(JSON.stringify({ id: i, method, params }));
  });

const evaluate = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  return r.result?.result?.value;
};

await send('Page.enable');
await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', {
  width: 1280, height: 900, deviceScaleFactor: 1, mobile: false,
});

await send('Page.navigate', { url: 'http://127.0.0.1:3000/' });
await wait(4000);

const pagerCount = await evaluate(`document.querySelectorAll('[aria-label="Pages"] button').length`);
console.log('pager buttons found:', pagerCount);

if (!pagerCount) {
  console.log('RESULT: no pager on this page, nothing to test');
  chrome.kill();
  process.exit(1);
}

// Scroll to the bottom, where the pager is, exactly as a reader would.
await evaluate(`window.scrollTo(0, document.body.scrollHeight); true`);
await wait(800);
const before = await evaluate(`Math.round(window.scrollY)`);
console.log('scrollY at the pager:', before);

// Press "Next".
const clicked = await evaluate(`
  (() => {
    const nav = document.querySelector('[aria-label="Pages"]');
    const next = [...nav.querySelectorAll('button')].find(b => /next/i.test(b.textContent || b.ariaLabel || ''));
    if (!next) return 'no next button';
    next.click();
    return 'clicked';
  })()
`);
console.log('click:', clicked);

// Smooth scrolling needs time to land.
await wait(2500);
const after = await evaluate(`Math.round(window.scrollY)`);
console.log('scrollY after turning the page:', after);

const headingTop = await evaluate(`
  Math.round(document.querySelector('.feed-top').getBoundingClientRect().top)
`);
console.log('feed-top position in viewport:', headingTop);

console.log('');
if (after < before && Math.abs(headingTop) < 80) {
  console.log('RESULT: PASS - the page scrolled back to the top of the list');
} else {
  console.log(`RESULT: FAIL - before ${before}, after ${after}, anchor at ${headingTop}`);
}

chrome.kill();
process.exit(0);
