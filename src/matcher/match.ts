/**
 * Matching a name on a listing page to an artist on your roster.
 *
 * This is the recurring hard problem in Bandelion. Event sources are swept by
 * city, so every gig arrives as a string like "Motoerhead + Girlschool" that
 * has to be resolved against thousands of followed artists.
 *
 * The asymmetry that shapes everything here: a false match is worse than a
 * miss. A missed gig is a gig you might have found elsewhere; a false match
 * puts a stranger's show in your feed and teaches you not to trust it. So the
 * tiers are ordered by certainty and the fuzzy tier is deliberately timid.
 */

import { normalizeName, foldedKey, similarity } from './normalize.ts';
import type { RosterArtist } from '../adapters/types.ts';

export type MatchTier = 'exact' | 'alias' | 'folded' | 'fuzzy' | 'none';

export interface MatchResult {
  artistId: number | null;
  confidence: number;
  tier: MatchTier;
  /** Set when the fuzzy tier found something short of certainty. */
  candidateArtistId?: number;
}

/**
 * Above this a fuzzy match goes straight to the feed; between this and
 * REVIEW_THRESHOLD it goes to the review queue; below, it is dropped and
 * logged.
 *
 * 0.92 is high on purpose. Trigram similarity treats "Girl"/"Girls" as ~0.8,
 * and those are different bands.
 */
export const AUTO_THRESHOLD = 0.92;
export const REVIEW_THRESHOLD = 0.7;

/**
 * Short names cannot be fuzzy-matched safely: at four characters, a single
 * letter of difference is a different band ("Low" vs "Lowlife"), but trigram
 * similarity still reads high. Exact and alias tiers only.
 */
const MIN_FUZZY_LENGTH = 6;

export interface MatcherIndex {
  byNormalized: Map<string, number>;
  byAlias: Map<string, number>;
  /**
   * Umlaut-folded key to artist id. Ambiguous keys are removed rather than
   * resolved: if two roster artists fold to the same string, folding cannot
   * tell them apart and must not guess.
   */
  byFolded: Map<string, number>;
  /** Normalised name to artist id, for the fuzzy scan. */
  all: { normalized: string; artistId: number }[];
}

export function buildIndex(
  roster: RosterArtist[],
  aliases: { artistId: number; aliasNormalized: string }[] = [],
): MatcherIndex {
  const byNormalized = new Map<string, number>();
  const all: { normalized: string; artistId: number }[] = [];

  for (const a of roster) {
    const n = a.nameNormalized || normalizeName(a.name);
    // First writer wins: two roster artists normalising alike is rare, and
    // silently overwriting would make matches depend on roster order.
    if (!byNormalized.has(n)) byNormalized.set(n, a.artistId);
    all.push({ normalized: n, artistId: a.artistId });
  }

  // Build folded keys, dropping any that collide. A collision means the fold
  // lost the distinction, so trusting it would be a coin flip.
  const foldCounts = new Map<string, number[]>();
  for (const a of roster) {
    const f = foldedKey(a.name);
    if (!f) continue;
    const ids = foldCounts.get(f) ?? [];
    if (!ids.includes(a.artistId)) ids.push(a.artistId);
    foldCounts.set(f, ids);
  }
  const byFolded = new Map<string, number>();
  for (const [key, ids] of foldCounts) {
    if (ids.length === 1) byFolded.set(key, ids[0]);
  }

  const byAlias = new Map<string, number>();
  for (const al of aliases) byAlias.set(al.aliasNormalized, al.artistId);

  return { byNormalized, byAlias, byFolded, all };
}

/**
 * Resolve one raw name.
 *
 * `tier` is returned alongside confidence because the two are not
 * interchangeable: an exact match and a 1.0-scoring fuzzy match mean different
 * things, and only the former should ever write an alias.
 */
export function matchArtist(rawName: string, index: MatcherIndex): MatchResult {
  const normalized = normalizeName(rawName);

  if (!normalized || normalized.length < 2) {
    return { artistId: null, confidence: 0, tier: 'none' };
  }

  // Tier 1: exact on the normalised form.
  const exact = index.byNormalized.get(normalized);
  if (exact !== undefined) {
    return { artistId: exact, confidence: 1, tier: 'exact' };
  }

  // Tier 2: a decision someone already made, in the review queue.
  const alias = index.byAlias.get(normalized);
  if (alias !== undefined) {
    return { artistId: alias, confidence: 1, tier: 'alias' };
  }

  // Tier 3: umlaut folding. "Motorhead" and "Motoerhead" both reach the same
  // key as "Motörhead". Confidence just short of 1: the fold is lossy, and an
  // exact match should still outrank it if both are somehow available.
  const folded = index.byFolded.get(foldedKey(rawName));
  if (folded !== undefined) {
    return { artistId: folded, confidence: 0.97, tier: 'folded' };
  }

  // Tier 4: fuzzy, and only for names long enough for it to mean anything.
  if (normalized.length < MIN_FUZZY_LENGTH) {
    return { artistId: null, confidence: 0, tier: 'none' };
  }

  let best = { artistId: 0, score: 0 };
  for (const entry of index.all) {
    if (entry.normalized.length < MIN_FUZZY_LENGTH) continue;

    // A name containing another as a substring is the classic false positive:
    // "Ministry of Sound" contains "Ministry". Require comparable length before
    // trusting similarity at all.
    const ratio =
      Math.min(normalized.length, entry.normalized.length) /
      Math.max(normalized.length, entry.normalized.length);
    if (ratio < 0.75) continue;

    const score = similarity(normalized, entry.normalized);
    if (score > best.score) best = { artistId: entry.artistId, score };
  }

  if (best.score >= AUTO_THRESHOLD) {
    return { artistId: best.artistId, confidence: best.score, tier: 'fuzzy' };
  }
  if (best.score >= REVIEW_THRESHOLD) {
    return {
      artistId: null,
      confidence: best.score,
      tier: 'fuzzy',
      candidateArtistId: best.artistId,
    };
  }

  return { artistId: null, confidence: best.score, tier: 'none' };
}
