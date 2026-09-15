/**
 * The release pass, against recorded MusicBrainz responses.
 *
 * Every date comparison uses the fixture's own `_recordedRelativeTo` stamp as
 * "today", never the real clock. Boy Harsher's GET MEAN was eleven days ahead
 * when recorded; against a live clock this suite would quietly stop testing the
 * upcoming path the moment that date passed, and nothing would fail.
 *
 * No live calls (constraint 1).
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..');

const { openDatabase, upsertArtist, setArtistMbid, insertReleaseEvent } = await import(
  '../src/db/index.ts'
);
const {
  fetchReleaseGroups,
  datePrecision,
  classifyReleaseType,
  inReleaseWindow,
  toReleaseEvent,
} = await import('../src/adapters/musicbrainz.ts');
const { importReleases, releaseStatus } = await import('../src/jobs/releases.ts');
const { loadConfig } = await import('../src/config.ts');
const { normalizeName } = await import('../src/matcher/normalize.ts');

const fixture = JSON.parse(
  readFileSync(join(root, 'tests', 'fixtures', 'musicbrainz-releases.json'), 'utf8'),
);

/** The fixture's own sense of "now". Never `new Date()` — see the header. */
const TODAY = fixture._recordedRelativeTo;

let failed = 0;
const check = (ok, msg, detail) => {
  if (ok) console.log(`pass  ${msg}`);
  else {
    console.error(`FAIL  ${msg}${detail ? `\n      ${detail}` : ''}`);
    failed++;
  }
};

check(Boolean(TODAY), `the fixture records what "today" meant when it was captured (${TODAY})`);

/** Serves the fixture; refuses anything it has not recorded. */
function fixtureFetch(opts = {}) {
  const calls = [];
  return {
    calls,
    fetch: async (url) => {
      calls.push(url);
      if (opts.failFor && url.includes(opts.failFor)) {
        return new Response(JSON.stringify({ error: 'currently busy' }), { status: 503 });
      }
      const u = new URL(url);
      const mbid = u.searchParams.get('artist');
      const hit = fixture.artists[mbid];
      if (!hit) throw new Error(`fixture has no release-groups for ${mbid}`);
      return new Response(JSON.stringify(hit.response), { status: 200 });
    },
  };
}

const noSleep = async () => {};
const client = (f) => ({ contact: 'test', fetchImpl: f, sleep: noSleep });

// --- Date precision ---------------------------------------------------------

console.log('\n# date precision');

check(datePrecision('2026-09-18') === 'day', 'a full date is day precision');
check(datePrecision('2026-09') === 'month', 'year-month is month precision');
check(datePrecision('2026') === 'year', 'a bare year is year precision');
check(datePrecision(null) === null, 'a missing date has no precision');
check(datePrecision('') === null, 'an empty date has no precision');

{
  /*
   * Read the partial dates out of the fixture rather than only asserting on
   * literals. A mutation that widened year-only dates to 'day' passed every
   * check above the first time this suite was written, because the fixture's
   * in-window releases happen to all be day-precision and nothing carried a
   * real partial date through the parser.
   */
  const partials = [];
  for (const entry of Object.values(fixture.artists)) {
    for (const g of entry.response['release-groups'] ?? []) {
      const d = g['first-release-date'];
      if (d && d.length !== 10) partials.push(d);
    }
  }
  check(partials.length > 0, `the fixture contains real partial dates (${partials.join(', ')})`);

  const parsed = partials.map((d) => datePrecision(d));
  check(
    parsed.every((p) => p !== 'day'),
    'no real partial date from the fixture is read as day precision',
    partials.map((d, i) => `${d}=${parsed[i]}`).join(' '),
  );
  check(
    parsed.includes('year') && parsed.includes('month'),
    'both year and month precision are exercised by real data',
  );
}

// --- Type classification ----------------------------------------------------

console.log('\n# release types');

check(classifyReleaseType('Album', []) === 'album', 'a plain album is an album');
check(classifyReleaseType('Single', []) === 'single', 'a plain single is a single');
check(classifyReleaseType('EP', []) === 'ep', 'an EP is an EP');

// Secondary types win: these are the ones that make the feed noisy.
check(classifyReleaseType('Album', ['Live']) === 'live', 'Album + Live is a live record, not an album');
check(classifyReleaseType('Single', ['Live']) === 'live', 'Single + Live is live too');
check(
  classifyReleaseType('Album', ['Compilation', 'DJ-mix']) === 'compilation',
  'Album + Compilation is a compilation',
);
check(classifyReleaseType('Single', ['Remix']) === 'other', 'a remix is filed as other');
check(classifyReleaseType('Album', ['Demo']) === 'other', 'a demo is filed as other');
check(classifyReleaseType(null, []) === 'other', 'an unknown type is other, not a crash');

// --- The window -------------------------------------------------------------

console.log('\n# the release window');

{
  const w = { from: '2026-05-07', to: '2026-11-07' };
  const day = (d) => ({ firstReleaseDate: d, precision: 'day' });

  check(inReleaseWindow(day('2026-09-18'), w), 'a dated release inside the window is included');
  check(!inReleaseWindow(day('2026-01-01'), w), 'a release before the window is excluded');
  check(!inReleaseWindow(day('2027-01-01'), w), 'a release after the window is excluded');
  check(!inReleaseWindow({ firstReleaseDate: null, precision: null }, w), 'an undated release is excluded');

  // The year-only rule: "2026" cannot be placed on a timeline, so it is
  // compared by year rather than dropped or widened to a day.
  check(
    inReleaseWindow({ firstReleaseDate: '2026', precision: 'year' }, w),
    'a year-only release in the window year is included',
  );
  check(
    !inReleaseWindow({ firstReleaseDate: '2019', precision: 'year' }, w),
    'a year-only release from years ago is still excluded',
  );
  check(
    inReleaseWindow({ firstReleaseDate: '2026-09', precision: 'month' }, w),
    'a month-precision release is compared by month',
  );
}

// --- The adapter ------------------------------------------------------------

console.log('\n# fetchReleaseGroups');

{
  const { fetch } = fixtureFetch();
  const boyHarsher = Object.keys(fixture.artists).find(
    (k) => fixture.artists[k].name === 'Boy Harsher',
  );
  const groups = await fetchReleaseGroups(boyHarsher, client(fetch));

  check(groups.length > 0, `release-groups are parsed (${groups.length})`);
  check(
    groups.every((g) => g.mbid && g.title),
    'every parsed group has an mbid and a title',
  );

  const future = groups.filter((g) => (g.firstReleaseDate ?? '') > TODAY);
  check(future.length > 0, `the fixture contains an upcoming release (${future[0]?.title})`);
  check(
    future.every((g) => g.precision !== null),
    'the upcoming release carries a date precision',
  );
}

console.log('\n# toReleaseEvent');

{
  const { fetch } = fixtureFetch();
  const boyHarsher = Object.keys(fixture.artists).find(
    (k) => fixture.artists[k].name === 'Boy Harsher',
  );
  const groups = await fetchReleaseGroups(boyHarsher, client(fetch));
  const future = groups.find((g) => (g.firstReleaseDate ?? '') > TODAY);
  const past = groups.find((g) => (g.firstReleaseDate ?? '') < TODAY);

  const ev = toReleaseEvent(future, { name: 'Boy Harsher', mbid: boyHarsher }, TODAY);
  check(ev.type === 'release', 'the event is a release');
  check(ev.source === 'musicbrainz', 'the event names its source');
  check(ev.sourceEventId === future.mbid, 'the release-group mbid is the source event id');
  check(ev.release.isUpcoming === true, 'a future-dated release is marked upcoming');
  check(ev.announcedAt === null, 'announcedAt stays null — MusicBrainz does not record it');
  check(ev.release.coverUrl === null, 'coverUrl is null rather than invented');
  check(ev.release.totalTracks === null, 'totalTracks is null — not on a release-group');
  check(ev.payload !== null && typeof ev.payload === 'object', 'the raw record is kept as payload');

  const old = toReleaseEvent(past, { name: 'Boy Harsher', mbid: boyHarsher }, TODAY);
  check(old.release.isUpcoming === false, 'a past release is not marked upcoming');
}

// --- The job ----------------------------------------------------------------

console.log('\n# the release job');

/** A database holding exactly the fixture's artists, resolved. */
function seedDb() {
  const db = openDatabase(':memory:');
  for (const [mbid, entry] of Object.entries(fixture.artists)) {
    const id = upsertArtist(db, {
      name: entry.name,
      nameNormalized: normalizeName(entry.name),
    });
    setArtistMbid(db, id, mbid);
  }
  return db;
}

/** A window wide enough that the fixture's dates land inside it. */
const cfg = { ...loadConfig(), releaseWindowMonthsBack: 4, releaseWindowMonthsForward: 2 };

{
  const db = seedDb();
  const { fetch } = fixtureFetch();

  const before = releaseStatus(db);
  check(before.releases === 0, 'no releases before the job runs');
  check(before.checked === 0, 'no artist is marked as checked yet');

  const result = await importReleases({
    db,
    config: cfg,
    contact: 'test',
    fetchImpl: fetch,
    sleep: noSleep,
    today: TODAY,
  });

  check(result.complete === true, 'the job reports complete when the roster is exhausted');
  check(result.written > 0, `releases were written (${result.written})`);
  check(result.upcoming > 0, `an upcoming release was written (${result.upcoming})`);

  const after = releaseStatus(db);
  check(after.releases === result.written, 'the database holds what the job reported writing');
  check(after.checked === Object.keys(fixture.artists).length, 'every artist is stamped as checked');

  // Precision must survive the write: this is the whole point of the column.
  const precisions = db
    .prepare('SELECT DISTINCT date_precision FROM release_details')
    .all()
    .map((r) => r.date_precision);
  check(precisions.length > 0, `date precision is stored (${precisions.join(',')})`);

  const upcomingRows = db
    .prepare('SELECT COUNT(*) c FROM release_details WHERE is_upcoming = 1')
    .get().c;
  check(upcomingRows === result.upcoming, 'upcoming rows are flagged in the database');

  // Nothing outside the window should have been written.
  const outside = db
    .prepare(
      `SELECT COUNT(*) c FROM events
        WHERE type = 'release' AND event_date IS NOT NULL
          AND LENGTH(event_date) = 10 AND event_date < ?`,
    )
    .get('2020-01-01').c;
  check(outside === 0, 'old releases outside the window were not written');
}

console.log('\n# a year-only release survives the whole pipeline');

{
  /*
   * End to end, not just the parser: a year-only record has to reach the
   * database still saying "year". The fixture's own partial dates are all from
   * 2007-2011 and fall outside any sane window, so this widens the window far
   * enough back to pull one through.
   */
  const db = seedDb();
  const { fetch } = fixtureFetch();
  const wide = { ...cfg, releaseWindowMonthsBack: 12 * 20, releaseWindowMonthsForward: 2 };

  await importReleases({
    db,
    config: wide,
    contact: 'test',
    fetchImpl: fetch,
    sleep: noSleep,
    today: TODAY,
  });

  const byPrecision = db
    .prepare('SELECT date_precision, COUNT(*) c FROM release_details GROUP BY date_precision')
    .all();
  const kinds = Object.fromEntries(byPrecision.map((r) => [r.date_precision, r.c]));
  check(Boolean(kinds.year), `a year-only release reached the database (${kinds.year ?? 0})`);
  check(Boolean(kinds.month), `a month-precision release reached the database (${kinds.month ?? 0})`);

  const yearRow = db
    .prepare(
      `SELECT e.event_date FROM events e
         JOIN release_details r ON r.event_id = e.id
        WHERE r.date_precision = 'year' LIMIT 1`,
    )
    .get();
  check(
    /^\d{4}$/.test(yearRow?.event_date ?? ''),
    'the stored date is still a bare year, not widened to a day',
    `stored ${yearRow?.event_date}`,
  );
}

console.log('\n# re-running does not duplicate or re-date');

{
  const db = seedDb();
  const { fetch } = fixtureFetch();
  const opts = { db, config: cfg, contact: 'test', fetchImpl: fetch, sleep: noSleep, today: TODAY };

  const first = await importReleases(opts);
  const seenAt = db
    .prepare("SELECT first_seen_at FROM events WHERE type = 'release' ORDER BY id LIMIT 1")
    .get().first_seen_at;

  const second = await importReleases({ ...opts, fetchImpl: fixtureFetch().fetch });

  check(second.written === 0, 'a second run writes nothing new');
  check(second.inWindow > 0, 'but it did see the same releases again', `${second.inWindow} in window`);
  check(
    releaseStatus(db).releases === first.written,
    'the release count is unchanged after the second run',
  );

  const seenAgain = db
    .prepare("SELECT first_seen_at FROM events WHERE type = 'release' ORDER BY id LIMIT 1")
    .get().first_seen_at;
  check(
    seenAt === seenAgain,
    'first_seen_at is untouched — it records when WE learned of the release',
  );
}

console.log('\n# an unresolved artist is skipped, not guessed');

{
  const db = openDatabase(':memory:');
  upsertArtist(db, { name: 'No MBID Here', nameNormalized: 'no mbid here' });

  const { fetch, calls } = fixtureFetch();
  const result = await importReleases({
    db,
    config: cfg,
    contact: 'test',
    fetchImpl: fetch,
    sleep: noSleep,
    today: TODAY,
  });

  check(result.artistsChecked === 0, 'an artist with no mbid is never swept');
  check(calls.length === 0, 'no request is made for an unresolved artist');
  check(result.complete === true, 'the job still completes');
}

console.log('\n# a busy artist degrades, it does not stop the run');

{
  const db = seedDb();
  const busyMbid = Object.keys(fixture.artists)[0];
  const { fetch } = fixtureFetch({ failFor: busyMbid });

  const result = await importReleases({
    db,
    config: cfg,
    contact: 'test',
    fetchImpl: fetch,
    sleep: noSleep,
    today: TODAY,
  });

  check(result.transientFailures === 1, 'the busy artist is counted as transient');
  check(result.written > 0, 'the other artists still produced releases');
  check(result.complete === true, 'the run finishes rather than aborting');

  const stamped = db
    .prepare('SELECT COUNT(*) c FROM artists WHERE last_release_check_at IS NOT NULL')
    .get().c;
  check(
    stamped === Object.keys(fixture.artists).length - 1,
    'the busy artist is NOT stamped as checked, so the next run retries it',
    `${stamped} stamped`,
  );
}

console.log('\n# budget and resume');

{
  const db = seedDb();
  const total = Object.keys(fixture.artists).length;
  const opts = { db, config: cfg, contact: 'test', sleep: noSleep, today: TODAY };

  const first = await importReleases({ ...opts, fetchImpl: fixtureFetch().fetch, maxArtists: 1 });
  check(first.artistsChecked === 1, 'a budget stops the run early');
  check(first.complete === false, 'a run that stopped early is not reported complete');

  const second = await importReleases({ ...opts, fetchImpl: fixtureFetch().fetch });
  check(second.complete === true, 'the resume finishes the roster');
  check(
    releaseStatus(db).checked === total,
    'every artist is checked after the resume',
    `${releaseStatus(db).checked}/${total}`,
  );
}

console.log('\n# insertReleaseEvent');

{
  const db = openDatabase(':memory:');
  const id = upsertArtist(db, { name: 'X', nameNormalized: 'x' });
  const row = {
    artistId: id,
    title: 'A Record',
    eventDate: '2027',
    datePrecision: 'year',
    sourceEventId: 'rg-1',
    sourceUrl: null,
    releaseType: 'album',
    isUpcoming: true,
    payload: null,
  };

  check(insertReleaseEvent(db, row) === 1, 'a new release is written');
  check(insertReleaseEvent(db, row) === 0, 'the same release-group id writes nothing the second time');
  check(db.prepare("SELECT COUNT(*) c FROM events").get().c === 1, 'only one event row exists');
  check(
    db.prepare('SELECT date_precision FROM release_details').get().date_precision === 'year',
    'year precision is stored as year, not widened to a day',
  );
  check(
    db.prepare('SELECT event_date FROM events').get().event_date === '2027',
    'the partial date is stored verbatim',
  );
}

console.log(failed ? `\n${failed} check(s) failed` : '\nall release checks passed');
// The exit call is the last statement in this file — see decision 031.
process.exit(failed ? 1 : 0);
