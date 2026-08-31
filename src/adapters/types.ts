/**
 * The source adapter contract.
 *
 * Every data source — Spotify, Ticketmaster, Eventim, Resident Advisor, a
 * promoter crawler — implements this and is registered in `registry.ts`.
 *
 * Why this exists: half our sources are undocumented endpoints that can change
 * without notice. This interface is what makes one of them breaking a degraded
 * row in a health table rather than a broken app.
 *
 * THE RULE, and it is not negotiable: `fetch` never throws. It catches, records
 * the failure, and returns an empty result. One failing source must never empty
 * the feed or block the others. `tests/degradation.mjs` asserts this.
 */

export type SourceId =
  | 'spotify'
  | 'musicbrainz'
  | 'ticketmaster'
  | 'eventim'
  | 'residentadvisor'
  | 'greyzone';

/** What a source contributes. A source may implement more than one kind. */
export type AdapterKind = 'roster' | 'release' | 'event' | 'enrichment';

export type HealthStatus = 'ok' | 'degraded' | 'failing' | 'disabled';

/**
 * Official sources have documented, stable contracts. Unofficial ones are
 * public endpoints or scraped pages that may change without notice.
 *
 * This is surfaced in the UI, not just recorded: a user seeing an empty feed
 * deserves to know whether a scraper broke.
 */
export type SourceTrust = 'official' | 'unofficial';

export interface AdapterHealth {
  source: SourceId;
  status: HealthStatus;
  lastSuccessAt: string | null;
  lastError: string | null;
  consecutiveFailures: number;
}

export interface FetchContext {
  /** Configured city, e.g. 'Berlin'. Never hardcoded in an adapter. */
  city: string;
  /** Inclusive ISO date bounds for the fetch window. */
  from: string;
  to: string;
  /**
   * The roster, for adapters that need to know which artists matter.
   * Event adapters generally do NOT use this: they sweep the city and let the
   * matcher do the work. See the domain rule in CLAUDE.md.
   */
  roster?: RosterArtist[];
  /** Per-source credentials, from env. Absent means the adapter is disabled. */
  credentials?: Record<string, string | undefined>;
  signal?: AbortSignal;
}

export interface RosterArtist {
  artistId: number;
  name: string;
  nameNormalized: string;
  mbid: string | null;
  spotifyId: string | null;
}

/** An artist as a source describes them, before we resolve them to our own. */
export interface RawArtistRef {
  name: string;
  /** Source-native id, when the source has one. */
  externalId?: string;
  /** Set when a source states the MBID directly. Rare and valuable. */
  mbid?: string;
}

export type EventType = 'release' | 'gig';

/**
 * The normalized shape every adapter produces. Deliberately flat and boring:
 * source-specific richness belongs in `payload`, which is stored verbatim so a
 * later version can mine it without re-fetching.
 */
export interface NormalizedEvent {
  type: EventType;
  source: SourceId;
  /** Stable id within the source, for deduplication across polls. */
  sourceEventId: string;
  sourceUrl: string | null;

  /** Who this is about, as the source names them. Resolved later by the matcher. */
  artistRef: RawArtistRef;
  /** Every act on the bill, headliner first, when the source lists them. */
  lineup?: RawArtistRef[];

  title: string;
  /** ISO date. Release date, or gig date. */
  eventDate: string | null;
  /** ISO date this was first announced or discovered, when the source says. */
  announcedAt?: string | null;

  release?: ReleaseDetails;
  gig?: GigDetails;

  /** Verbatim upstream record. Never parsed at read time; kept for later mining. */
  payload: unknown;
}

export interface ReleaseDetails {
  releaseType: 'album' | 'ep' | 'single' | 'compilation' | 'live' | 'other';
  coverUrl: string | null;
  totalTracks: number | null;
  tracklist: { position: number; title: string; durationMs: number | null }[] | null;
  spotifyAlbumId: string | null;
  /** True when the date is in the future: an announcement, not a release. */
  isUpcoming: boolean;
}

export interface GigDetails {
  venueName: string | null;
  venueUrl: string | null;
  city: string | null;
  ticketUrl: string | null;
  /** ISO date tickets go on sale. Frequently absent. Never invent one. */
  onSaleDate: string | null;
  saleStatus: SaleStatus;
  /** Support acts as named by the source. Best-effort; often empty. */
  supportActs: string[];
  priceText: string | null;
}

/**
 * 'unknown' is the honest default and must stay distinguishable from
 * 'not_on_sale'. Copy rule 8: we may not claim a sale state we did not read.
 */
export type SaleStatus =
  | 'on_sale'
  | 'not_on_sale'
  | 'sold_out'
  | 'cancelled'
  | 'unknown';

export interface FetchResult {
  events: NormalizedEvent[];
  /**
   * False when the fetch failed or returned partial data. An empty `events`
   * with `complete: true` means "the source says there is nothing"; with
   * `complete: false` it means "we do not know". The UI must not conflate them.
   */
  complete: boolean;
  error?: string;
}

export interface SourceAdapter {
  readonly id: SourceId;
  readonly kind: AdapterKind[];
  readonly trust: SourceTrust;
  /** Shown in the UI when this source is the reason something is missing. */
  readonly label: string;

  /** False when required credentials are absent. Disabled, not failing. */
  enabled(env: NodeJS.ProcessEnv): boolean;

  /** Never throws. Returns `complete: false` on failure. */
  fetch(ctx: FetchContext): Promise<FetchResult>;
}
