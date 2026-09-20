/**
 * Triage: deciding which name-search candidates are worth accepting alone.
 *
 * The resolve job auto-accepts nothing from a name search, which is the right
 * default — a confident top score is exactly how two different bands end up
 * sharing an identity (decision 034). But measured on a real roster that put
 * **264 artists** in the review queue, and reading their payloads, **188 of
 * them had one exact-named candidate and nothing competing**. The queue was
 * recording the absence of a rule, not doubt.
 *
 * These rules came from reading the queue by hand. Each one is here because a
 * real row demanded it, and each is written to fail toward the human: when a
 * rule cannot decide, the row keeps its place in the queue.
 *
 * ## The rules, and the row that produced each
 *
 * 1. **A candidate must have the same word count.** MusicBrainz answers
 *    "GRENADE" with `Daisy Grenade` and `Hate Grenade`, and "Steak" with
 *    `Monkey Steak` and `Chuck Steak`. A band does not have a different number
 *    of words in its name.
 *
 * 2. **The name must match exactly after normalisation.** Anything less is a
 *    different band with a similar name.
 *
 * 3. **Exact spelling breaks a tie.** `The IronY` beats `The Irony`; `GRENADE`
 *    beats two acts called `Grenade`. Bands choose odd capitalisation to be
 *    identifiable, so when normalisation leaves several candidates and exactly
 *    one reproduces the spelling, that one is the artist.
 *
 * 4. **A collaboration credit is not either artist.** MusicBrainz files
 *    `Giannis Aggelakas x Nikos Veliotis` as its own artist, and it is the
 *    answer to neither name alone. Note the rule reads the SIDES, not the
 *    letter: `Terror X Crew` is a real band on this roster whose name contains
 *    an x, and it must still match itself.
 *
 * 5. **Non-musical entities are never the artist.** MusicBrainz types its
 *    entries, and `Mr. Dinkles` comes back twice: a Seattle rock band
 *    (`Group`) and a Trolls character (`Character`). Reading the structured
 *    type beats parsing the free-text description.
 *
 * ## What is deliberately NOT a rule
 *
 * **Stripping a leading "The".** `Evesdroppers` is `The Evesdroppers`, but
 * `Sword` and `The Sword` are different bands. The article carries real
 * information some of the time, so those rows go to a human rather than to a
 * guess. Same for `Colbey`, whose only candidate is `Colbey Parker`: a longer
 * name is not a nickname.
 */

/** One MusicBrainz act, as the search returns it. */
export interface Candidate {
  mbid: string;
  name: string;
  score: number;
  disambiguation: string;
  /**
   * MusicBrainz's own entity type: Group, Person, Character, Orchestra, Choir.
   * Optional because rows queued before this field was captured do not carry
   * it, and an absent type must not be read as a disqualifying one.
   */
  type?: string;
}

/**
 * Types that are never the artist you follow.
 *
 * Lowercased on comparison. An entry with no type at all passes: MusicBrainz
 * leaves it blank often enough that treating absence as disqualifying would
 * reject real bands.
 */
const NON_MUSICAL = new Set(['character', 'fictional character']);

/** Words in a name, by whitespace. */
const wordCount = (name: string) => name.trim().split(/\s+/).length;

/**
 * Is `candidate` a collaboration credit that includes `raw` as one side?
 *
 * Reads the sides rather than the separator, so a band whose name simply
 * contains an x keeps matching itself. `Terror X Crew` splits to
 * ["Terror", "Crew"], neither of which equals "Terror X Crew", so it is not
 * treated as a collaboration.
 */
export function isCollabCredit(raw: string, candidateName: string): boolean {
  const parts = candidateName.split(/\s+[x×]\s+/i);
  if (parts.length < 2) return false;
  const target = normalizeForMatch(raw);
  return parts.some((p) => normalizeForMatch(p) === target);
}

/**
 * The comparison form: case, accents and punctuation removed.
 *
 * Deliberately NOT `normalizeName` from ./normalize.ts. That one also strips
 * bracketed suffixes and leading articles for the listing matcher, and here an
 * article is information — "The Sword" and "Sword" must stay distinguishable.
 */
export function normalizeForMatch(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]/g, '');
}

export interface TriageResult {
  /** The candidate to accept, or null when a human should decide. */
  accept: Candidate | null;
  /** Why, for the log and for the tests. Never shown to a user. */
  reason:
    | 'sole-exact-match'
    | 'exact-spelling-tiebreak'
    | 'no-exact-match'
    | 'ambiguous'
    | 'uncomparable-script'
    | 'no-candidates';
}

/**
 * Decide one queued row.
 *
 * Order matters: filters narrow the field, then the match test runs, then the
 * tiebreak. Every path that cannot decide returns `accept: null`, which leaves
 * the row exactly where it was.
 */
export function triage(rawName: string, candidates: Candidate[]): TriageResult {
  if (candidates.length === 0) return { accept: null, reason: 'no-candidates' };

  // Rule 5, then rule 4. Both remove candidates that cannot be this artist
  // whatever else is true of them.
  let pool = candidates.filter((c) => !NON_MUSICAL.has((c.type ?? '').toLowerCase()));
  pool = pool.filter((c) => !isCollabCredit(rawName, c.name));

  /*
   * Rule 1, but never to the point of emptying the list.
   *
   * A row whose only candidates differ in length ("Evesdroppers" ->
   * "The Evesdroppers") must still reach a human with something to look at.
   * Falling back to the unfiltered pool costs nothing: the exact-match test
   * below rejects it anyway, so the row goes to the queue either way.
   */
  const sameLength = pool.filter((c) => wordCount(c.name) === wordCount(rawName));
  if (sameLength.length > 0) pool = sameLength;

  /*
   * Rule 6, and it exists because rules 1-5 got Tripes wrong in production.
   *
   * `normalizeForMatch` keeps only [a-z0-9], so a name in Greek or Cyrillic
   * normalises to the EMPTY STRING — it cannot match anything and cannot be
   * compared. The alias query correctly returned Τρύπες top at score 100, and
   * triage then discarded it as "not an exact match" and accepted a French
   * jazz trio scoring 92 instead, with full confidence.
   *
   * So when a candidate outscores every comparable one but cannot be compared,
   * triage has no business deciding. It is precisely the case where
   * MusicBrainz knows something the rules cannot read.
   */
  const target = normalizeForMatch(rawName);
  const uncomparable = pool.filter((c) => normalizeForMatch(c.name) === '' && c.name.trim() !== '');
  const comparableTop = Math.max(
    0,
    ...pool.filter((c) => normalizeForMatch(c.name) !== '').map((c) => c.score),
  );
  /*
   * Only when it is a CONTEST. A sole candidate in another script is not
   * ambiguous — 芳野藤丸 returns exactly one act and is plainly that artist,
   * and refusing it would queue every non-Latin name forever. The danger is
   * only ever an uncomparable candidate outscoring a comparable rival, which
   * is the shape Tripes had.
   */
  if (comparableTop > 0 && uncomparable.some((c) => c.score >= comparableTop)) {
    return { accept: null, reason: 'uncomparable-script' };
  }
  if (uncomparable.length === 1 && pool.length === 1) {
    return { accept: uncomparable[0]!, reason: 'sole-exact-match' };
  }

  // Rule 2. Without an exact name there is nothing here worth accepting.
  const exact = pool.filter((c) => normalizeForMatch(c.name) === target);

  if (exact.length === 0) return { accept: null, reason: 'no-exact-match' };
  if (exact.length === 1) return { accept: exact[0]!, reason: 'sole-exact-match' };

  // Rule 3. Several acts share the name; the one that reproduces the spelling
  // is the one the artist chose to be findable by.
  const spelled = exact.filter((c) => c.name === rawName);
  if (spelled.length === 1) {
    return { accept: spelled[0]!, reason: 'exact-spelling-tiebreak' };
  }

  // Steak, Spindrift, Ataxia. Genuinely two or more bands with one name.
  return { accept: null, reason: 'ambiguous' };
}
