/**
 * The cover art pass: sleeve images from the Cover Art Archive.
 *
 * Runs after releases, because it works from release-group MBIDs those rows
 * already carry in `source_event_id`. Nothing else needs to have happened.
 *
 * Checkpointed by event id like the release sweep, for the same reason: at
 * roughly a second per release, a few hundred releases is long enough to be
 * interrupted, and restarting from zero would re-request everything.
 *
 * Two honesty rules:
 *
 *  - **A release with no cover is recorded as checked, not left unknown.**
 *    Most of a back catalogue has no art in the archive. Stamping
 *    `cover_checked_at` on a 404 is what stops the next run asking again, and
 *    it is why `cover_url IS NULL` alone is not the query this job uses.
 *  - A run that stops early never reports 'complete'.
 */

import { fetchFrontCover, MIN_INTERVAL_MS, type CoverArtOptions } from '../adapters/coverart.ts';
import { loadJob, saveJob, recordSuccess, recordFailure, setCoverArt, type DB } from '../db/index.ts';

export const JOB_NAME = 'covers:coverartarchive';

export interface CoverProgress {
  /** Releases we asked the archive about. */
  checked: number;
  /** Of those, how many had a cover. */
  found: number;
  /** Releases the archive has no art for. Not a failure. */
  absent: number;
  /** Could not be reached. Retried next run, because they stay unstamped. */
  transientFailures: number;
  complete: boolean;
  error?: string;
}

interface PendingRelease {
  eventId: number;
  mbid: string;
  title: string;
}

/**
 * Releases not yet asked about, oldest id first.
 *
 * Filters on `cover_checked_at IS NULL`, not `cover_url IS NULL`: the second
 * would re-select every coverless release on every run, which at one request a
 * second is an hour of asking questions already answered.
 */
function pendingReleases(db: DB, afterId: number, limit: number): PendingRelease[] {
  return db
    .prepare(
      `SELECT e.id AS eventId, e.source_event_id AS mbid, e.title
         FROM events e
         JOIN release_details rd ON rd.event_id = e.id
        WHERE e.type = 'release'
          AND e.source = 'musicbrainz'
          AND rd.cover_checked_at IS NULL
          AND e.id > ?
        ORDER BY e.id
        LIMIT ?`,
    )
    .all(afterId, limit) as unknown as PendingRelease[];
}

export function coverStatus(db: DB) {
  const job = loadJob(db, JOB_NAME);
  const counts = db
    .prepare(
      `SELECT
         (SELECT COUNT(*) FROM release_details) AS releases,
         (SELECT COUNT(*) FROM release_details WHERE cover_checked_at IS NOT NULL) AS checked,
         (SELECT COUNT(*) FROM release_details WHERE cover_url IS NOT NULL) AS withCover`,
    )
    .get() as { releases: number; checked: number; withCover: number };

  return {
    status: job?.status ?? 'idle',
    lastError: job?.lastError ?? null,
    ...counts,
  };
}

/**
 * Fetch covers for releases that have not been asked about.
 *
 * `maxReleases` lets a caller take a bite rather than the whole catalogue.
 */
export async function importCovers(opts: {
  db: DB;
  contact: string;
  maxReleases?: number;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  onProgress?: (p: { checked: number; found: number }) => void;
}): Promise<CoverProgress> {
  const { db } = opts;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const budget = opts.maxReleases ?? Number.POSITIVE_INFINITY;

  const client: CoverArtOptions = {
    contact: opts.contact,
    fetchImpl: opts.fetchImpl,
    signal: opts.signal,
    sleep: opts.sleep,
  };

  const job = loadJob(db, JOB_NAME);
  /*
   * Resume only a run that was stopped: a budget, an abort, a killed process.
   * A failed run left its cursor past the releases it could not reach, and
   * resuming from there would report "complete" having asked nothing — the
   * forward-only cursor of decision 036. After a failure, start over; checked
   * releases are filtered out anyway, so only the unreached ones are asked.
   */
  const resuming = job?.status !== 'complete' && job?.status !== 'failed' && job?.cursor;
  let cursor = resuming ? Number(job?.cursor ?? 0) : 0;

  let checked = 0;
  let found = 0;
  let absent = 0;
  let transientFailures = 0;

  saveJob(db, JOB_NAME, { status: 'running', cursor: String(cursor), lastError: null });

  while (checked < budget) {
    const batch = pendingReleases(db, cursor, Math.min(50, budget - checked));
    if (batch.length === 0) break;

    for (const release of batch) {
      if (opts.signal?.aborted) {
        saveJob(db, JOB_NAME, { status: 'idle', cursor: String(cursor), done: checked });
        return { checked, found, absent, transientFailures, complete: false, error: 'aborted' };
      }

      const cover = await fetchFrontCover(release.mbid, client);

      if (cover.checked) {
        // Stamp whether or not there was art: the stamp records that we asked.
        setCoverArt(db, release.eventId, cover.url);
        if (cover.url) found++;
        else absent++;
      } else {
        /*
         * Unreachable. Deliberately NOT stamped, so the next run tries again.
         * Advancing the cursor past it is still right: the cursor means "asked
         * about everything up to here this run", and the unstamped row will be
         * selected again on the next pass.
         */
        transientFailures++;
      }

      checked++;
      cursor = release.eventId;
      saveJob(db, JOB_NAME, { status: 'running', cursor: String(cursor), done: checked });
      opts.onProgress?.({ checked, found });

      await sleep(MIN_INTERVAL_MS);
    }
  }

  const ranOut = checked >= budget;
  if (transientFailures > 0 && transientFailures === checked) {
    // Everything failed: the archive is down, and saying "complete" would
    // claim we established that hundreds of releases have no art.
    const message = 'cover art archive unreachable for every release this run';
    saveJob(db, JOB_NAME, { status: 'failed', cursor: String(cursor), done: checked, lastError: message });
    recordFailure(db, 'coverartarchive', message);
    return { checked, found, absent, transientFailures, complete: false, error: message };
  }

  if (ranOut) {
    saveJob(db, JOB_NAME, { status: 'idle', cursor: String(cursor), done: checked });
    return {
      checked, found, absent, transientFailures,
      complete: false,
      error: `stopped after ${checked} release(s)`,
    };
  }

  // Ran out of pending releases, which is the end.
  saveJob(db, JOB_NAME, { status: 'complete', cursor: '0', done: checked, lastError: null });
  if (checked > 0) recordSuccess(db, 'coverartarchive');
  return { checked, found, absent, transientFailures, complete: true };
}
