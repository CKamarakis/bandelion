/**
 * MusicBrainz: identity, and later releases.
 *
 * This file resolves a roster artist to an MBID, which is the join key
 * everything downstream needs. Releases come from the same source in a later
 * phase (decision 033).
 *
 * The resolution strategy is not name search. Two artists on the real roster
 * are called WITCH and two are called Pentagram, and a name query for either
 * returns byte-identical results — MusicBrainz's own top hit for "Witch" is the
 * Zambian zamrock band whichever one you asked about. Taking the top score
 * would confidently give both roster rows the same MBID and merge two bands.
 *
 * Instead we ask MusicBrainz the reverse question: "which artist do you have
 * for this Spotify URL?" That is an exact join through a relation someone has
 * already curated, not a similarity guess. Measured on the ambiguous pairs it
 * resolved 9/9 to 9 distinct MBIDs.
 *
 * Name search stays as a fallback for artists with no Spotify URL relation,
 * but its results go to the review queue rather than being written directly.
 */

import type { FetchContext, FetchResult, SourceAdapter } from './types.ts';

const WS = 'https://musicbrainz.org/ws/2';

/**
 * MusicBrainz asks for one request per second per IP.
 *
 * Measured: pacing is not actually what triggers throttling — search shares a
 * congested cluster and 503s regardless, while browse and lookup are fine (see
 * decision 033). We still pace, because it is what they ask for and this job is
 * not in a hurry.
 */
export const MIN_INTERVAL_MS = 1100;

/** How the MBID was arrived at. Stored so a bad tier can be re-run later. */
export type ResolutionMethod = 'spotify-url' | 'name-search' | 'none';

export interface Resolution {
  mbid: string | null;
  mbName: string | null;
  method: ResolutionMethod;
  /** Populated only for name-search: the candidates a human should judge. */
  candidates?: { mbid: string; name: string; score: number; disambiguation: string }[];
  error?: string;
}

interface MbRelation {
  type?: string;
  artist?: { id?: string; name?: string };
}

interface MbArtistSearchHit {
  id?: string;
  name?: string;
  score?: number;
  disambiguation?: string;
  country?: string;
}

export interface MbClientOptions {
  /** Sent as User-Agent. MusicBrainz blocks requests without a real one. */
  contact: string;
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
  /** Overridable so tests do not sleep. */
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export class MusicBrainzError extends Error {}

/** Node wraps socket failures, so the useful text is often on `cause`. */
function errorText(err: unknown): string {
  if (!(err instanceof Error)) return String(err);
  const cause = (err as { cause?: { code?: string } }).cause;
  return cause?.code ? `${err.message} (${cause.code})` : err.message;
}

/**
 * One GET, with 503 retry.
 *
 * MusicBrainz returns a **JSON body** on 503 ("currently busy"), so a caller
 * that parses before checking status reads a throttled response as an empty
 * result. That already caused a "0 of 38 release-groups" misreading during
 * probing, which is why status is checked first and 503 is retried rather than
 * returned.
 */
async function get(
  path: string,
  opts: MbClientOptions,
  attempts = 8,
): Promise<unknown | null> {
  const doFetch = opts.fetchImpl ?? fetch;
  const sleep = opts.sleep ?? defaultSleep;

  for (let attempt = 0; attempt < attempts; attempt++) {
    let res: Response;
    try {
      res = await doFetch(`${WS}/${path}`, {
        headers: { 'User-Agent': opts.contact, Accept: 'application/json' },
        signal: opts.signal,
      });
    } catch (err) {
      /*
       * A dropped connection is not an answer.
       *
       * MusicBrainz closed the socket mid-request several times while probing
       * (UND_ERR_SOCKET, "other side closed"). Letting that propagate costs an
       * artist for a fault that a retry fixes. An aborted signal is different —
       * that is the operator stopping the job, and it must not be retried.
       */
      if (opts.signal?.aborted) throw err;
      if (attempt === attempts - 1) {
        throw new MusicBrainzError(
          `MusicBrainz unreachable after ${attempts} attempts: ${errorText(err)}`,
        );
      }
      await sleep(Math.min(1500 * 2 ** attempt, 15_000));
      continue;
    }

    // 404 is a real answer: MusicBrainz has no record of this URL. Not an error.
    if (res.status === 404) return null;

    // Any 5xx is their side having a bad moment, not a verdict about the
    // artist. 502 was seen alongside 503 in practice, and treating it as fatal
    // reported an artist absent when the server had simply fallen over.
    if (res.status >= 500) {
      /*
       * Their throttle, not ours. Unlike Spotify's daily quota, retrying works.
       *
       * Measured (decision 033): the search cluster 503s in bursts regardless
       * of our pacing — a 10-request run scored 4/10 and 9/10 on two identical
       * passes. Four attempts gave up on a live roster run while MusicBrainz
       * was merely busy, so this is deliberately patient: exponential, capped
       * at 15s, worst case about a minute before the artist is reported failed.
       */
      await sleep(Math.min(1500 * 2 ** attempt, 15_000));
      continue;
    }

    if (!res.ok) {
      throw new MusicBrainzError(`MusicBrainz returned ${res.status} for ${path}`);
    }

    return res.json();
  }

  throw new MusicBrainzError(`MusicBrainz stayed busy after ${attempts} attempts: ${path}`);
}

/**
 * The MBID for a Spotify artist id, via the curated URL relation.
 *
 * Returns `method: 'none'` rather than throwing when MusicBrainz has no
 * relation for this artist — that is a normal outcome for obscure acts, and the
 * caller decides whether to fall back to name search.
 */
export async function resolveBySpotifyUrl(
  spotifyId: string,
  opts: MbClientOptions,
): Promise<Resolution> {
  const resource = `https://open.spotify.com/artist/${spotifyId}`;
  const json = (await get(
    `url?resource=${encodeURIComponent(resource)}&inc=artist-rels&fmt=json`,
    opts,
  )) as { relations?: MbRelation[] } | null;

  const rel = json?.relations?.find((r) => r.artist?.id);
  if (!rel?.artist?.id) {
    return { mbid: null, mbName: null, method: 'none' };
  }

  return {
    mbid: rel.artist.id,
    mbName: rel.artist.name ?? null,
    method: 'spotify-url',
  };
}

/**
 * Name search — the fallback, and deliberately not auto-accepted.
 *
 * Returns candidates for the review queue instead of picking one. The whole
 * reason this file prefers URL relations is that a confident top score here is
 * exactly how two different bands end up sharing an identity.
 */
export async function searchByName(
  name: string,
  opts: MbClientOptions,
  limit = 5,
): Promise<Resolution> {
  const q = encodeURIComponent(`artist:"${name.replace(/"/g, '')}"`);
  const json = (await get(`artist?query=${q}&fmt=json&limit=${limit}`, opts)) as
    | { artists?: MbArtistSearchHit[] }
    | null;

  const candidates = (json?.artists ?? [])
    .filter((a): a is MbArtistSearchHit & { id: string } => Boolean(a.id))
    .map((a) => ({
      mbid: a.id,
      name: a.name ?? '',
      score: typeof a.score === 'number' ? a.score : 0,
      disambiguation: a.disambiguation ?? '',
    }));

  return { mbid: null, mbName: null, method: 'name-search', candidates };
}

/** URL relations for an artist, for `artist_links`. Best-effort by design. */
export async function fetchArtistLinks(
  mbid: string,
  opts: MbClientOptions,
): Promise<{ kind: string; url: string }[]> {
  const json = (await get(`artist/${mbid}?inc=url-rels&fmt=json`, opts)) as
    | { relations?: { type?: string; url?: { resource?: string } }[] }
    | null;

  const out: { kind: string; url: string }[] = [];
  for (const rel of json?.relations ?? []) {
    const url = rel.url?.resource;
    if (!url) continue;
    out.push({ kind: classifyLink(rel.type ?? '', url), url });
  }
  return out;
}

/**
 * Map a MusicBrainz relation to the `artist_links.kind` vocabulary.
 *
 * Matched on the URL host rather than the relation type, because MusicBrainz
 * files Bandcamp, Instagram and TikTok all under generic types ("social
 * network", "free streaming") that do not distinguish them.
 */
export function classifyLink(relType: string, url: string): string {
  let host = '';
  try {
    host = new URL(url).host.replace(/^www\./, '').toLowerCase();
  } catch {
    return 'other';
  }

  if (host.endsWith('bandcamp.com')) return 'bandcamp';
  if (host.endsWith('instagram.com')) return 'instagram';
  if (host.endsWith('tiktok.com')) return 'tiktok';
  if (host.endsWith('youtube.com') || host === 'youtu.be') return 'youtube';
  if (host.endsWith('soundcloud.com')) return 'soundcloud';
  if (host.endsWith('spotify.com')) return 'spotify';
  if (relType === 'official homepage') return 'website';
  return 'other';
}

/**
 * The adapter registration.
 *
 * Enabled on a contact address rather than a key: MusicBrainz has no API key,
 * but it does require a real User-Agent, and an instance that has not set one
 * should be visibly disabled rather than quietly rude.
 */
export const musicbrainzAdapter: SourceAdapter = {
  id: 'musicbrainz',
  kind: ['enrichment', 'release'],
  trust: 'official',
  label: 'MusicBrainz',

  enabled(env) {
    return Boolean(env.MUSICBRAINZ_CONTACT?.trim());
  },

  async fetch(_ctx: FetchContext): Promise<FetchResult> {
    // Releases land in the next phase. `complete: true` with no events would
    // claim MusicBrainz said there is nothing, which is not what happened.
    return {
      events: [],
      complete: false,
      error: 'MusicBrainz release fetching is not implemented yet',
    };
  },
};
