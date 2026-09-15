/**
 * The release pass: MusicBrainz release-groups into `events` + `release_details`.
 *
 * Runs after MBID resolution, because browse needs an MBID. Artists still
 * unresolved are skipped rather than guessed at — see `src/jobs/resolve.ts`.
 *
 * Checkpointed by artist id like the resolve job, and for the same reason: at
 * roughly a second per artist plus retries, a 495-artist sweep is long enough
 * to be interrupted. The cursor rewinds once at the end so artists skipped
 * mid-pass are retried before the run reports complete (decision 036).
 *
 * Three honesty rules:
 *
 *  - A release already in the database is left exactly as it was. The
 *    release-group MBID is the novelty key, so a second sighting carries
 *    nothing new, and rewriting the row would reset `first_seen_at` — the only
 *    record of when *we* learned about it, which is what "new" means here.
 *  - Year-only dates are admitted to the window and keep their precision. A
 *    record dated "2027" cannot be placed on a two-month timeline; dropping it
 *    would hide an announcement, and widening it to a day would invent one.
 *  - A run that stops early never reports 'complete'.
 */

import {
  fetchReleaseGroups,
  inReleaseWindow,
  toReleaseEvent,
  MIN_INTERVAL_MS,
  type MbClientOptions,
} from '../adapters/musicbrainz.ts';
import {
  loadJob,
  saveJob,
  recordSuccess,
  recordFailure,
  insertReleaseEvent,
  markReleaseCheck,
  type DB,
} from '../db/index.ts';
import { windowFor, type Config } from '../config.ts';

export const JOB_NAME = 'releases:musicbrainz';

export interface ReleaseProgress {
  /** Artists whose discography we actually read. */
  artistsChecked: number;
  /** Release-groups seen inside the window, new or not. */
  inWindow: number;
  /** Rows actually written — the number worth telling a user about. */
  written: number;
  /** Of those written, how many are dated ahead of today. */
  upcoming: number;
  /** Artists skipped because MusicBrainz stayed busy. Retried next run. */
  transientFailures: number;
  complete: boolean;
  error?: string;
}

interface PendingArtist {
  id: number;
  name: string;
  mbid: string;
}

/**
 * Resolved artists due a sweep.
 *
 * Ordered by id so the cursor means "resume after this one". Artists with no
 * MBID are excluded entirely rather than name-matched: a release attached to
 * the wrong band is worse than a missing one (decision 008).
 *
 * `staleBefore` is what makes the rewind cheap. The resolve job's equivalent
 * query filters on `mbid IS NULL`, so an artist drops out of it the moment it
 * succeeds; this one had no such filter, so the rewind re-selected the entire
 * roster and the first full run reported 970 artists checked out of 495. The
 * `last_release_check_at` stamp is the filter that was missing.
 */
function pendingArtists(
  db: DB,
  afterId: number,
  limit: number,
  staleBefore: string,
): PendingArtist[] {
  return db
    .prepare(
      `SELECT id, name, mbid
         FROM artists
        WHERE mbid IS NOT NULL
          AND id > ?
          AND (last_release_check_at IS NULL OR last_release_check_at < ?)
        ORDER BY id
        LIMIT ?`,
    )
    .all(afterId, staleBefore, limit) as unknown as PendingArtist[];
}

export function releaseStatus(db: DB) {
  const job = loadJob(db, JOB_NAME);
  const counts = db
    .prepare(
      `SELECT
         (SELECT COUNT(*) FROM artists WHERE mbid IS NOT NULL) AS resolvable,
         (SELECT COUNT(*) FROM artists WHERE last_release_check_at IS NOT NULL) AS checked,
         (SELECT COUNT(*) FROM events WHERE type = 'release') AS releases`,
    )
    .get() as { resolvable: number; checked: number; releases: number };

  return {
    status: job?.status ?? 'idle',
    lastError: job?.lastError ?? null,
    ...counts,
  };
}

/**
 * Sweep the roster for releases inside the configured window.
 *
 * `today` is injectable so tests can pin it. A fixture recorded last month
 * otherwise stops exercising the upcoming path as the real clock moves past
 * its dates, and the test quietly becomes a test of nothing.
 */
export async function importReleases(opts: {
  db: DB;
  config: Config;
  contact: string;
  maxArtists?: number;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  today?: string;
  /**
   * Artists per batch. Only worth setting in tests: at the default of 25 a
   * small fixture fits in a single batch, so the end-of-roster rewind never
   * runs and the path that produced the 970-of-495 bug is unreachable.
   */
  batchSize?: number;
  onProgress?: (p: { artistsChecked: number; written: number }) => void;
}): Promise<ReleaseProgress> {
  const { db, config } = opts;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const budget = opts.maxArtists ?? Number.POSITIVE_INFINITY;
  const today = opts.today ?? new Date().toISOString().slice(0, 10);
  const window = windowFor('release', config, new Date(today));

  const client: MbClientOptions = {
    contact: opts.contact,
    fetchImpl: opts.fetchImpl,
    signal: opts.signal,
    sleep: opts.sleep,
  };

  const job = loadJob(db, JOB_NAME);
  let cursor = Number(job?.cursor ?? 0) || 0;
  saveJob(db, JOB_NAME, { status: 'running', lastError: null });

  const progress: ReleaseProgress = {
    artistsChecked: 0,
    inWindow: 0,
    written: 0,
    upcoming: 0,
    transientFailures: 0,
    complete: false,
  };

  let rewound = false;
  const handled = new Set<number>();
  let lastTransientError: string | null = null;
  /*
   * Everything stamped before this moment is due a sweep; everything stamped
   * after it was done by this run. Taken once at the start rather than per
   * batch, so an artist swept early cannot re-qualify as the clock moves.
   */
  const startedAt = new Date().toISOString();

  try {
    while (progress.artistsChecked < budget) {
      if (opts.signal?.aborted) {
        saveJob(db, JOB_NAME, { cursor: String(cursor), status: 'idle' });
        return { ...progress, error: 'stopped' };
      }

      const take = Math.min(opts.batchSize ?? 25, budget - progress.artistsChecked);
      let batch = pendingArtists(db, cursor, take, startedAt);

      // The cursor only moves forward, so once it passes the last artist the
      // ones skipped this pass are unreachable. Rewind once — see decision 036,
      // where the same bug made the resolve job report complete with a fifth of
      // the roster untouched.
      //
      // `handled` still guards the rewind even though the query now excludes
      // swept artists: an artist whose lookup failed is deliberately left
      // unstamped so the next *run* retries it, which would otherwise make it
      // eligible again within this one.
      if (batch.length === 0 && cursor > 0 && !rewound) {
        rewound = true;
        cursor = 0;
        batch = pendingArtists(db, 0, take, startedAt).filter((a) => !handled.has(a.id));
      }

      if (batch.length === 0) {
        saveJob(db, JOB_NAME, { cursor: null, status: 'complete', lastError: null });
        recordHealth(db, progress, lastTransientError);
        return { ...progress, complete: true, error: lastTransientError ?? undefined };
      }

      for (const artist of batch) {
        if (opts.signal?.aborted) break;

        // One busy artist is a skipped row, not a dead run (constraint 2).
        try {
          const counts = await sweepArtist(db, artist, client, window, today);
          progress.inWindow += counts.inWindow;
          progress.written += counts.written;
          progress.upcoming += counts.upcoming;
          markReleaseCheck(db, artist.id);
        } catch (err) {
          progress.transientFailures++;
          lastTransientError = err instanceof Error ? err.message : String(err);
        }

        progress.artistsChecked++;
        handled.add(artist.id);
        cursor = artist.id;
        saveJob(db, JOB_NAME, { cursor: String(cursor), done: progress.artistsChecked });
        opts.onProgress?.({
          artistsChecked: progress.artistsChecked,
          written: progress.written,
        });

        if (progress.artistsChecked >= budget) break;
        await sleep(MIN_INTERVAL_MS);
      }
    }

    saveJob(db, JOB_NAME, { cursor: String(cursor), status: 'idle' });
    recordHealth(db, progress, lastTransientError);
    return { ...progress, error: lastTransientError ?? undefined };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // The cursor stays put: never advance past work that failed.
    saveJob(db, JOB_NAME, { cursor: String(cursor), status: 'failed', lastError: message });
    recordFailure(db, 'musicbrainz', message);
    return { ...progress, error: message };
  }
}

/** One artist's discography, filtered to the window and written. */
async function sweepArtist(
  db: DB,
  artist: PendingArtist,
  client: MbClientOptions,
  window: { from: string; to: string },
  today: string,
): Promise<{ inWindow: number; written: number; upcoming: number }> {
  const groups = await fetchReleaseGroups(artist.mbid, client);
  let inWindow = 0;
  let written = 0;
  let upcoming = 0;

  for (const group of groups) {
    if (!inReleaseWindow(group, window)) continue;
    inWindow++;

    // mbid, not externalId: MusicBrainz states the identity directly, which is
    // the case RawArtistRef.mbid exists for.
    const event = toReleaseEvent(group, { name: artist.name, mbid: artist.mbid }, today);
    const rows = insertReleaseEvent(db, {
      artistId: artist.id,
      title: event.title,
      eventDate: event.eventDate,
      // A group that reached the window always has a date, so a null precision
      // here would be a bug rather than missing data. 'day' is the column
      // default and the safest fallback.
      datePrecision: group.precision ?? 'day',
      sourceEventId: event.sourceEventId,
      sourceUrl: event.sourceUrl,
      releaseType: event.release?.releaseType ?? 'other',
      isUpcoming: event.release?.isUpcoming ?? false,
      payload: JSON.stringify(event.payload),
    });

    written += rows;
    if (rows > 0 && event.release?.isUpcoming) upcoming++;
  }

  return { inWindow, written, upcoming };
}

/**
 * Report health from what happened, not from whether the job crashed.
 *
 * A sweep where every artist 503'd did not succeed, even though nothing threw.
 * Reporting that as healthy is how a broken source stays invisible.
 */
function recordHealth(db: DB, progress: ReleaseProgress, lastError: string | null): void {
  if (progress.artistsChecked > 0 && progress.transientFailures === progress.artistsChecked) {
    recordFailure(db, 'musicbrainz', lastError ?? 'every artist failed');
  } else {
    recordSuccess(db, 'musicbrainz');
  }
}
