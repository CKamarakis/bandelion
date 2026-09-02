/**
 * The roster import job.
 *
 * The interesting assertions are not "does it insert". They are the promises
 * that make a 30-minute import survivable:
 *
 *   - a killed run resumes at the page it was on, and does not skip one
 *   - a failed page never advances the cursor past data we did not read
 *   - a partial import is never reported as complete
 *   - re-running is idempotent: no duplicate artists, no lost follows
 *
 * Every page comes from a stub. No network.
 */

import { openDatabase, loadJob, getRoster, getHealth } from '../src/db/index.ts';
import { importRoster, rosterStatus, JOB_NAME } from '../src/jobs/roster.ts';

let failed = 0;
const check = (ok, msg, detail) => {
  if (ok) console.log(`pass  ${msg}`);
  else {
    console.error(`FAIL  ${msg}${detail ? `\n      ${detail}` : ''}`);
    failed++;
  }
};

const fresh = () => openDatabase(':memory:');
const token = async () => 'test-token';

/** An artist as /me/following returns them. */
const artist = (id, name) => ({ id, name, images: [], genres: [], popularity: 50 });

/**
 * A stubbed Spotify that serves `pages` in order, keyed by cursor.
 *
 * Records every URL requested, so the suite can assert which page a resume
 * actually asked for rather than inferring it from the row count.
 */
function stubSpotify(pages, opts = {}) {
  const requested = [];
  const impl = async (url) => {
    requested.push(String(url));
    const key = String(url).includes('after=') ? String(url).split('after=')[1].split('&')[0] : 'first';

    if (opts.failOn && opts.failOn === key) {
      if (opts.failWith === 'throw') throw new Error('connection reset');
      return {
        ok: false,
        status: opts.failWith ?? 500,
        headers: new Headers(),
        async json() {
          return { error: { status: opts.failWith ?? 500, message: 'upstream error' } };
        },
        async text() {
          return '{}';
        },
      };
    }

    const page = pages[key];
    if (!page) throw new Error(`test stub has no page for "${key}"`);
    return {
      ok: true,
      status: 200,
      headers: new Headers(),
      async json() {
        return { artists: page };
      },
      async text() {
        return JSON.stringify({ artists: page });
      },
    };
  };
  return { impl, requested };
}

/** Three pages of two artists each, cursor-linked. */
const THREE_PAGES = {
  first: {
    items: [artist('a1', 'Band of Horses'), artist('a2', 'Sigur Ros')],
    next: 'https://api.spotify.com/v1/me/following?type=artist&after=a2&limit=50',
    total: 6,
  },
  a2: {
    items: [artist('a3', 'The Notwist'), artist('a4', 'Slowdive')],
    next: 'https://api.spotify.com/v1/me/following?type=artist&after=a4&limit=50',
    total: 6,
  },
  a4: {
    items: [artist('a5', 'Bohren & der Club of Gore'), artist('a6', 'Einstuerzende Neubauten')],
    next: null,
    total: 6,
  },
};

// --- A complete import ------------------------------------------------------

{
  const db = fresh();
  const spotify = stubSpotify(THREE_PAGES);

  const result = await importRoster({
    db,
    userId: 1,
    getAccessToken: token,
    fetchImpl: spotify.impl,
  });

  check(result.complete === true, 'a run that reaches the last page reports complete');
  check(result.imported === 6, 'every artist is imported', `got ${result.imported}`);
  check(result.pagesFetched === 3, 'all three pages are fetched');
  check(result.total === 6, "Spotify's total is recorded");

  const roster = getRoster(db, 1);
  check(roster.length === 6, 'the roster query returns every artist');
  check(
    roster.every((a) => a.spotifyId !== null),
    'every artist keeps its Spotify id',
  );
  check(
    roster.some((a) => a.name === 'Bohren & der Club of Gore'),
    'an artist with an ampersand survives normalisation',
  );

  const job = loadJob(db, JOB_NAME);
  check(job.status === 'complete', 'the job is marked complete');
  check(job.done === 6, 'the job records how many were done');
  check(job.lastError === null, 'a successful run clears any previous error');

  const health = getHealth(db).find((h) => h.source === 'spotify');
  check(health?.status === 'ok', 'a successful import records healthy');

  db.close();
}

// --- Resume: the property the whole design exists for -----------------------

{
  const db = fresh();

  // First run: stop after one page, as a kill would.
  const first = stubSpotify(THREE_PAGES);
  const run1 = await importRoster({
    db,
    userId: 1,
    getAccessToken: token,
    fetchImpl: first.impl,
    maxPages: 1,
  });

  check(run1.complete === false, 'a run stopped by the page cap is not complete');
  check(run1.imported === 2, 'the first page is written');
  check(getRoster(db, 1).length === 2, 'two artists are in the database after one page');

  const mid = loadJob(db, JOB_NAME);
  check(mid.status !== 'complete', 'an interrupted job is not marked complete');
  check(mid.cursor.includes('after=a2'), 'the cursor points at the next unread page', mid.cursor);

  // Second run: must continue, not restart.
  const second = stubSpotify(THREE_PAGES);
  const run2 = await importRoster({
    db,
    userId: 1,
    getAccessToken: token,
    fetchImpl: second.impl,
  });

  check(second.requested.length === 2, 'a resume fetches only the remaining pages');
  check(
    second.requested[0].includes('after=a2'),
    'a resume starts at the stored cursor, not the beginning',
    second.requested[0],
  );
  check(run2.complete === true, 'the resumed run completes');
  check(getRoster(db, 1).length === 6, 'the full roster is present after resuming');
  check(loadJob(db, JOB_NAME).done === 6, 'the done count carries across the resume');

  db.close();
}

// --- A failing page never advances the cursor -------------------------------

{
  const db = fresh();
  const spotify = stubSpotify(THREE_PAGES, { failOn: 'a2', failWith: 500 });

  const result = await importRoster({
    db,
    userId: 1,
    getAccessToken: token,
    fetchImpl: spotify.impl,
  });

  check(result.complete === false, 'a failed page means the run is not complete');
  check(result.imported === 2, 'artists from the successful page are kept');
  check(getRoster(db, 1).length === 2, 'the successful page is committed');

  const job = loadJob(db, JOB_NAME);
  check(job.status === 'failed', 'the job is marked failed');
  check(job.lastError !== null, 'the failure is recorded for the UI to show');
  check(
    job.cursor.includes('after=a2'),
    'the cursor stays on the page that failed, so nothing is skipped',
    job.cursor,
  );

  // `!== 'ok'` would also pass when no health row exists at all, which is how a
  // missing recordFailure call slipped through the first version of this check.
  const health = getHealth(db).find((h) => h.source === 'spotify');
  check(health !== undefined, 'a failed import writes a health row for the source');
  check(
    health?.status === 'degraded' || health?.status === 'failing',
    'a failed import marks the source degraded or failing',
    `got ${health?.status}`,
  );
  check(health?.lastError !== null, 'the health row carries the error, for the UI to show');
  check(health?.consecutiveFailures >= 1, 'the failure is counted');

  // The recovery path: the same page succeeds next time.
  const retry = stubSpotify(THREE_PAGES);
  const after = await importRoster({ db, userId: 1, getAccessToken: token, fetchImpl: retry.impl });

  check(after.complete === true, 'retrying after a failure completes the import');
  check(
    retry.requested[0].includes('after=a2'),
    'the retry re-fetches the page that failed rather than skipping it',
  );
  check(getRoster(db, 1).length === 6, 'no artist is lost by the failure');

  db.close();
}

// A thrown network error must be handled like an HTTP failure, not propagate.
{
  const db = fresh();
  const spotify = stubSpotify(THREE_PAGES, { failOn: 'first', failWith: 'throw' });

  const result = await importRoster({
    db,
    userId: 1,
    getAccessToken: token,
    fetchImpl: spotify.impl,
  });

  check(result.complete === false, 'a thrown network error does not escape the job');
  check(/connection reset/.test(result.error ?? ''), 'the network error is reported');
  check(loadJob(db, JOB_NAME).status === 'failed', 'a network error marks the job failed');

  db.close();
}

// --- The checkpoint must never run ahead of the write -----------------------
//
// The subtle one, and the reason this job is written the way it is: if the
// cursor advances before the page is committed, a crash in between loses that
// page forever. The next run resumes past it and nobody notices, because the
// job looks healthy and the roster is merely short.
//
// Found by mutation testing: an earlier version of this suite passed with the
// checkpoint moved before the write, because every test completed the write.
// This asserts the ordering directly, by killing the process in between.

{
  const db = fresh();
  const spotify = stubSpotify(THREE_PAGES);

  /*
   * The crash has to land between the checkpoint and the write, which is the
   * window the ordering protects. Throwing in `fetchImpl` is too early: it runs
   * before either, so a premature checkpoint never executes and the mutant
   * survives. (It did. That is how this comment came to exist.)
   *
   * Making the INSERT itself fail puts the failure in exactly the right place:
   * the page is fetched, any checkpoint the job chooses to write has been
   * written, and then the write dies.
   */
  let pagesSeen = 0;
  db.exec(`
    CREATE TRIGGER crash_on_second_page
    BEFORE INSERT ON artists
    WHEN NEW.name = 'The Notwist'
    BEGIN
      SELECT RAISE(ABORT, 'SIMULATED CRASH');
    END;
  `);

  try {
    await importRoster({
      db,
      userId: 1,
      getAccessToken: token,
      fetchImpl: async (url) => {
        pagesSeen++;
        return spotify.impl(url);
      },
    });
  } catch {
    // The job does not catch a write failure, and should not: a database that
    // cannot write is not a degraded source, it is a broken instance.
  }

  db.exec('DROP TRIGGER crash_on_second_page');

  // Whether the job caught it or it propagated, the invariant is the same:
  // the cursor must not point past a page that was never written.
  const job = loadJob(db, JOB_NAME);
  const rosterAfterCrash = getRoster(db, 1).length;

  check(
    rosterAfterCrash === 2,
    'only the committed page is in the database after a crash',
    `got ${rosterAfterCrash}`,
  );
  check(
    job.cursor.includes('after=a2'),
    'the cursor still points at the page that was not written',
    `cursor: ${job.cursor}`,
  );

  // The proof: resume and confirm nothing was skipped. If the checkpoint had
  // run before the write, page 2's artists would be gone for good.
  const resume = stubSpotify(THREE_PAGES);
  await importRoster({ db, userId: 1, getAccessToken: token, fetchImpl: resume.impl });

  check(
    getRoster(db, 1).length === 6,
    'resuming after a crash loses no artists',
    `got ${getRoster(db, 1).length}`,
  );
  const names = getRoster(db, 1).map((a) => a.name);
  check(names.includes('The Notwist'), 'an artist from the uncommitted page is recovered');
  check(names.includes('Slowdive'), 'the whole uncommitted page is recovered');

  db.close();
}

// --- Idempotence ------------------------------------------------------------

{
  const db = fresh();

  await importRoster({ db, userId: 1, getAccessToken: token, fetchImpl: stubSpotify(THREE_PAGES).impl });
  const firstCount = getRoster(db, 1).length;

  // A completed job restarts from the top: that is how new follows get picked
  // up. Re-importing the same roster must not duplicate anything.
  const second = stubSpotify(THREE_PAGES);
  await importRoster({ db, userId: 1, getAccessToken: token, fetchImpl: second.impl });

  check(
    second.requested[0].includes('type=artist') && !second.requested[0].includes('after='),
    'a completed job starts the next run from the beginning',
  );
  check(getRoster(db, 1).length === firstCount, 're-running creates no duplicate artists');

  const rows = db.prepare('SELECT COUNT(*) AS n FROM artist_external_ids').get();
  check(rows.n === 6, 're-running creates no duplicate external ids', `got ${rows.n}`);

  db.close();
}

// --- Never deletes ----------------------------------------------------------
// An unfollow is not observable from a partial page. Deleting on incomplete
// data would drop artists every time a run was interrupted.

{
  const db = fresh();
  await importRoster({ db, userId: 1, getAccessToken: token, fetchImpl: stubSpotify(THREE_PAGES).impl });

  const shorter = {
    first: { items: [artist('a1', 'Band of Horses')], next: null, total: 1 },
  };
  await importRoster({ db, userId: 1, getAccessToken: token, fetchImpl: stubSpotify(shorter).impl });

  check(
    getRoster(db, 1).length === 6,
    'an import returning fewer artists does not delete the others',
    `got ${getRoster(db, 1).length}`,
  );

  db.close();
}

// --- A token failure is a job failure, not a crash --------------------------

{
  const db = fresh();
  const result = await importRoster({
    db,
    userId: 1,
    getAccessToken: async () => {
      throw new Error('No Spotify account is connected.');
    },
    fetchImpl: stubSpotify(THREE_PAGES).impl,
  });

  check(result.complete === false, 'a missing token stops the run');
  check(/not connected|no spotify/i.test(result.error ?? ''), 'the reason names the missing account');
  check(loadJob(db, JOB_NAME).status === 'failed', 'a token failure marks the job failed');
  check(getRoster(db, 1).length === 0, 'nothing is imported without a token');

  db.close();
}

// --- Abort stops cleanly, not as a failure ----------------------------------

{
  const db = fresh();
  const controller = new AbortController();

  const spotify = stubSpotify(THREE_PAGES);
  const result = await importRoster({
    db,
    userId: 1,
    getAccessToken: token,
    fetchImpl: async (url) => {
      const res = await spotify.impl(url);
      controller.abort(); // stop after the first page is written
      return res;
    },
    signal: controller.signal,
  });

  check(result.complete === false, 'an aborted run is not complete');
  check(result.error === 'aborted', 'an abort is reported as an abort');
  check(loadJob(db, JOB_NAME).status === 'idle', 'an abort is not recorded as a failure');
  check(getRoster(db, 1).length === 2, 'the page written before the abort is kept');
  check(
    loadJob(db, JOB_NAME).cursor.includes('after=a2'),
    'an abort leaves the cursor ready to resume',
  );

  db.close();
}

// --- rosterStatus, which the UI reads ---------------------------------------

{
  const db = fresh();

  const empty = rosterStatus(db, 1);
  check(empty.imported === 0, 'status reports zero before any import');
  check(empty.complete === false, 'status does not claim complete before an import');
  check(empty.total === null, 'status invents no total before Spotify gives one');

  await importRoster({ db, userId: 1, getAccessToken: token, fetchImpl: stubSpotify(THREE_PAGES).impl, maxPages: 1 });

  const partial = rosterStatus(db, 1);
  check(partial.imported === 2, 'status counts rows in the database, not a job counter');
  check(partial.complete === false, 'a partial import is never reported as complete');
  check(partial.total === 6, "status reports Spotify's total once known");

  await importRoster({ db, userId: 1, getAccessToken: token, fetchImpl: stubSpotify(THREE_PAGES).impl });
  check(rosterStatus(db, 1).complete === true, 'status reports complete after a full run');

  db.close();
}

// --- Two artists with the same name ------------------------------------------
//
// From the first real import: 625 followed artists produced 623 rows, with no
// error anywhere. WITCH (Zambian zamrock) and Witch (American doom) share a
// normalised name, as do the two Pentagrams, and the name-based upsert merged
// each pair. Silent, so the only symptom was a count that did not add up.

{
  const db = fresh();
  const collisions = {
    first: {
      items: [
        artist('0LMkPoi2xIgpOPUSJMftqM', 'WITCH'),
        artist('6uNOBEATMcW8SSunnKy9a3', 'Witch'),
        artist('0xybuiDEYo3YuT3fLPaIyE', 'Pentagram'),
        artist('1Xz8iP9Dvl5uI88iraOhs7', 'Pentagram'),
      ],
      next: null,
      total: 4,
    },
  };

  const result = await importRoster({
    db,
    userId: 1,
    getAccessToken: token,
    fetchImpl: stubSpotify(collisions).impl,
  });

  check(result.imported === 4, 'four followed artists import as four', `got ${result.imported}`);
  check(
    getRoster(db, 1).length === 4,
    'same-named artists stay separate rows',
    `got ${getRoster(db, 1).length}`,
  );

  // The count that revealed the bug: external ids exceeded artists.
  const ids = db.prepare('SELECT COUNT(*) AS n FROM artist_external_ids').get().n;
  const rows = db.prepare('SELECT COUNT(*) AS n FROM artists').get().n;
  check(ids === rows, 'every Spotify id has its own artist row', `${ids} ids, ${rows} artists`);

  // And re-importing must not now duplicate them the other way.
  await importRoster({ db, userId: 1, getAccessToken: token, fetchImpl: stubSpotify(collisions).impl });
  check(
    getRoster(db, 1).length === 4,
    're-importing same-named artists creates no duplicates',
    `got ${getRoster(db, 1).length}`,
  );

  db.close();
}

// --- A genuinely empty roster stays distinguishable from a failure ----------

{
  const db = fresh();
  const result = await importRoster({
    db,
    userId: 1,
    getAccessToken: token,
    fetchImpl: stubSpotify({ first: { items: [], next: null, total: 0 } }).impl,
  });

  check(result.complete === true, 'an empty roster is a complete run, not a failure');
  check(result.imported === 0, 'an empty roster imports nothing');
  check(rosterStatus(db, 1).lastError === null, 'an empty roster records no error');

  db.close();
}

console.log(failed ? `\n${failed} check(s) failed` : '\nall roster job checks passed');
process.exit(failed ? 1 : 0);
