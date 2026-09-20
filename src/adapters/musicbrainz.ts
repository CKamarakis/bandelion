/**
 * MusicBrainz: identity and releases.
 *
 * Two jobs, in order. It resolves a roster artist to an MBID — the join key
 * everything downstream needs — and then browses that artist's release-groups
 * for the feed. Spotify supplies neither: its album endpoint is quota-limited
 * to a daily lockout (decision 032) and carries no future-dated releases at all
 * (decision 039), so the entire lookahead lives here.
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

import type {
  FetchContext,
  FetchResult,
  NormalizedEvent,
  RawArtistRef,
  ReleaseDetails,
  SourceAdapter,
} from './types.ts';

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
  candidates?: {
    mbid: string;
    name: string;
    score: number;
    disambiguation: string;
    /** MusicBrainz entity type: Group, Person, Character. May be absent. */
    type?: string;
  }[];
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
  type?: string;
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
  /*
   * Aliases as well as the name.
   *
   * A transliterated name is not the name MusicBrainz files the band under.
   * Τρύπες is a Greek band you follow as "Tripes", and MusicBrainz holds
   * "Tripes" and "Trypes" as aliases of Τρύπες — searching `artist:` alone
   * returned a French jazz trio at score 100 and the real band nowhere, which
   * is worse than no answer because it looks like a confident one. With
   * `alias:` the band comes back top at 100.
   *
   * Costs nothing: the same one request, a longer query string.
   */
  const bare = name.replace(/"/g, '');
  const q = encodeURIComponent(`artist:"${bare}" OR alias:"${bare}"`);
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
      // MusicBrainz's own entity type. Kept because it is the only structured
      // way to tell a band from a Trolls character of the same name.
      type: a.type ?? '',
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

/* --- Releases --------------------------------------------------------------
 *
 * Browse release-groups, never search. Search paging is unstable — two
 * identical sweeps returned 1800 and 1819 distinct rows out of a claimed 2383
 * (decision 033) — and browse is also the endpoint that does not throttle.
 *
 * Release-*groups*, not releases, for two reasons. It is one call per artist
 * rather than one per pressing, and MusicBrainz already collapses editions at
 * this level: Haken's Fauna and Fauna (Deluxe Edition) are a single
 * release-group, so the territorial and format duplicates that plagued the
 * window search never appear.
 *
 * The cost is that a release-group carries no cover art and no track count —
 * those live on individual releases. Both stay null rather than invented.
 */

/** How precisely upstream knows the date. Half of all dates are not to the day. */
export type DatePrecision = 'day' | 'month' | 'year';

export interface ReleaseGroup {
  /** Release-group MBID. The novelty key: seen before or not. */
  mbid: string;
  title: string;
  /** ISO, but possibly partial: '2027', '2027-03' or '2027-03-14'. */
  firstReleaseDate: string | null;
  precision: DatePrecision | null;
  primaryType: string | null;
  secondaryTypes: string[];
  /** The verbatim record, for `payload_json`. */
  raw: unknown;
}

interface MbReleaseGroup {
  id?: string;
  title?: string;
  'first-release-date'?: string;
  'primary-type'?: string | null;
  'secondary-types'?: string[];
}

/**
 * Read precision off the string rather than trusting a separate field.
 *
 * MusicBrainz encodes it in the length: '2027', '2027-03', '2027-03-14'. A
 * year-only date must never be widened to a day — writing '2027-12-31' makes a
 * guess indistinguishable from a real date once it is in the column.
 */
export function datePrecision(date: string | null | undefined): DatePrecision | null {
  if (!date) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(date)) return 'day';
  if (/^\d{4}-\d{2}$/.test(date)) return 'month';
  if (/^\d{4}$/.test(date)) return 'year';
  return null;
}

/**
 * Map MusicBrainz's type vocabulary onto ours.
 *
 * Secondary types win over primary, because they are what the listener
 * actually cares about: "Album + Live" is a live record, and filing it as an
 * album puts a 2018 concert recording in the feed next to a new studio LP.
 */
export function classifyReleaseType(
  primary: string | null | undefined,
  secondary: string[] = [],
): ReleaseDetails['releaseType'] {
  const sec = secondary.map((s) => s.toLowerCase());
  if (sec.includes('live')) return 'live';
  if (sec.includes('compilation')) return 'compilation';
  // Remix, demo, soundtrack and DJ-mix have no home in the vocabulary and are
  // not albums in any useful sense. 'other' keeps them filterable.
  if (sec.some((s) => ['remix', 'demo', 'soundtrack', 'dj-mix', 'mixtape/street'].includes(s))) {
    return 'other';
  }

  switch ((primary ?? '').toLowerCase()) {
    case 'album':
      return 'album';
    case 'ep':
      return 'ep';
    case 'single':
      return 'single';
    case 'broadcast':
    case 'other':
      return 'other';
    default:
      return 'other';
  }
}

/**
 * Every release-group for one artist.
 *
 * Paged, because browse caps at 100 and a long discography exceeds it. Unlike
 * search, browse paging is stable, so offset is safe here.
 */
export async function fetchReleaseGroups(
  mbid: string,
  opts: MbClientOptions,
  maxPages = 10,
): Promise<ReleaseGroup[]> {
  const out: ReleaseGroup[] = [];
  let offset = 0;

  for (let page = 0; page < maxPages; page++) {
    const json = (await get(
      `release-group?artist=${mbid}&fmt=json&limit=100&offset=${offset}`,
      opts,
    )) as { 'release-groups'?: MbReleaseGroup[]; 'release-group-count'?: number } | null;

    const groups = json?.['release-groups'];
    if (!groups) break;

    for (const g of groups) {
      if (!g.id || !g.title) continue;
      const date = g['first-release-date'] ?? null;
      out.push({
        mbid: g.id,
        title: g.title,
        firstReleaseDate: date,
        precision: datePrecision(date),
        primaryType: g['primary-type'] ?? null,
        secondaryTypes: g['secondary-types'] ?? [],
        raw: g,
      });
    }

    const total = json?.['release-group-count'] ?? out.length;
    offset += groups.length;
    if (groups.length === 0 || out.length >= total) break;
  }

  return out;
}

/**
 * Is this release-group inside the window we care about?
 *
 * Year-only dates are deliberately exempt from the upper bound. "2027" cannot
 * be placed on a two-month timeline, and excluding it would silently drop an
 * announced record; including it as if it were dated would be a lie. It is
 * admitted, and its precision travels with it so the UI can say "2027".
 */
export function inReleaseWindow(
  group: Pick<ReleaseGroup, 'firstReleaseDate' | 'precision'>,
  window: { from: string; to: string },
): boolean {
  const { firstReleaseDate: date, precision } = group;
  if (!date) return false;

  if (precision === 'year') {
    // Compare years only: a 2027 record is "coming", a 2019 one is history.
    return date >= window.from.slice(0, 4) && date <= window.to.slice(0, 4);
  }
  if (precision === 'month') {
    return date >= window.from.slice(0, 7) && date <= window.to.slice(0, 7);
  }
  return date >= window.from && date <= window.to;
}

/**
 * Turn a release-group into the event the ingest job writes.
 *
 * `isUpcoming` compares against `today` rather than `new Date()` so the caller
 * — and the tests — decide what "now" means. A fixture recorded last month
 * otherwise stops exercising the upcoming path as the clock moves.
 */
export function toReleaseEvent(
  group: ReleaseGroup,
  artist: RawArtistRef,
  today: string,
): NormalizedEvent {
  const date = group.firstReleaseDate;
  return {
    type: 'release',
    source: 'musicbrainz',
    sourceEventId: group.mbid,
    sourceUrl: `https://musicbrainz.org/release-group/${group.mbid}`,
    artistRef: artist,
    title: group.title,
    eventDate: date,
    // MusicBrainz does not record when a release was announced, only when it
    // is dated. Inventing one would be a claim we cannot support.
    announcedAt: null,
    release: {
      releaseType: classifyReleaseType(group.primaryType, group.secondaryTypes),
      // Neither lives on a release-group; both would need a per-release call.
      coverUrl: null,
      totalTracks: null,
      tracklist: null,
      spotifyAlbumId: null,
      isUpcoming: Boolean(date && date > today),
    },
    payload: group.raw,
  };
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
    /*
     * Releases are fetched per artist by `src/jobs/releases.ts`, which needs
     * the roster and its MBIDs — neither of which a FetchContext carries.
     *
     * `complete: false` rather than `complete: true` with no events: the
     * latter would claim MusicBrainz said there is nothing, which is not what
     * happened. The adapter exists so MusicBrainz appears in `adapter_health`
     * alongside every other source; the job is what actually reads it.
     */
    return {
      events: [],
      complete: false,
      error: 'MusicBrainz releases are fetched per artist by the release job, not through fetch()',
    };
  },
};
