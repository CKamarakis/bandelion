/**
 * The roster import: followed Spotify artists into `artists` + `user_artists`.
 *
 * Checkpointed and resumable, because the roster is thousands of artists and
 * constraint 4 forbids iterating it in a request handler. State lives in
 * `job_state` under JOB_NAME: the cursor is the next page URL, so a killed
 * container resumes at the page it was on rather than restarting.
 *
 * Two honesty rules run through this file:
 *
 *  - A page that fails leaves the cursor where it was and marks the job failed.
 *    It never advances past data it did not read, and never reports 'complete'
 *    for a run that stopped early. An interrupted import is a partial roster,
 *    which is fine; a partial roster silently called complete is not.
 *  - Artists are never deleted here. An unfollow is not observable from a
 *    partial page, and deleting on incomplete data would silently drop artists
 *    whenever a run was interrupted. See `pruneUnfollowed` for where that goes.
 */

import { normalizeName } from '../matcher/normalize.ts';
import {
  fetchRosterPage,
  FIRST_ROSTER_PAGE,
  type RosterEntry,
} from '../adapters/spotify.ts';
import {
  upsertArtist,
  linkExternalId,
  followArtist,
  loadJob,
  saveJob,
  recordSuccess,
  recordFailure,
  type DB,
} from '../db/index.ts';

export const JOB_NAME = 'roster:spotify';

/** Guard against a cursor that never terminates. 200 pages is 10k artists. */
const MAX_PAGES = 200;

export interface RosterProgress {
  /** Artists written this run. Not the roster size: a resume starts mid-way. */
  imported: number;
  pagesFetched: number;
  /** True when the last page was reached and the roster is fully read. */
  complete: boolean;
  /** Spotify's count of followed artists, when it told us. */
  total: number | null;
  error?: string;
}

/**
 * Write one page of artists.
 *
 * In a transaction so a crash mid-page cannot leave an artist row without its
 * external id or follow row: on resume that artist would look imported and
 * never get its Spotify id.
 */
function writePage(db: DB, userId: number, artists: RosterEntry[]): number {
  if (artists.length === 0) return 0;

  const run = db.prepare('BEGIN');
  run.run();
  try {
    for (const artist of artists) {
      const artistId = upsertArtist(db, {
        name: artist.name,
        nameNormalized: normalizeName(artist.name),
        imageUrl: artist.imageUrl,
      });
      if (artist.externalId) linkExternalId(db, artistId, 'spotify', artist.externalId);
      followArtist(db, userId, artistId, 'spotify');
    }
    db.prepare('COMMIT').run();
    return artists.length;
  } catch (err) {
    db.prepare('ROLLBACK').run();
    throw err;
  }
}

/**
 * Import the roster, resuming from the stored cursor.
 *
 * `getAccessToken` is a function rather than a token so a long run can refresh
 * mid-import: the roster takes many pages and a token lasts an hour.
 */
export async function importRoster(opts: {
  db: DB;
  userId: number;
  getAccessToken: () => Promise<string>;
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
  /** Stop after this many pages. Used by tests and by a bounded first run. */
  maxPages?: number;
  /** Called after each page is committed, for progress display. */
  onPage?: (progress: { done: number; total: number | null }) => void;
}): Promise<RosterProgress> {
  const { db, userId } = opts;
  const maxPages = opts.maxPages ?? MAX_PAGES;

  const previous = loadJob(db, JOB_NAME);

  /*
   * Resume from the stored cursor, unless the last run finished. A completed
   * job restarts from the top: that is how a re-run picks up newly followed
   * artists, and re-importing is cheap because every write is an upsert.
   */
  const resuming = previous?.status !== 'complete' && Boolean(previous?.cursor);
  let url: string | undefined = resuming ? (previous?.cursor ?? undefined) : undefined;

  let imported = 0;
  let pagesFetched = 0;
  let total = previous?.total ?? null;
  let done = resuming ? (previous?.done ?? 0) : 0;

  saveJob(db, JOB_NAME, {
    status: 'running',
    cursor: url ?? FIRST_ROSTER_PAGE,
    done,
    lastError: null,
  });

  while (pagesFetched < maxPages) {
    if (opts.signal?.aborted) {
      // A clean stop, not a failure: the cursor already points at the page we
      // have not read, so the next run continues from here.
      saveJob(db, JOB_NAME, { status: 'idle', cursor: url ?? FIRST_ROSTER_PAGE, done });
      return { imported, pagesFetched, complete: false, total, error: 'aborted' };
    }

    let accessToken: string;
    try {
      accessToken = await opts.getAccessToken();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      saveJob(db, JOB_NAME, { status: 'failed', cursor: url ?? FIRST_ROSTER_PAGE, done, lastError: message });
      recordFailure(db, 'spotify', message);
      return { imported, pagesFetched, complete: false, total, error: message };
    }

    const page = await fetchRosterPage({
      accessToken,
      url,
      fetchImpl: opts.fetchImpl,
      signal: opts.signal,
    });

    if (!page.complete) {
      // Leave the cursor on the page that failed. Advancing past unread data
      // would silently drop every artist on it.
      const message = page.error ?? 'unknown error';
      saveJob(db, JOB_NAME, { status: 'failed', cursor: url ?? FIRST_ROSTER_PAGE, done, lastError: message });
      recordFailure(db, 'spotify', message);
      return { imported, pagesFetched, complete: false, total, error: message };
    }

    imported += writePage(db, userId, page.artists);
    done += page.artists.length;
    pagesFetched++;
    if (page.total !== null) total = page.total;

    // Checkpoint after the write, never before: a cursor ahead of the data is
    // how a resume skips a page.
    const atEnd = page.next === null;
    saveJob(db, JOB_NAME, {
      status: atEnd ? 'complete' : 'running',
      cursor: page.next ?? FIRST_ROSTER_PAGE,
      total,
      done,
      lastError: null,
    });

    opts.onPage?.({ done, total });

    if (atEnd) {
      recordSuccess(db, 'spotify');
      return { imported, pagesFetched, complete: true, total };
    }

    // Non-null here: `atEnd` covers page.next === null and returned above.
    url = page.next ?? undefined;
  }

  // Hit the page cap with pages left. Not an error, but not complete either.
  saveJob(db, JOB_NAME, { status: 'idle', cursor: url ?? FIRST_ROSTER_PAGE, total, done });
  return {
    imported,
    pagesFetched,
    complete: false,
    total,
    error: `stopped after ${maxPages} pages`,
  };
}

/**
 * What the UI needs to describe the import without counting rows itself.
 *
 * `total` is Spotify's number when it gave us one. It is deliberately nullable:
 * a progress bar that invents a denominator is exactly the dishonesty copy
 * rule 8 forbids.
 */
export function rosterStatus(db: DB, userId: number) {
  const job = loadJob(db, JOB_NAME);
  const imported = db
    .prepare('SELECT COUNT(*) AS n FROM user_artists WHERE user_id = ?')
    .get(userId) as { n: number };

  return {
    status: job?.status ?? 'idle',
    /** Artists in the database now. Always true, unlike a job counter. */
    imported: imported.n,
    total: job?.total ?? null,
    lastError: job?.lastError ?? null,
    /** True only when a run reached the last page. */
    complete: job?.status === 'complete',
  };
}
