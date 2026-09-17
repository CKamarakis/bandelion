/**
 * The liked-songs import: artists credited on your saved tracks.
 *
 * A second list beside the followed roster, not a replacement for it. An
 * artist can be in both — measured on a real library, 477 of 1,408 are — so
 * this writes the `liked` flag and never touches `followed`.
 *
 * Checkpointed and resumable like `roster.ts`, and for the same reason: a
 * 2,081-track library is 42 pages, and a killed container must resume rather
 * than restart. State lives in `job_state` under JOB_NAME, cursor = next page.
 *
 * Three honesty rules, two shared with the roster import:
 *
 *  - A page that fails leaves the cursor where it was and marks the job failed.
 *    It never advances past data it did not read.
 *  - Artists are never removed here. An unlike is not observable from a partial
 *    page, so a run interrupted at page 3 would look identical to unliking
 *    everything after it.
 *  - `total` is checked, not trusted. /me/tracks reports the library size on
 *    every page, so a run that reaches the end having read fewer tracks than
 *    Spotify claims is reported as incomplete. The roster import cannot do
 *    this — /me/following omits `total` sometimes — but here it is free, and a
 *    silently short import is the failure mode that matters.
 */

import { normalizeName } from '../matcher/normalize.ts';
import { fetchLikedPage, FIRST_LIKED_PAGE, type LikedArtistRef } from '../adapters/spotify.ts';
import {
  upsertArtist,
  setArtistList,
  loadJob,
  saveJob,
  recordSuccess,
  recordFailure,
  type DB,
} from '../db/index.ts';

export const JOB_NAME = 'liked:spotify';

/** Guard against a cursor that never terminates. 200 pages is 10k tracks. */
const MAX_PAGES = 200;

export interface LikedProgress {
  /** Artists written this run. Not the list size: a resume starts mid-way. */
  imported: number;
  tracksRead: number;
  pagesFetched: number;
  /** Album credits dropped for performing nothing here — see artistsOnTrack. */
  dropped: number;
  complete: boolean;
  /** Spotify's count of saved tracks. */
  total: number | null;
  error?: string;
}

/**
 * Write one page of artists.
 *
 * In a transaction for the reason the roster import uses one: a crash between
 * `upsertArtist` and `setArtistList` would leave an artist row that belongs to
 * no list, which no later run would notice or fix.
 *
 * Deduplicated within the page because a collaboration credits the same artist
 * on several tracks; across pages the upsert handles it, since an artist with
 * a Spotify id resolves to the same row every time.
 */
function writePage(db: DB, userId: number, artists: LikedArtistRef[]): number {
  if (artists.length === 0) return 0;

  const unique = new Map<string, LikedArtistRef>();
  for (const artist of artists) unique.set(artist.externalId, artist);

  db.prepare('BEGIN').run();
  try {
    for (const artist of unique.values()) {
      const artistId = upsertArtist(db, {
        name: artist.name,
        nameNormalized: normalizeName(artist.name),
        // No image: /me/tracks nests only id and name, and the batch artist
        // endpoint that would have filled them in cheaply is gone (403 since
        // Feb 2026). One call per artist is not worth an avatar.
        externalId: { source: 'spotify', id: artist.externalId },
      });
      setArtistList(db, userId, artistId, { liked: true });
    }
    db.prepare('COMMIT').run();
    return unique.size;
  } catch (err) {
    db.prepare('ROLLBACK').run();
    throw err;
  }
}

/**
 * Import artists from saved tracks, resuming from the stored cursor.
 *
 * `getAccessToken` is a function rather than a token so a long run can refresh
 * mid-import, exactly as the roster import does.
 */
export async function importLiked(opts: {
  db: DB;
  userId: number;
  getAccessToken: () => Promise<string>;
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
  maxPages?: number;
  onPage?: (progress: { tracks: number; total: number | null; artists: number }) => void;
}): Promise<LikedProgress> {
  const { db, userId } = opts;
  const maxPages = opts.maxPages ?? MAX_PAGES;

  const previous = loadJob(db, JOB_NAME);

  // Resume unless the last run finished. A completed job restarts from the
  // top, which is how newly liked songs get picked up; re-importing is cheap
  // because every write is an upsert.
  const resuming = previous?.status !== 'complete' && Boolean(previous?.cursor);
  let url: string | undefined = resuming ? (previous?.cursor ?? undefined) : undefined;

  let imported = 0;
  let pagesFetched = 0;
  let dropped = 0;
  let total = previous?.total ?? null;
  let tracksRead = resuming ? (previous?.done ?? 0) : 0;

  saveJob(db, JOB_NAME, {
    status: 'running',
    cursor: url ?? FIRST_LIKED_PAGE,
    done: tracksRead,
    lastError: null,
  });

  while (pagesFetched < maxPages) {
    if (opts.signal?.aborted) {
      // A clean stop: the cursor already points at the unread page.
      saveJob(db, JOB_NAME, {
        status: 'idle',
        cursor: url ?? FIRST_LIKED_PAGE,
        total,
        done: tracksRead,
      });
      return { imported, tracksRead, pagesFetched, dropped, complete: false, total, error: 'aborted' };
    }

    let accessToken: string;
    try {
      accessToken = await opts.getAccessToken();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      saveJob(db, JOB_NAME, {
        status: 'failed',
        cursor: url ?? FIRST_LIKED_PAGE,
        total,
        done: tracksRead,
        lastError: message,
      });
      recordFailure(db, 'spotify', message);
      return { imported, tracksRead, pagesFetched, dropped, complete: false, total, error: message };
    }

    const page = await fetchLikedPage({
      accessToken,
      url,
      fetchImpl: opts.fetchImpl,
      signal: opts.signal,
    });

    if (!page.complete) {
      const message = page.error ?? 'unknown error';
      saveJob(db, JOB_NAME, {
        status: 'failed',
        cursor: url ?? FIRST_LIKED_PAGE,
        total,
        done: tracksRead,
        lastError: message,
      });
      recordFailure(db, 'spotify', message);
      return { imported, tracksRead, pagesFetched, dropped, complete: false, total, error: message };
    }

    imported += writePage(db, userId, page.artists);
    tracksRead += page.tracksSeen;
    dropped += page.dropped;
    pagesFetched++;
    if (page.total !== null) total = page.total;

    // Checkpoint after the write, never before: a cursor ahead of the data is
    // how a resume skips a page.
    const atEnd = page.next === null;
    saveJob(db, JOB_NAME, {
      status: atEnd ? 'complete' : 'running',
      cursor: page.next ?? FIRST_LIKED_PAGE,
      total,
      done: tracksRead,
      lastError: null,
    });

    opts.onPage?.({ tracks: tracksRead, total, artists: imported });

    if (atEnd) {
      /*
       * The end of the cursor is not proof we read the library. Spotify tells
       * us how many saved tracks exist on every page, so a short read is
       * detectable here rather than showing up later as an artist who never
       * appears in the feed.
       */
      if (total !== null && tracksRead < total) {
        const message = `read ${tracksRead} of ${total} saved tracks before the cursor ended`;
        saveJob(db, JOB_NAME, {
          status: 'failed',
          cursor: FIRST_LIKED_PAGE,
          total,
          done: tracksRead,
          lastError: message,
        });
        recordFailure(db, 'spotify', message);
        return { imported, tracksRead, pagesFetched, dropped, complete: false, total, error: message };
      }

      recordSuccess(db, 'spotify');
      return { imported, tracksRead, pagesFetched, dropped, complete: true, total };
    }

    url = page.next ?? undefined;
  }

  // Hit the page cap with pages left. Not an error, but not complete either.
  saveJob(db, JOB_NAME, {
    status: 'idle',
    cursor: url ?? FIRST_LIKED_PAGE,
    total,
    done: tracksRead,
  });
  return {
    imported,
    tracksRead,
    pagesFetched,
    dropped,
    complete: false,
    total,
    error: `stopped after ${maxPages} pages`,
  };
}

/**
 * What the UI needs to describe the import without counting the library.
 *
 * Counts come from the database rather than the job, because a job counter
 * describes one run and the table describes what is actually there.
 */
export function likedStatus(db: DB, userId: number) {
  const job = loadJob(db, JOB_NAME);
  const counts = db
    .prepare(
      `SELECT
         SUM(CASE WHEN liked = 1 THEN 1 ELSE 0 END) AS liked,
         SUM(CASE WHEN liked = 1 AND followed = 1 THEN 1 ELSE 0 END) AS both
       FROM user_artists WHERE user_id = ?`,
    )
    .get(userId) as { liked: number | null; both: number | null };

  return {
    status: job?.status ?? 'idle',
    /** Artists from liked songs in the database now. */
    imported: counts.liked ?? 0,
    /** Of those, how many you also follow. */
    alsoFollowed: counts.both ?? 0,
    tracksRead: job?.done ?? 0,
    total: job?.total ?? null,
    lastError: job?.lastError ?? null,
    complete: job?.status === 'complete',
  };
}
