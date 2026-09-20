/**
 * Triage: the rules that decide a name-search candidate without a human.
 *
 * Every case here is a real row from the review queue on a real roster. They
 * are kept verbatim, names and disambiguation text included, because a rule
 * written from a description tests the description.
 *
 * The cases that matter most are the ones asserting triage does NOT decide.
 * A rule that accepts too much is worse than no rule: a wrong MBID attaches
 * another band's releases to the feed and nothing on screen says so.
 */

import { triage, isCollabCredit, normalizeForMatch } from '../src/matcher/triage.ts';

let failed = 0;
const check = (ok, msg, detail) => {
  if (ok) console.log(`pass  ${msg}`);
  else {
    console.error(`FAIL  ${msg}${detail ? `\n      ${detail}` : ''}`);
    failed++;
  }
};

const c = (name, score, disambiguation = '', type = 'Group') => ({
  mbid: `mb-${name.toLowerCase().replace(/[^a-z0-9]/g, '')}-${score}`,
  name,
  score,
  disambiguation,
  type,
});

console.log('\n# rule 1: a band does not have a different number of words');

{
  // GRENADE, verbatim from the queue.
  const r = triage('GRENADE', [
    c('Grenade', 100, 'Australian black/death metal band'),
    c('GRENADE', 100, 'French band'),
    c('Grenade', 100),
    c('Daisy Grenade', 95, 'New York bubblegrunge duo'),
    c('Hate Grenade', 93),
  ]);
  check(r.accept?.name === 'GRENADE', 'GRENADE picks the exact spelling', r.reason);
  check(r.reason === 'exact-spelling-tiebreak', 'and says the spelling decided it');
}

{
  // Steak: the word filter removes the noise, but two real Steaks remain.
  const r = triage('Steak', [
    c('Steak', 100, 'UK stoner rock band'),
    c('Steak', 95, 'German melodic hard-rock band'),
    c('Monkey Steak', 89),
    c('Chuck Steak', 88, 'harsh noise wall'),
    c('Green Buffalo Steak Ensemble', 80),
  ]);
  check(r.accept === null, 'Steak stays for a human: two real bands share the name');
  check(r.reason === 'ambiguous', 'and the reason says so', r.reason);
}

{
  /*
   * The word filter's own case, and it took a mutation run to find.
   *
   * On the real queue, removing the filter changed no outcome: "Daisy
   * Grenade" already fails the exact-name test, so the filter was doing work
   * that rule 2 repeated. The case where it genuinely decides is a candidate
   * that normalises IDENTICALLY but is spaced differently — punctuation and
   * spaces are stripped, so "TheSword" and "The Sword" are the same string to
   * rule 2 and different bands to a reader.
   *
   * Without the word filter this row is an ambiguous two-way tie and goes to
   * a human; with it, only the correctly spaced candidate survives.
   */
  const r = triage('The Sword', [
    c('The Sword', 100, 'Texas heavy metal band'),
    c('TheSword', 99, 'unrelated project'),
  ]);
  check(
    r.accept?.disambiguation === 'Texas heavy metal band',
    'a candidate spaced differently is dropped before the tie is counted',
    r.reason,
  );
  check(r.reason === 'sole-exact-match', 'leaving exactly one', r.reason);
}

console.log('\n# rule 3: odd spelling is how a band stays findable');

{
  const r = triage('The IronY', [
    c('The Irony', 100),
    c('The IronY', 99, 'German Death Metal'),
    c('Appreciate the Irony', 90),
  ]);
  check(r.accept?.name === 'The IronY', 'The IronY beats The Irony');
  /*
   * The one that proves the rule is not just "take the top score": the
   * correct answer scored 99 and the wrong one 100.
   */
  check(r.accept?.score === 99, 'even though the wrong one scored higher');
}

console.log('\n# rule 4: a collaboration is not either artist');

{
  const r = triage('Giannis Aggelakas', [c('Giannis Aggelakas x Nikos Veliotis', 100)]);
  check(r.accept === null, 'a collab credit is not the artist alone');
}

{
  const r = triage('Nikos Veliotis', [
    c('Kalliopi Mitropoulou x Nikos Veliotis', 100),
    c('Giannis Aggelakas x Nikos Veliotis', 100),
  ]);
  check(r.accept === null, 'two collab credits are still not the artist');
}

{
  /*
   * The counter-case, and the reason rule 4 reads the sides rather than
   * looking for the letter x. Terror X Crew is a real band on this roster.
   */
  check(
    isCollabCredit('Terror X Crew', 'Terror X Crew') === false,
    'a band whose own name contains an x is not a collab credit',
  );
  const r = triage('Terror X Crew', [c('Terror X Crew', 100)]);
  check(r.accept?.name === 'Terror X Crew', 'so Terror X Crew still matches itself');
}

console.log('\n# rule 5: a Trolls character is not a band');

{
  const r = triage('Mr. Dinkles', [
    c('Mr. Dinkles', 100, '"rock band from Seattle"', 'Group'),
    c('Mr. Dinkles', 97, '"Trolls" character', 'Character'),
  ]);
  check(r.accept?.disambiguation.includes('Seattle'), 'the Seattle band wins over the character');
  check(r.reason === 'sole-exact-match', 'dropping the character left exactly one', r.reason);
}

{
  // An absent type must not disqualify: MusicBrainz leaves it blank often.
  const r = triage('Xaxakes', [{ mbid: 'x1', name: 'Xaxakes', score: 100, disambiguation: '' }]);
  check(r.accept?.name === 'Xaxakes', 'a candidate with no type at all is still accepted');
}

console.log('\n# what triage must NOT decide');

{
  /*
   * Tripes, the case that got through and had to be fixed twice.
   *
   * First the alias query: without it the search returned only French and
   * Mauritian acts, and the real band Τρύπες was absent entirely.
   *
   * Then this. With `alias:` the search DOES return Τρύπες top at score 100 —
   * and triage still accepted the French trio, because `normalizeForMatch`
   * keeps only [a-z0-9] so a Greek name normalises to the empty string. The
   * right answer was uncomparable, so the wrong one won by default, and the
   * artist was written with a confident wrong MBID in a real run.
   *
   * These are the live scores from MusicBrainz on 2026-09-20.
   */
  const r = triage('Tripes', [
    c('Τρύπες', 100),
    c('Tripes', 92, 'French jazz trio'),
    c('NIKE101', 92, '', 'Person'),
    c('tripes', 91, 'Mauritius based artist', 'Person'),
  ]);
  check(r.accept === null, 'a top-scored name in another script stops triage deciding');
  check(r.reason === 'uncomparable-script', 'and the reason names why', r.reason);
}

{
  /*
   * The other half of rule 6: an uncomparable candidate that is NOT winning
   * must not block a decision. Otherwise one stray Greek entry in a candidate
   * list would send every row to the queue.
   */
  const r = triage('Steak', [
    c('Steak', 100, 'UK stoner rock band'),
    c('Τρύπες', 70),
  ]);
  check(
    r.accept?.disambiguation === 'UK stoner rock band',
    'a low-scored uncomparable candidate does not block the decision',
    r.reason,
  );
}

{
  /*
   * And the third case, which the first version of rule 6 got wrong: a name
   * that is entirely non-Latin and has exactly ONE candidate is not a contest
   * at all. 芳野藤丸 returns a single act and is plainly that artist.
   * Refusing it would have queued every Japanese and Greek name forever.
   */
  const r = triage('芳野藤丸', [c('芳野藤丸', 100, '', 'Person')]);
  check(r.accept?.name === '芳野藤丸', 'a sole candidate in another script is still accepted');
}

{
  // "The" carries real information: Sword and The Sword are different bands.
  const r = triage('Evesdroppers', [c('The Evesdroppers', 100)]);
  check(r.accept === null, 'a leading "The" is not stripped: it can be a different band');
  check(r.reason === 'no-exact-match', 'and the row goes to a human', r.reason);
}

{
  // A longer name is not a nickname. There is no musician called Colbey Parker.
  const r = triage('Colbey', [c('Colbey Parker', 100)]);
  check(r.accept === null, 'a longer name is not the same artist');
}

{
  const r = triage('Spindrift', [
    c('Spindrift', 100, 'psychedelic western band from California'),
    c('Spindrift', 99, "70's US psychedelic rock band"),
    c('Spindrift', 98, 'Swedish electronic artist Leo Bergman'),
    c('Spindrift', 97, 'alternative rock band from Germany'),
    c('Spindrift', 96, 'Canadian indie band'),
  ]);
  check(r.accept === null, 'five identically spelled bands stay for a human');
}

{
  check(triage('Anything', []).reason === 'no-candidates', 'an empty candidate list decides nothing');
}

console.log('\n# normalisation');

check(normalizeForMatch('GRENADE') === normalizeForMatch('Grenade'), 'case is ignored');
check(normalizeForMatch('Yamê') === normalizeForMatch('YAME'), 'accents are ignored');
check(normalizeForMatch('The .Shrine') === normalizeForMatch('The Shrine'), 'punctuation is ignored');
/*
 * Deliberately different from normalizeName in ./normalize.ts, which strips
 * leading articles for the listing matcher. Here the article is information.
 */
check(
  normalizeForMatch('The Sword') !== normalizeForMatch('Sword'),
  'a leading article is NOT stripped, unlike the listing matcher',
);

console.log(failed === 0 ? '\nall triage checks passed' : `\ntriage: ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
