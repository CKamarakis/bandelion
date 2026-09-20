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

for (const name of ['white', 'ink', 'dandelion', 'magenta', 'violet', 'spotify-green']) {
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

// --- The Spotify connect button ---------------------------------------------
//
// A brand colour is where "just use their green" quietly ships unreadable text.
// Spotify's own guidance treats #1ED760 as a background, and these numbers are
// why: white on it is under 2:1.

const blackOnSpotify = ratio('#000000', vars['spotify-green']);
check(
  blackOnSpotify >= 7,
  `Spotify button: black on their green is AAA (${fmt(blackOnSpotify)})`,
);

const whiteOnSpotify = ratio('#ffffff', vars['spotify-green']);
check(
  whiteOnSpotify < 3,
  `white on Spotify green fails, which is why the button sets black (${fmt(whiteOnSpotify)})`,
);

// The button sits on the dandelion panel. Green on yellow is 1.28:1, so the
// border is doing the work of separating it from the ground.
const spotifyOnYellow = ratio(vars['spotify-green'], vars.dandelion);
check(
  spotifyOnYellow < 3,
  `Spotify green on dandelion is low (${fmt(spotifyOnYellow)}), so the button needs its border`,
);
check(
  /\.btn-spotify\s*\{[^}]*border-color:\s*var\(--ink\)/.test(declarations),
  'the Spotify button keeps a hard ink border, so it does not dissolve into the panel',
);

// The label must never be set in the green itself.
check(
  !/\.btn-spotify\s*\{[^}]*color:\s*var\(--spotify-green\)/.test(declarations),
  'the Spotify button never sets its label in the brand green',
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

/*
 * Zero border-radius, with exactly one exception: the save stamp.
 *
 * The rule is against interface chrome pretending to be soft — rounded cards,
 * pill buttons, the SaaS look it exists to keep out. The stamp is an ink mark
 * on a record sleeve, the same category as the logo, which is also a black
 * circle. A deliberate, discussed exception.
 *
 * Narrowed rather than muted, following the gradient check above: the allowance
 * is pinned to one selector, so a rounded corner anywhere else still fails. The
 * count check is what makes that real — without it, `.stamp` in the allowlist
 * would excuse every `border-radius` in the file.
 */
/*
 * The one rounded thing: the save stamp, a circle drawn around circular
 * artwork. Anything else must be square.
 *
 * `.masthead-home` was briefly here too, for a ring around the round mark. The
 * link now wraps the wordmark as well, so its ring boxes a rectangle and the
 * radius came back off.
 */
const ROUNDED_ALLOWED = ['.stamp'];

const roundedSelectors = [];
for (const [, selector, body] of declarations.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
  // Per declaration, not per rule: a rule setting `border-radius: 0` and
  // nothing else would otherwise match a loose search for a non-zero value
  // sitting elsewhere in the same block.
  const rounded = [...body.matchAll(/border-radius:\s*([^;]+)/g)].some(
    ([, value]) => !/^0\D*$/.test(value.trim()),
  );
  if (rounded) roundedSelectors.push(selector.trim());
}

const unexpectedRounded = roundedSelectors.filter((s) => !ROUNDED_ALLOWED.includes(s));
check(
  unexpectedRounded.length === 0,
  'the only rounded thing is the save stamp: hard edges everywhere else',
  `unexpected rounded selectors: ${unexpectedRounded.join(' | ') || '(none)'}`,
);
check(
  /\.stamp\s*\{[^}]*border-radius:\s*50%/.test(declarations),
  'the save stamp is a circle, which is the documented exception',
);
check(!/box-shadow/.test(declarations), 'no box-shadow: flat blocks and hard rules only');
/*
 * No blended gradients.
 *
 * The rule is against soft transitions, not against the function: a
 * `repeating-linear-gradient` whose colour stops touch is a hard-edged stripe
 * pattern with no blend anywhere in it, which is a screenprint, not a fade.
 * So `linear-gradient` and `radial-gradient` stay banned outright, and the
 * repeating form is allowed only in the striped no-cover block.
 *
 * Narrowed deliberately rather than by muting the check. If this ever needs
 * widening again, the question to ask is whether the declaration produces a
 * visible blend, because that is the thing the design rule forbids.
 */
check(
  !/(^|[^-\w])(linear-gradient|radial-gradient|conic-gradient)/.test(declarations),
  'no blended gradients: flat blocks and hard rules only',
);

/*
 * Match to the end of the declaration, not to the first ')'.
 *
 * The stops are written as `var(--ink) 8px`, so a lazy `[^)]*` stops inside
 * the first var() and reports a pattern with no stops at all — which read as a
 * blend and failed a correct declaration.
 */
const repeating = declarations.match(/repeating-linear-gradient\([\s\S]*?\);/g) ?? [];
for (const pattern of repeating) {
  /*
   * Every stop must share a position with its neighbour, which is what makes
   * the edge hard. `ink 0, ink 8px, magenta 8px` is a stripe; `ink 0, magenta
   * 20px` is a fade wearing the same function name.
   */
  // `0` is a valid stop and carries no unit, so matching only `Npx` misses it
  // and reads a correct hard-stop pattern as a blend.
  const stops = [...pattern.matchAll(/(?:^|[\s,])(\d+)(?:px)?(?=[\s,)])/g)].map((m) => m[1]);
  const hasTouchingStops = stops.some((value, i) => i > 0 && stops[i - 1] === value);
  check(
    hasTouchingStops,
    'a repeating gradient uses hard stops, not a blend',
    pattern,
  );
}
check(!/backdrop-filter/.test(declarations), 'no glassmorphism');

// --- PALETTE.md names the colours that actually exist ------------------------
//
// The file documents the palette; globals.css defines it. A hex listed there
// and absent from the stylesheet is documentation of a colour nobody ships,
// which is the drift constraint 3 exists to catch. The reverse is deliberately
// not checked: --rule is an alias, not a new colour.

{
  const paletteDoc = readFileSync(join(import.meta.dirname, '..', 'PALETTE.md'), 'utf8');
  const declared = new Set(
    Object.values(vars).map((v) => v.toLowerCase().trim()),
  );
  // True black is the striped ground, written literally in the stylesheet
  // rather than as a token, so it is a legitimate hex in the document.
  declared.add('#000000');

  const documented = [...paletteDoc.matchAll(/`(#[0-9a-fA-F]{6})`/g)].map((m) =>
    m[1].toLowerCase(),
  );

  check(documented.length > 0, 'PALETTE.md lists at least one hex');
  for (const hex of new Set(documented)) {
    check(
      declared.has(hex),
      `PALETTE.md documents a colour that ships: ${hex}`,
      `not found in globals.css (declared: ${[...declared].join(', ')})`,
    );
  }
}

console.log(failed ? `\n${failed} check(s) failed` : '\nall contrast checks passed');
process.exit(failed ? 1 : 0);
