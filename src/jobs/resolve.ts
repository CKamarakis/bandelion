/**
 * MBID resolution: give every roster artist a MusicBrainz identity.
 *
 * This is the join key the release pass needs (decision 033), so it runs before
 * releases can be fetched at all.
 *
 * Checkpointed by artist id, not by page: the cursor is the last artist
 * resolved, so a killed container resumes at the next one rather than
 * re-querying MusicBrainz for work already done.
 *
 * Measured on a real 625-artist roster: **about 8 seconds per artist**, so a
 * full run is over an hour. The 1.1s pacing suggests 12 minutes; the gap is two
 * calls per artist plus frequent 503 retries. That is exactly why this
 * checkpoints every artist rather than every batch — an hour-long job will be
 * interrupted.
 *
 * Two honesty rules, the same ones the roster import follows:
 *
 *  - An artist MusicBrainz cannot identify is left with `mbid = NULL` and
 *    recorded as attempted. It is never given a guessed identity, because a
 *    wrong MBID silently attaches another band's releases to your feed —
 *    strictly worse than an artist with no releases yet.
 *  - A run that stops early never reports 'complete'.
 */

import {
  resolveBySpotifyUrl,
  searchByName,
  fetchArtistLinks,
  MIN_INTERVAL_MS,
  type MbClientOptions,
  type ResolutionMethod,
} from '../adapters/musicbrainz.ts';
import {
  loadJob,
  saveJob,
  recordSuccess,
  recordFailure,
  queueForReview,
  setArtistMbid,
  addArtistLinks,
  type DB,
} from '../db/index.ts';

export const JOB_NAME = 'resolve:musicbrainz';

/** Only these are worth storing; the rest is noise on an artist card. */
const KEPT_LINK_KINDS = new Set([
  'website',
  'bandcamp',
  'instagram',
  'soundcloud',
  'youtube',
  'tiktok',
]);

export interface ResolveProgress {
  attempted: number;
  resolved: number;
  queued: number;
  /** Artists MusicBrainz had no record of, under any method. */
  unresolved: number;
  /** Artists skipped because MusicBrainz stayed busy. Retried on the next run. */
  transientFailures: number;
  complete: boolean;
  error?: string;
}

interface PendingArtist {
  id: number;
  name: string;
  spotifyId: string | null;
}

/**
 * Artists still needing an MBID, oldest id first.
 *
 * Ordered by id so the checkpoint is a simple "resume after this one" — any
 * ordering that could change between runs would make the cursor meaningless.
 */
function pendingArtists(db: DB, afterId: number, limit: number): PendingArtist[] {
  return db
    .prepare(
      `SELECT a.id, a.name, x.external_id AS spotifyId
         FROM artists a
         LEFT JOIN artist_external_ids x
           ON x.artist_id = a.id AND x.source = 'spotify'
        WHERE a.mbid IS NULL AND a.id > ?
        ORDER BY a.id
        LIMIT ?`,
    )
    .all(afterId, limit) as unknown as PendingArtist[];
}

export function resolveStatus(db: DB) {
  const job = loadJob(db, JOB_NAME);
  const counts = db
    .prepare(
      `SELECT COUNT(*) AS total,
              SUM(CASE WHEN mbid IS NOT NULL THEN 1 ELSE 0 END) AS resolved
         FROM artists`,
    )
    .get() as { total: number; resolved: number | null };

  return {
    status: job?.status ?? 'idle',
    lastError: job?.lastError ?? null,
    total: counts.total,
    resolved: counts.resolved ?? 0,
  };
}

/**
 * Resolve as many artists as the budget allows.
 *
 * `maxArtists` exists so a caller can take a bite rather than the whole roster:
 * the UI triggers a short run, the CLI runs it to completion.
 */
export async function resolveArtists(opts: {
  db: DB;
  contact: string;
  maxArtists?: number;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  onProgress?: (p: { attempted: number; resolved: number }) => void;
}): Promise<ResolveProgress> {
  const { db, contact } = opts;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const budget = opts.maxArtists ?? Number.POSITIVE_INFINITY;

  const client: MbClientOptions = {
    contact,
    fetchImpl: opts.fetchImpl,
    signal: opts.signal,
    sleep: opts.sleep,
  };

  const job = loadJob(db, JOB_NAME);
  // The cursor is the last artist id resolved. A fresh run starts at 0.
  let cursor = Number(job?.cursor ?? 0) || 0;

  saveJob(db, JOB_NAME, { status: 'running', lastError: null });

  let attempted = 0;
  let resolved = 0;
  let queued = 0;
  let unresolved = 0;
  // Artists MusicBrainz stayed busy for. Reported, but never fatal.
  let transientFailures = 0;
  let lastTransientError: string | null = null;
  // The rewind below is allowed once per run; see the comment at its use.
  let rewound = false;
  // Artist ids this run has already attempted, so the rewind does not redo them.
  const handled = new Set<number>();

  try {
    while (attempted < budget) {
      if (opts.signal?.aborted) {
        saveJob(db, JOB_NAME, { cursor: String(cursor), status: 'idle' });
        return { attempted, resolved, queued, unresolved, transientFailures, complete: false, error: 'stopped' };
      }

      let batch = pendingArtists(db, cursor, Math.min(25, budget - attempted));

      /*
       * Reaching the end of the roster is not the same as finishing it.
       *
       * The cursor only moves forward, so once it passes the last artist,
       * `id > cursor` finds nothing — including the artists this pass skipped
       * because MusicBrainz was busy or had no record. The first full run
       * ended with the cursor at 629 and 133 unresolved artists behind it, and
       * every subsequent run reported "complete" having attempted zero.
       *
       * So when the tail is empty, rewind once and re-sweep from the start.
       *
       * Exactly once per run: an artist MusicBrainz has no record of is
       * unresolvable no matter how often we ask, and without this guard the
       * rewind would re-select it forever — the cursor advancing to the end,
       * rewinding, and picking it up again. One extra pass retries what was
       * transiently busy; a second would be a spin.
       */
      if (batch.length === 0 && cursor > 0 && !rewound) {
        rewound = true;
        cursor = 0;
        // Only artists this run has not already handled. Without this the
        // rewind re-attempts the ones just queued or found absent, queueing
        // them twice and double-counting every outcome.
        batch = pendingArtists(db, 0, Math.min(25, budget - attempted)).filter(
          (a) => !handled.has(a.id),
        );
      }

      if (batch.length === 0) {
        // A full sweep from the start found nothing pending: genuinely done.
        saveJob(db, JOB_NAME, { cursor: null, status: 'complete', lastError: null });
        recordHealth(db, attempted, transientFailures, lastTransientError);
        return { attempted, resolved, queued, unresolved, transientFailures, complete: true, error: lastTransientError ?? undefined };
      }

      for (const artist of batch) {
        if (opts.signal?.aborted) break;

        /*
         * One artist MusicBrainz stayed busy for must not end the run.
         *
         * The same principle as constraint 2: a single failing lookup is a
         * degraded row, not an outage. The artist keeps `mbid = NULL` and is
         * picked up by the next run, because `pendingArtists` selects on that.
         * Only a failure outside this — a bug, an aborted signal — reaches the
         * outer catch and stops the job.
         */
        let outcome: Outcome;
        try {
          outcome = await resolveOne(db, artist, client);
        } catch (err) {
          outcome = 'none';
          transientFailures++;
          lastTransientError = err instanceof Error ? err.message : String(err);
        }
        attempted++;
        if (outcome === 'resolved') resolved++;
        else if (outcome === 'queued') queued++;
        else unresolved++;

        handled.add(artist.id);
        cursor = artist.id;
        // Checkpoint every artist. The unit of work is one artist, so the
        // checkpoint should be too — a crash costs one lookup, not a batch.
        saveJob(db, JOB_NAME, { cursor: String(cursor), done: attempted });
        opts.onProgress?.({ attempted, resolved });

        if (attempted >= budget) break;
        await sleep(MIN_INTERVAL_MS);
      }
    }

    saveJob(db, JOB_NAME, { cursor: String(cursor), status: 'idle' });
    // Health reflects what actually happened. A run where every lookup 503'd
    // is a degraded source, and reporting it healthy is how a broken adapter
    // stays invisible.
    recordHealth(db, attempted, transientFailures, lastTransientError);
    return { attempted, resolved, queued, unresolved, transientFailures, complete: false, error: lastTransientError ?? undefined };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // The cursor stays where it was: never advance past work that failed.
    saveJob(db, JOB_NAME, { cursor: String(cursor), status: 'failed', lastError: message });
    recordFailure(db, 'musicbrainz', message);
    return { attempted, resolved, queued, unresolved, transientFailures, complete: false, error: message };
  }
}

/**
 * Report source health honestly.
 *
 * Every lookup failing is a degraded source even though the job itself did not
 * crash. Only a run that actually got answers counts as a success.
 */
function recordHealth(
  db: DB,
  attempted: number,
  transientFailures: number,
  lastError: string | null,
): void {
  if (attempted > 0 && transientFailures === attempted) {
    recordFailure(db, 'musicbrainz', lastError ?? 'every lookup failed');
  } else {
    recordSuccess(db, 'musicbrainz');
  }
}

type Outcome = 'resolved' | 'queued' | 'none';

/**
 * One artist: exact join first, review queue second, nothing third.
 *
 * Name search deliberately never writes an MBID. See the header of
 * `src/adapters/musicbrainz.ts` for why: for the two WITCHes on this roster it
 * returns identical results, so an auto-accept would merge two bands.
 */
async function resolveOne(
  db: DB,
  artist: PendingArtist,
  client: MbClientOptions,
): Promise<Outcome> {
  let method: ResolutionMethod = 'none';

  if (artist.spotifyId) {
    const byUrl = await resolveBySpotifyUrl(artist.spotifyId, client);
    if (byUrl.mbid) {
      setArtistMbid(db, artist.id, byUrl.mbid);
      method = byUrl.method;

      // Links come from the same identity, so fetch them while we have it.
      // Best-effort: a failure here must not lose the MBID we just proved.
      try {
        const links = await fetchArtistLinks(byUrl.mbid, client);
        addArtistLinks(
          db,
          artist.id,
          links.filter((l) => KEPT_LINK_KINDS.has(l.kind)),
          'musicbrainz',
        );
      } catch {
        /* links are best-effort by design; the MBID is what mattered */
      }

      return 'resolved';
    }
  }

  // No URL relation. Offer candidates for review rather than guessing.
  const byName = await searchByName(artist.name, client);
  const candidates = byName.candidates ?? [];
  if (candidates.length > 0) {
    queueForReview(db, {
      rawName: artist.name,
      source: 'musicbrainz',
      candidateArtistId: artist.id,
      // Search scores are 0-100; the queue stores 0-1 like every other score.
      score: (candidates[0]?.score ?? 0) / 100,
      payload: JSON.stringify({ method: 'name-search', candidates }),
    });
    return 'queued';
  }

  void method;
  return 'none';
}
