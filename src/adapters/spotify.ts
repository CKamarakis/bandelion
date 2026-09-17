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

// ─── Liked songs ────────────────────────────────────────────────────────────

/**
 * Liked Songs is a second list of artists, and /me/tracks is the only door.
 *
 * It has no playlist id, so `GET /playlists/{id}` cannot reach it
 * (spotify/web-api#1417), and /me/tracks takes no `fields` parameter, so the
 * response cannot be slimmed either. 50 per page is the cap; a 2,000-song
 * library is ~42 calls and there is no cheaper shape available.
 *
 * Artist ids and names arrive nested in the track objects, so this needs no
 * per-artist follow-up — which matters more than usual here, because the batch
 * `GET /artists?ids=` is gone (measured: 403 on an allowlisted token) and the
 * fallback would be one call per artist.
 */

/** Spotify's cap for /me/tracks. Same 50 as /me/following. */
const LIKED_PAGE_LIMIT = 50;

export const FIRST_LIKED_PAGE = `${API}/me/tracks?limit=${LIKED_PAGE_LIMIT}`;

/** An artist as it appears nested in a track: id and name, nothing more. */
interface SimplifiedArtist {
  id?: string;
  name?: string;
}

interface SpotifyTrack {
  id?: string;
  name?: string;
  artists?: SimplifiedArtist[];
  album?: { artists?: SimplifiedArtist[] };
}

export interface LikedArtistRef {
  name: string;
  externalId: string;
}

export interface LikedPage {
  artists: LikedArtistRef[];
  /** Tracks read on this page, whether or not they yielded a new artist. */
  tracksSeen: number;
  /**
   * Album-artist credits dropped because they perform no track here.
   * Counted rather than discarded silently: a number that turns out large
   * means the rule is wrong, and a silent drop would never reveal that.
   */
  dropped: number;
  next: string | null;
  total: number | null;
  complete: boolean;
  error?: string;
}

/**
 * The artists credited on one track.
 *
 * Track artists always count: every name on a song you liked is an artist you
 * liked. Album artists count only when they also perform a track here, which
 * is the ordinary case for a normal album and excludes the ones that are not
 * acts at all — "Various Artists" on a compilation, a label or a curator on a
 * DJ mix. Those cannot be defined as an artist, so they are dropped.
 *
 * Doing it by intersection rather than by blocklist means there is no id to
 * maintain, and a curator nobody has heard of is handled the same as the one
 * famous placeholder.
 */
export function artistsOnTrack(track: SpotifyTrack): {
  artists: LikedArtistRef[];
  dropped: number;
} {
  const artists: LikedArtistRef[] = [];
  const performing = new Set<string>();

  for (const artist of track.artists ?? []) {
    if (!artist?.id || !artist?.name) continue;
    performing.add(artist.id);
    artists.push({ name: artist.name, externalId: artist.id });
  }

  let dropped = 0;
  for (const artist of track.album?.artists ?? []) {
    if (!artist?.id || !artist?.name) continue;
    if (performing.has(artist.id)) continue;
    dropped++;
  }

  return { artists, dropped };
}

/**
 * One page of liked songs.
 *
 * Same contract as `fetchRosterPage`: never throws, reports `complete: false`
 * with the error rather than an empty-looking success. A confidently empty
 * library is the bug class this whole adapter is written against.
 */
export async function fetchLikedPage(opts: {
  accessToken: string;
  /** Omit to start at the beginning. */
  url?: string;
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
}): Promise<LikedPage> {
  const doFetch = opts.fetchImpl ?? fetch;
  const empty = { artists: [], tracksSeen: 0, dropped: 0, next: null, total: null };

  try {
    const res = await doFetch(opts.url ?? FIRST_LIKED_PAGE, {
      headers: { Authorization: `Bearer ${opts.accessToken}` },
      signal: opts.signal,
    });

    if (!res.ok) {
      return { ...empty, complete: false, error: await describeApiError(res) };
    }

    const json = (await res.json()) as {
      items?: { track?: SpotifyTrack }[];
      next?: string | null;
      total?: number;
    };

    if (!json?.items) {
      return {
        ...empty,
        complete: false,
        error: 'unexpected response shape from /me/tracks (no items)',
      };
    }

    const artists: LikedArtistRef[] = [];
    let dropped = 0;
    let tracksSeen = 0;

    for (const item of json.items) {
      // A removed or unavailable track arrives as a null `track`. Not an
      // error, just nothing to read.
      if (!item?.track) continue;
      tracksSeen++;
      const credited = artistsOnTrack(item.track);
      artists.push(...credited.artists);
      dropped += credited.dropped;
    }

    return {
      artists,
      tracksSeen,
      dropped,
      next: json.next ?? null,
      total: typeof json.total === 'number' ? json.total : null,
      complete: true,
    };
  } catch (err) {
    return { ...empty, complete: false, error: errorMessage(err) };
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
