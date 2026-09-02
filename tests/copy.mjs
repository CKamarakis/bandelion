/**
 * User-facing strings, against the eight rules in .claude/skills/copy/SKILL.md.
 *
 * Scans the string literals that reach a screen. It cannot judge tone, so it
 * checks the mechanical rules and the one that matters most: rule 8, copy that
 * asserts what the product cannot know.
 *
 * Deliberately narrow. A checker that flags prose in comments gets muted, and a
 * muted checker is worse than none.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const root = join(import.meta.dirname, '..');
const appDir = join(root, 'src', 'app');

let failed = 0;
const check = (ok, msg, detail) => {
  if (ok) console.log(`pass  ${msg}`);
  else {
    console.error(`FAIL  ${msg}${detail ? `\n      ${detail}` : ''}`);
    failed++;
  }
};

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (/\.(tsx?|css)$/.test(entry)) out.push(p);
  }
  return out;
}

const files = walk(appDir);
check(files.length > 0, 'found source files to scan', `looked in ${appDir}`);

/** Strip comments so prose about the rules is not mistaken for copy. */
const stripComments = (src) =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

/**
 * String literals that plausibly reach a user.
 *
 * Heuristic: contains a space and a lowercase word. That excludes identifiers,
 * class names, CSS values and URLs without needing a parser.
 */
function userStrings(src) {
  const found = [];
  for (const [, q1, q2] of src.matchAll(/'([^'\\\n]{4,})'|"([^"\\\n]{4,})"/g)) {
    const s = q1 ?? q2;
    if (!/\s/.test(s)) continue;
    if (!/[a-z]{2,}/.test(s)) continue;
    if (/^[\d\s.,%px:;-]+$/.test(s)) continue; // CSS values
    if (/^(https?:|\/|var\(|--)/.test(s)) continue;
    // SVG path data: an inline icon is a long string of coordinates that reads
    // as a 37-word label. Anchored on the command letters so it cannot excuse
    // real prose that happens to contain a number.
    if (/^[Mm][\d\s.,-]/.test(s) && /[CcSsQqTtAaLlHhVvZz]/.test(s)) continue;
    if (/^[\w-]+(\s+[\w-]+)*$/.test(s) && /^(ui-|sans|serif|monospace)/.test(s)) continue;
    found.push(s);
  }
  return found;
}

let scanned = 0;
const allStrings = [];

for (const file of files) {
  const rel = relative(root, file).replace(/\\/g, '/');
  const src = stripComments(readFileSync(file, 'utf8'));
  scanned++;

  for (const s of userStrings(src)) {
    allStrings.push({ rel, s });
  }
}

check(scanned > 0, `scanned ${scanned} files in src/app`);
check(allStrings.length > 0, 'found user-facing strings to check');

// --- Rule 1: no em dash, no en dash -----------------------------------------
// Exception: a bare '—' alone is the empty-value glyph in a metadata row.

for (const { rel, s } of allStrings) {
  if (s.trim() === '—') continue;
  if (/[—–]/.test(s)) {
    check(false, `no em or en dash in ${rel}`, `"${s}"`);
  }
}
check(true, 'rule 1: no em or en dashes in user copy');

// --- Rule 2: lean, no label past 18 words -----------------------------------

for (const { rel, s } of allStrings) {
  const words = s.trim().split(/\s+/).length;
  if (words > 18) {
    check(false, `no label past 18 words in ${rel}`, `${words} words: "${s}"`);
  }
}
check(true, 'rule 2: every label is 18 words or fewer');

// --- Rule 3: directing, not petitioning -------------------------------------

const TONE = [
  { re: /\bplease\b/i, why: 'no "please": it softens an instruction into a request' },
  { re: /\bsorry\b/i, why: 'no "sorry": state the fact' },
  { re: /are you sure/i, why: 'no "are you sure?": make it undoable instead' },
  { re: /!/, why: 'no exclamation marks: the screen directs, it does not cheer' },
];

for (const { rel, s } of allStrings) {
  for (const { re, why } of TONE) {
    if (re.test(s)) check(false, `${why} (${rel})`, `"${s}"`);
  }
}
check(true, 'rule 3: no please, sorry, are-you-sure or exclamation marks');

// --- Rule 4: second person singular -----------------------------------------

for (const { rel, s } of allStrings) {
  if (/\bthe user\b/i.test(s)) {
    check(false, `rule 4: "the user" in ${rel}`, `"${s}"`);
  }
}
check(true, 'rule 4: the user is addressed as "you"');

// --- Rule 5: never chasing --------------------------------------------------

const CHASING = [
  { re: /\byou must\b/i, why: '"you must" states what the user owes' },
  { re: /\byou haven'?t\b/i, why: '"you haven\'t" chases the user' },
  { re: /\bfailed to\b/i, why: '"failed to" blames rather than naming the source' },
];

for (const { rel, s } of allStrings) {
  for (const { re, why } of CHASING) {
    if (re.test(s)) check(false, `rule 5: ${why} (${rel})`, `"${s}"`);
  }
}
check(true, 'rule 5: no "you must", "you haven\'t" or "failed to"');

// --- Rule 8: copy must not assert what the product cannot do ----------------
// The highest-value check here. Absence of data is not evidence of absence.

const ABSOLUTE = [
  { re: /\ball your\b/i, why: '"all your" claims completeness we cannot verify' },
  { re: /\bevery (gig|release|artist|show)\b/i, why: '"every" claims coverage no source gives us' },
  { re: /\bfull lineup\b/i, why: 'support acts are best-effort: write "lineup, as listed"' },
  { re: /\bcomplete (profile|lineup|list)\b/i, why: 'our data is incomplete by nature' },
  {
    re: /\bno (gigs|releases|shows) (coming up|upcoming)\b/i,
    why: 'we know what our sources returned, not what exists: name the source',
  },
  {
    re: /\btickets on sale\b/i,
    why: 'on-sale dates are frequently wrong or missing: attribute them to the source',
  },
  { re: /\bnothing new\b(?!\s+since)/i, why: 'the window is a choice: name it ("nothing new since ...")' },
];

for (const { rel, s } of allStrings) {
  for (const { re, why } of ABSOLUTE) {
    if (re.test(s)) check(false, `rule 8: ${why} (${rel})`, `"${s}"`);
  }
}
check(true, 'rule 8: no copy asserting completeness the data cannot support');

console.log(failed ? `\n${failed} check(s) failed` : '\nall copy checks passed');
process.exit(failed ? 1 : 0);
