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

/**
 * Every followed artist, following the cursor to the end.
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
  const doFetch = opts.fetchImpl ?? fetch;
  const artists: RosterEntry[] = [];
  const maxPages = opts.maxPages ?? 200;

  let url: string | null = `${API}/me/following?type=artist&limit=${PAGE_LIMIT}`;
  let pages = 0;

  try {
    while (url && pages < maxPages) {
      const res = await doFetch(url, {
        headers: { Authorization: `Bearer ${opts.accessToken}` },
        signal: opts.signal,
      });

      if (!res.ok) {
        return {
          artists,
          complete: false,
          error: await describeApiError(res),
        };
      }

      const json = (await res.json()) as {
        artists?: { items?: SpotifyArtist[]; next?: string | null };
      };
      const page = json.artists;
      if (!page?.items) {
        // Shape changed. Report it rather than silently reading zero artists —
        // a confidently empty roster is the defining bug class here.
        return {
          artists,
          complete: false,
          error: 'unexpected response shape from /me/following (no artists.items)',
        };
      }

      for (const item of page.items) {
        if (!item?.id || !item?.name) continue;
        artists.push(toRosterEntry(item));
      }

      url = page.next ?? null;
      pages++;
    }

    if (url) {
      return { artists, complete: false, error: `stopped after ${maxPages} pages` };
    }
    return { artists, complete: true };
  } catch (err) {
    return { artists, complete: false, error: errorMessage(err) };
  }
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
