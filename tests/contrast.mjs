/**
 * WCAG contrast, computed against the values that actually ship.
 *
 * The colours are parsed out of globals.css. Never restate a hex here: three
 * contrast bugs shipped on the previous project because the test knew a
 * different value than the stylesheet, worst at 1:1 — text exactly the colour
 * of its own background, reported as "the buttons look empty".
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const css = readFileSync(join(import.meta.dirname, '..', 'src', 'app', 'globals.css'), 'utf8');

/**
 * Declarations only, with comments stripped.
 *
 * The banned-property checks below must look at what ships, not at a comment
 * saying "no gradients" — which is exactly what fired the first time this ran.
 * A check that flags its own documentation gets muted within a week.
 */
const declarations = css.replace(/\/\*[\s\S]*?\*\//g, '');

let failed = 0;
const check = (ok, msg, detail) => {
  if (ok) console.log(`pass  ${msg}`);
  else {
    console.error(`FAIL  ${msg}${detail ? `\n      ${detail}` : ''}`);
    failed++;
  }
};

/** Custom properties as declared in :root. */
function declaredVars(source) {
  const vars = {};
  for (const [, name, value] of source.matchAll(/--([\w-]+)\s*:\s*(#[0-9a-fA-F]{3,8})\s*;/g)) {
    vars[name] = value;
  }
  return vars;
}

const vars = declaredVars(css);

for (const name of ['white', 'ink', 'dandelion', 'magenta', 'violet']) {
  check(Boolean(vars[name]), `globals.css declares --${name}`);
}

// If parsing silently found nothing, every ratio below would be meaningless.
check(Object.keys(vars).length >= 5, 'the stylesheet parser found the palette', `found: ${Object.keys(vars).join(', ')}`);

function toRgb(hex) {
  let h = hex.replace('#', '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
}

/** WCAG 2.1 relative luminance. */
function luminance(hex) {
  const [r, g, b] = toRgb(hex).map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function ratio(a, b) {
  const [la, lb] = [luminance(a), luminance(b)];
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

const fmt = (n) => `${n.toFixed(2)}:1`;

// --- The pairings CLAUDE.md commits to --------------------------------------

const bodyOnWhite = ratio(vars.ink, vars.white);
check(bodyOnWhite >= 7, `body text: ink on white is AAA (${fmt(bodyOnWhite)})`);

const inkOnYellow = ratio(vars.ink, vars.dandelion);
check(inkOnYellow >= 7, `high-impact blocks: ink on dandelion is AAA (${fmt(inkOnYellow)})`);

// The rule this encodes: yellow is flyer stock, a surface, never a text colour.
const yellowOnWhite = ratio(vars.dandelion, vars.white);
check(
  yellowOnWhite < 3,
  `dandelion on white stays below the text threshold, so it is never used for text (${fmt(yellowOnWhite)})`,
);

// --- Accents, measured per use ----------------------------------------------
// Accents are CTAs and emphasis only. What matters is that the combinations the
// UI actually uses are legible.

const whiteOnMagenta = ratio(vars.white, vars.magenta);
check(whiteOnMagenta >= 3, `button hover: white on magenta meets large-text AA (${fmt(whiteOnMagenta)})`);

const whiteOnInk = ratio(vars.white, vars.ink);
check(whiteOnInk >= 7, `primary button: white on ink is AAA (${fmt(whiteOnInk)})`);

// Focus rings are a non-text UI component: WCAG 1.4.11 sets 3:1 against
// adjacent colour. This one is load-bearing for keyboard users.
const violetOnWhite = ratio(vars.violet, vars.white);
check(violetOnWhite >= 3, `focus ring: violet on white meets the 3:1 UI component threshold (${fmt(violetOnWhite)})`);

// The magenta notice border, against the panel it sits on.
const magentaOnWhite = ratio(vars.magenta, vars.white);
check(magentaOnWhite >= 3, `notice border: magenta on white meets 3:1 (${fmt(magentaOnWhite)})`);

// The connect panel is a dandelion block, so the primary button sits on yellow
// rather than white. Both its resting and hover states have to hold up there,
// and a hover that drops below 3:1 is the bug this pairing exists to catch.
const inkButtonOnYellow = ratio(vars.ink, vars.dandelion);
check(inkButtonOnYellow >= 3, `button edge: ink on dandelion meets 3:1 (${fmt(inkButtonOnYellow)})`);

// The hover state on a yellow panel is white, not magenta: magenta measures
// 2.53:1 on dandelion, which is why the rule below exists in globals.css.
const whiteOnYellow = ratio(vars.white, vars.dandelion);
check(
  whiteOnYellow >= 1.5,
  `button hover on the yellow panel is a visible change (${fmt(whiteOnYellow)})`,
);
check(
  ratio(vars.magenta, vars.dandelion) < 3,
  'magenta on dandelion is below 3:1, which is why the yellow panel overrides the hover',
);
check(
  /\.block-yellow\s+\.btn:hover/.test(declarations),
  'globals.css overrides the button hover inside a yellow block',
);

// --- The bug class this file exists for -------------------------------------
// A colour identical to its own ground renders invisible and passes every
// static check. Assert no declared pair collides.

const names = Object.keys(vars);
for (let i = 0; i < names.length; i++) {
  for (let j = i + 1; j < names.length; j++) {
    const r = ratio(vars[names[i]], vars[names[j]]);
    if (r < 1.05) {
      check(false, `--${names[i]} and --${names[j]} are visually identical (${fmt(r)})`);
    }
  }
}
check(true, 'no two palette colours are visually identical');

// --- Design rules that are checkable in CSS ---------------------------------

check(/border-radius:\s*0/.test(declarations), 'globals.css sets border-radius to zero');
check(
  !/border-radius:\s*(?!0)[1-9]/.test(declarations),
  'no non-zero border-radius anywhere: hard edges are the whole point',
);
check(!/box-shadow/.test(declarations), 'no box-shadow: flat blocks and hard rules only');
check(!/gradient/.test(declarations), 'no gradients');
check(!/backdrop-filter/.test(declarations), 'no glassmorphism');

console.log(failed ? `\n${failed} check(s) failed` : '\nall contrast checks passed');
process.exit(failed ? 1 : 0);
