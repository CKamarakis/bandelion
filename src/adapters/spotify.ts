/**
 * Spotify: the roster source.
 *
 * Supplies followed artists. Releases come from a separate pass later — this
 * adapter answers "who do I care about", which is the input everything else
 * needs.
 *
 * Two constraints from CLAUDE.md shape this file:
 *
 *  - `GET /artists` (batch) was removed in Feb 2026. Artists are fetched one at
 *    a time, so the local cache is load-bearing. This adapter therefore reads
 *    everything it can out of /me/following, which still returns full artist
 *    objects, and never does a per-artist follow-up.
 *  - `fetch` never throws. A failure returns `complete: false` and whatever
 *    pages already succeeded, so a network blip mid-roster degrades to a
 *    partial roster rather than an empty one.
 */

import type {
  FetchContext,
  FetchResult,
  SourceAdapter,
  RawArtistRef,
} from './types.ts';

const API = 'https://api.spotify.com/v1';

/** Spotify's cap for this endpoint. Asking for more is a 400. */
const PAGE_LIMIT = 50;

/**
 * A followed artist, as this adapter reports them.
 *
 * The roster is not an event, so it does not go through NormalizedEvent. The
 * ingest job writes these into `artists` + `user_artists` directly.
 */
export interface RosterEntry extends RawArtistRef {
  imageUrl: string | null;
  genres: string[];
  popularity: number | null;
}

export interface RosterResult {
  artists: RosterEntry[];
  complete: boolean;
  error?: string;
}

interface SpotifyArtist {
  id: string;
  name: string;
  images?: { url: string; width: number; height: number }[];
  genres?: string[];
  popularity?: number;
}

/** The first page's URL. Exported so a job can start a run without knowing it. */
export const FIRST_ROSTER_PAGE = `${API}/me/following?type=artist&limit=${PAGE_LIMIT}`;

export interface RosterPage {
  artists: RosterEntry[];
  /** The next page's URL, or null at the end of the roster. */
  next: string | null;
  /** Spotify's count of followed artists. Absent on some responses. */
  total: number | null;
  complete: boolean;
  error?: string;
}

/**
 * One page of followed artists.
 *
 * The unit a checkpointed job needs: fetch a page, write it, record the cursor,
 * repeat. Killing the container between pages costs one page, not the run.
 *
 * Never throws, for the same reason nothing else here does.
 */
export async function fetchRosterPage(opts: {
  accessToken: string;
  /** Omit to start at the beginning. */
  url?: string;
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
}): Promise<RosterPage> {
  const doFetch = opts.fetchImpl ?? fetch;
  const empty = { artists: [], next: null, total: null };

  try {
    const res = await doFetch(opts.url ?? FIRST_ROSTER_PAGE, {
      headers: { Authorization: `Bearer ${opts.accessToken}` },
      signal: opts.signal,
    });

    if (!res.ok) {
      return { ...empty, complete: false, error: await describeApiError(res) };
    }

    const json = (await res.json()) as {
      artists?: { items?: SpotifyArtist[]; next?: string | null; total?: number };
    };
    const page = json.artists;

    if (!page?.items) {
      // Shape changed. Report it rather than silently reading zero artists —
      // a confidently empty roster is the defining bug class here.
      return {
        ...empty,
        complete: false,
        error: 'unexpected response shape from /me/following (no artists.items)',
      };
    }

    const artists: RosterEntry[] = [];
    for (const item of page.items) {
      if (!item?.id || !item?.name) continue;
      artists.push(toRosterEntry(item));
    }

    return {
      artists,
      next: page.next ?? null,
      total: typeof page.total === 'number' ? page.total : null,
      complete: true,
    };
  } catch (err) {
    return { ...empty, complete: false, error: errorMessage(err) };
  }
}

/**
 * Every followed artist, following the cursor to the end.
 *
 * Built on `fetchRosterPage` so there is one implementation of the paging and
 * error handling. Convenient for a one-shot read; the ingest job walks the
 * pages itself so it can checkpoint between them.
 *
 * Never throws: a partial roster with `complete: false` is strictly better than
 * an exception, because the caller can still ingest what arrived and retry the
 * rest on the next poll.
 */
export async function fetchFollowedArtists(opts: {
  accessToken: string;
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
  /** Guard against a cursor that never terminates. 200 pages = 10k artists. */
  maxPages?: number;
}): Promise<RosterResult> {
  const artists: RosterEntry[] = [];
  const maxPages = opts.maxPages ?? 200;

  let url: string | undefined = undefined;
  let pages = 0;

  while (pages < maxPages) {
    const page = await fetchRosterPage({
      accessToken: opts.accessToken,
      url,
      fetchImpl: opts.fetchImpl,
      signal: opts.signal,
    });

    artists.push(...page.artists);

    if (!page.complete) return { artists, complete: false, error: page.error };

    pages++;
    if (!page.next) return { artists, complete: true };
    url = page.next;
  }

  return { artists, complete: false, error: `stopped after ${maxPages} pages` };
}

function toRosterEntry(item: SpotifyArtist): RosterEntry {
  return {
    name: item.name,
    externalId: item.id,
    // Largest first is Spotify's order; take it rather than sorting, since the
    // sizes are occasionally absent and a sort on undefined is a coin flip.
    imageUrl: item.images?.[0]?.url ?? null,
    genres: item.genres ?? [],
    popularity: typeof item.popularity === 'number' ? item.popularity : null,
  };
}

/**
 * Turn an HTTP failure into something a user can act on.
 *
 * 403 gets special handling because it is *the* Spotify failure for this
 * project: a development-mode app serves only allowlisted users, and everyone
 * else gets 403 on every call after a perfectly successful OAuth. Reporting
 * that as "request failed" would send someone debugging their credentials.
 */
async function describeApiError(res: Response): Promise<string> {
  let detail = '';
  try {
    const body = (await res.json()) as { error?: { message?: string } };
    detail = body?.error?.message ?? '';
  } catch {
    /* no JSON body */
  }

  if (res.status === 403) {
    return (
      'Spotify returned 403. In development mode only allowlisted users can ' +
      'call the API: add this Spotify account to your app under ' +
      'Dashboard → your app → Settings → User Management.' +
      (detail ? ` (${detail})` : '')
    );
  }
  if (res.status === 401) {
    return 'Spotify returned 401: the access token is invalid or expired.';
  }
  if (res.status === 429) {
    const retry = res.headers.get('retry-after');
    return `Spotify rate limit hit${retry ? `; retry after ${retry}s` : ''}.`;
  }
  return `Spotify API error ${res.status}${detail ? `: ${detail}` : ''}`;
}

const errorMessage = (err: unknown): string =>
  err instanceof Error ? err.message : String(err);

/**
 * The adapter registration.
 *
 * `fetch` returns no events: Spotify's contribution at this stage is the
 * roster, which the ingest job reads via `fetchFollowedArtists` directly. The
 * adapter exists so Spotify appears in `adapter_health` alongside everything
 * else — a broken roster source must be visible in the same place as a broken
 * gig source.
 */
export const spotifyAdapter: SourceAdapter = {
  id: 'spotify',
  kind: ['roster', 'release'],
  trust: 'official',
  label: 'Spotify',

  enabled(env) {
    return Boolean(env.SPOTIFY_CLIENT_ID?.trim() && env.SPOTIFY_CLIENT_SECRET?.trim());
  },

  async fetch(ctx: FetchContext): Promise<FetchResult> {
    const token = ctx.credentials?.accessToken;
    if (!token) {
      return { events: [], complete: false, error: 'no Spotify access token: connect an account first' };
    }
    // Releases land in a later phase. `complete: true` with no events would
    // claim Spotify said there is nothing, which is not what happened.
    return { events: [], complete: false, error: 'Spotify release fetching is not implemented yet' };
  },
};
