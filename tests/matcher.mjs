/**
 * The matcher eval set.
 *
 * Cases live in fixtures/matcher-cases.json and were written before the
 * matcher, so it cannot be tuned to pass its own test.
 *
 * The trap this suite avoids, from PLAYBOOK: a test that reimplements the logic
 * it is testing will happily assert the buggy behaviour. So expectations here
 * are written as literal artist names, and the only normalisation applied to
 * them is the lookup from name to roster index — never the matcher's own
 * normalizeName. If normalizeName breaks, these cases must fail.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildIndex, matchArtist } from '../src/matcher/match.ts';
import { splitLineup, normalizeName } from '../src/matcher/normalize.ts';

const fixture = JSON.parse(
  readFileSync(join(import.meta.dirname, 'fixtures', 'matcher-cases.json'), 'utf8'),
);

let failed = 0;
const check = (ok, msg, detail) => {
  if (ok) console.log(`pass  ${msg}`);
  else {
    console.error(`FAIL  ${msg}${detail ? `\n      ${detail}` : ''}`);
    failed++;
  }
};

// Roster artist ids are their index in the fixture array, so an expectation can
// be written as a literal name and resolved without touching matcher code.
const roster = fixture.roster.map((name, i) => ({
  artistId: i,
  name,
  nameNormalized: normalizeName(name),
  mbid: null,
  spotifyId: null,
}));
const nameOf = (id) => (id === null || id === undefined ? null : fixture.roster[id] ?? `#${id}`);

const index = buildIndex(roster, []);

let matched = 0;
let total = 0;

for (const c of fixture.cases) {
  total++;
  const r = matchArtist(c.input, index);
  const got = nameOf(r.artistId);

  if (c.expectNull) {
    const ok = r.artistId === null;
    check(ok, `"${c.input}" does not match  (${c.why})`, ok ? '' : `matched: ${got}`);
    if (ok) matched++;
  } else {
    const ok = got === c.expect;
    check(
      ok,
      `"${c.input}" → ${c.expect}  (${c.why})`,
      ok ? '' : `got: ${got ?? 'no match'} [tier ${r.tier}, ${r.confidence.toFixed(2)}]`,
    );
    if (ok) matched++;
  }
}

console.log('\n─── lineup splitting ───');
for (const l of fixture.lineups) {
  total++;
  const got = splitLineup(l.input);
  const ok = JSON.stringify(got) === JSON.stringify(l.expect);
  check(
    ok,
    `"${l.input}" → [${l.expect.join(', ')}]  (${l.why})`,
    ok ? '' : `got: [${got.join(', ')}]`,
  );
  if (ok) matched++;
}

const score = Number(((matched / total) * 100).toFixed(1));
console.log(`\nmatcher eval: ${matched}/${total} (${score}%)`);

/**
 * The high-water mark. Every case here currently passes, so any drop is a
 * regression and fails the build.
 *
 * This started as a 90% threshold, which was wrong: breaking article-stripping
 * scored 97.5% and still exited 0. A floor below the current score is not a
 * quality bar, it is permission to regress.
 *
 * When a genuinely hard new case is added that the matcher cannot yet handle,
 * lower this deliberately in the same commit that adds the case, with a note
 * saying which case is failing and why it is worth keeping red.
 */
const REQUIRED = 100;

if (score < REQUIRED) {
  console.error(
    `\nregression: ${score}% is below the required ${REQUIRED}%.\n` +
      `Fix the matcher, or lower REQUIRED deliberately and say which case is failing.`,
  );
  process.exit(1);
}

console.log('no regression');
process.exit(0);
