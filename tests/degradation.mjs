/**
 * Constraint 2, as an assertion: a source that is down for a whole run leaves
 * the feed exactly as it was, and says so in adapter_health.
 *
 * The architecture's central promise. CLAUDE.md claimed a test for it long
 * before one existed, which is the failure mode constraint 3 exists to catch.
 *
 * This is the data half. The page renders from stored events and never reads
 * adapter_health, so "the feed still renders" is proved by rendering in the
 * container smoke job (.github/workflows/verify.yml); here we prove the events
 * it renders from survive.
 *
 * No live calls (constraint 1): every request in this file fails on purpose.
 */

const { openDatabase, upsertArtist, setArtistMbid, insertReleaseEvent, setCoverArt, getFeed, getHealth } =
  await import('../src/db/index.ts');
const { importReleases } = await import('../src/jobs/releases.ts');
const { importCovers } = await import('../src/jobs/covers.ts');
const { loadConfig } = await import('../src/config.ts');
const { normalizeName } = await import('../src/matcher/normalize.ts');

let failed = 0;
const check = (ok, msg, detail) => {
  if (ok) console.log(`pass  ${msg}`);
  else {
    console.error(`FAIL  ${msg}${detail ? `\n      ${detail}` : ''}`);
    failed++;
  }
};

const TODAY = '2026-09-25';
const noSleep = async () => {};

/** Every request is an outage. Counted, so a test can prove the job tried. */
function downFetch(status = 503) {
  const calls = [];
  return {
    calls,
    fetch: async (url) => {
      calls.push(String(url));
      return new Response(JSON.stringify({ error: 'down' }), { status });
    },
  };
}

/**
 * Three resolved artists, not yet swept, each with a release already stored —
 * the state an instance is in after a previous run, before this one fails.
 * One release already has its cover, one is known to have none, one is unasked.
 */
function seed() {
  const db = openDatabase(':memory:');
  const releases = [];
  const artists = [
    ['Boy Harsher', '5d5a6a6e-1b0e-4d3c-9c7e-000000000001', 'GET MEAN'],
    ['Bonobo', '5d5a6a6e-1b0e-4d3c-9c7e-000000000002', 'Distance in Static'],
    ['Haken', '5d5a6a6e-1b0e-4d3c-9c7e-000000000003', 'Someday'],
  ];
  artists.forEach(([name, mbid, title], i) => {
    const id = upsertArtist(db, { name, nameNormalized: normalizeName(name) });
    setArtistMbid(db, id, mbid);
    insertReleaseEvent(db, {
      artistId: id, title, eventDate: `2026-09-0${i + 1}`, datePrecision: 'day',
      sourceEventId: `8f0c0000-0000-4000-8000-00000000000${i + 1}`, sourceUrl: null,
      releaseType: 'album', isUpcoming: false, payload: null,
    });
    releases.push(title);
  });

  const rows = getFeed(db, { type: 'release' });
  const byTitle = Object.fromEntries(rows.map((r) => [r.title, r.eventId]));
  setCoverArt(db, byTitle['GET MEAN'], 'https://coverartarchive.org/release-group/x/front');
  setCoverArt(db, byTitle['Distance in Static'], null);
  return { db, releases };
}

/** What a reader would see: title, date and cover, in feed order. */
const snapshot = (db) =>
  JSON.stringify(
    getFeed(db, { type: 'release' }).map((r) => [r.title, r.eventDate, r.coverUrl ?? null]),
  );

const healthOf = (db, source) => getHealth(db).find((h) => h.source === source);

// --- MusicBrainz down for a whole release sweep ------------------------------

console.log('\n# MusicBrainz down for a whole release sweep');

{
  const { db, releases } = seed();
  const before = snapshot(db);
  const { fetch, calls } = downFetch();

  const cfg = { ...loadConfig(), releaseWindowMonthsBack: 4, releaseWindowMonthsForward: 2 };
  const result = await importReleases({
    db, config: cfg, contact: 'test', fetchImpl: fetch, sleep: noSleep, today: TODAY,
  });

  check(calls.length > 0, `the sweep actually asked MusicBrainz (${calls.length} requests)`);
  check(result.transientFailures === releases.length, 'every artist failed');
  check(snapshot(db) === before, 'every stored release is still in the feed, unchanged', snapshot(db));
  check(getFeed(db, { type: 'release' }).length === releases.length, 'the feed is not empty');

  const h = healthOf(db, 'musicbrainz');
  check(
    h?.status === 'degraded' || h?.status === 'failing',
    `musicbrainz is marked degraded or failing (${h?.status})`,
  );
  check(Boolean(h?.lastError), 'the failure is recorded for the UI to show');
  check(result.complete !== true, 'a sweep where every artist failed is not reported complete');
}

// --- Cover Art Archive down for a whole cover pass ---------------------------

console.log('\n# Cover Art Archive down for a whole cover pass');

{
  const { db } = seed();
  const before = snapshot(db);
  const { fetch, calls } = downFetch();

  const result = await importCovers({ db, contact: 'test', fetchImpl: fetch, sleep: noSleep });

  check(calls.length > 0, `the pass actually asked the archive (${calls.length} requests)`);
  check(snapshot(db) === before, 'no release lost its cover or its place in the feed', snapshot(db));

  const h = healthOf(db, 'coverartarchive');
  check(
    h?.status === 'degraded' || h?.status === 'failing',
    `coverartarchive is marked degraded or failing (${h?.status})`,
  );
  check(result.complete !== true, 'a pass where every lookup failed is not reported complete');

  // Still unasked, so the next run retries it rather than believing "no art".
  const retry = downFetch();
  await importCovers({ db, contact: 'test', fetchImpl: retry.fetch, sleep: noSleep });
  check(retry.calls.length > 0, 'the unreached release is asked about again on the next run');
}

console.log(failed ? `\n${failed} check(s) failed` : '\nall degradation checks passed');
// Last statement on purpose: checks after an exit never run (decision 031).
process.exit(failed ? 1 : 0);
