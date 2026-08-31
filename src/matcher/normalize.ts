/**
 * Artist name normalisation.
 *
 * Every match starts here, so this file decides how good matching can get. It
 * is deliberately conservative: normalisation that is too aggressive collapses
 * genuinely different artists together, and a false match puts a stranger's gig
 * in your feed, which is worse than missing one.
 *
 * German handling matters more than usual: Motörhead, Einstürzende Neubauten,
 * Blumfeld. Umlauts arrive transliterated (oe/ue/ae), stripped (o/u/a), or
 * intact, depending on which source typed them.
 */

/** Suffixes venues and ticket sites append. Not part of the name. */
const NOISE_SUFFIXES = [
  'live',
  'live in concert',
  'in concert',
  'tour',
  'dj set',
  'djset',
  'the concert',
  'open air',
  'w support',
  'support',
  'and guests',
  'guests',
  'plus guests',
];

/**
 * Leading articles. Dropped because sources disagree constantly: "The Notwist"
 * and "Notwist" are the same band, and only one of them is on your Spotify
 * roster.
 */
const LEADING_ARTICLES = ['the ', 'die ', 'der ', 'das ', 'les ', 'la ', 'le '];

/**
 * German umlaut transliteration, applied before accent stripping.
 *
 * Order matters: ö → oe must happen before the generic accent-strip turns ö
 * into o, because German convention is oe and a source that typed "Motoerhead"
 * must match one that typed "Motörhead".
 */
const UMLAUTS: [RegExp, string][] = [
  [/ä/g, 'ae'],
  [/ö/g, 'oe'],
  [/ü/g, 'ue'],
  [/ß/g, 'ss'],
];

/**
 * The canonical form used for exact-match lookups and stored in
 * `artists.name_normalized`.
 *
 * Two names normalising to the same string are treated as the same artist by
 * tier 1 of the matcher, so this must not over-collapse.
 */
export function normalizeName(input: string): string {
  let s = input.toLowerCase().trim();

  // Strip anything parenthesised or bracketed: "(Live)", "[DE]", "(support)".
  s = s.replace(/[([{][^)\]}]*[)\]}]/g, ' ');

  for (const [re, sub] of UMLAUTS) s = s.replace(re, sub);

  // Decompose and drop remaining diacritics: Sigur Rós → sigur ros.
  s = s.normalize('NFD').replace(/[̀-ͯ]/g, '');

  // & and + are written both ways by different sources.
  s = s.replace(/\s*&\s*/g, ' and ').replace(/\s*\+\s*/g, ' and ');

  // Punctuation to spaces. Keeps "Godspeed You! Black Emperor" intact as words.
  s = s.replace(/[^\p{L}\p{N}\s]/gu, ' ');

  s = s.replace(/\s+/g, ' ').trim();

  for (const article of LEADING_ARTICLES) {
    if (s.startsWith(article)) {
      s = s.slice(article.length);
      break;
    }
  }

  // Trailing noise, repeatedly: "Band live in concert" → "band".
  let changed = true;
  while (changed) {
    changed = false;
    for (const suffix of NOISE_SUFFIXES) {
      if (s.endsWith(' ' + suffix)) {
        s = s.slice(0, -(suffix.length + 1)).trim();
        changed = true;
      }
    }
  }

  return s.replace(/\s+/g, ' ').trim();
}

/**
 * Split a billing string into individual acts.
 *
 * Listing pages write lineups a dozen ways: "A + B", "A w/ B", "A, B & C",
 * "A presents B". Getting this wrong in either direction is costly — a missed
 * split loses a support act, an over-eager one invents a band called "Guests".
 *
 * Returns headliner first, on the convention that sources list them that way.
 */
export function splitLineup(input: string): string[] {
  // Punctuation separators need no leading space: lineups are written "A, B"
  // and "A/B" as often as "A , B". Word separators DO need surrounding space,
  // or "Bandit" would split on the "and" inside it.
  const separators =
    /\s*(?:,|·|\/|\||\+|&)\s*|\s+(?:w\/|with|feat\.?|featuring|und|and|supported by|support:)\s+/gi;

  const parts = input
    .split(separators)
    .map((p) => p.trim())
    .filter(Boolean)
    // Placeholders, not bands.
    .filter((p) => !/^(guests?|support|special guests?|tba|tbc|more|others?)$/i.test(p.trim()))
    .filter((p) => normalizeName(p).length > 1);

  return [...new Set(parts)];
}

/**
 * A second, more aggressive key: umlauts stripped rather than expanded.
 *
 * `normalizeName` expands ö to oe, which is correct German convention and what
 * a source writing "Motoerhead" produces. But a source that simply drops the
 * diacritic gives "Motorhead", and oe never meets o.
 *
 * So each artist gets two keys. This one collapses both spellings onto the same
 * string, at the cost of also collapsing genuinely different names — "Schön"
 * and "Schon" — which is why it is a fallback tier and never writes an alias.
 */
export function foldedKey(input: string): string {
  const expanded = normalizeName(input);
  // Undo the umlaut expansion, then strip: oe → o, ue → u, ae → a, ss → s.
  return expanded
    .replace(/oe/g, 'o')
    .replace(/ue/g, 'u')
    .replace(/ae/g, 'a')
    .replace(/ss/g, 's');
}

/**
 * Trigram similarity, 0..1. Used by the fuzzy tier only.
 *
 * Trigrams rather than Levenshtein because the common failure here is a source
 * appending or dropping a word ("Sleaford Mods" vs "Sleaford Mods DJ"), which
 * trigram overlap tolerates and edit distance punishes heavily.
 */
export function similarity(a: string, b: string): number {
  if (a === b) return 1;
  if (!a || !b) return 0;

  const trigrams = (s: string): Set<string> => {
    const padded = `  ${s} `;
    const out = new Set<string>();
    for (let i = 0; i < padded.length - 2; i++) out.add(padded.slice(i, i + 3));
    return out;
  };

  const ta = trigrams(a);
  const tb = trigrams(b);
  let shared = 0;
  for (const t of ta) if (tb.has(t)) shared++;

  return (2 * shared) / (ta.size + tb.size);
}
