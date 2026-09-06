/**
 * MBID resolution: the adapter and the job, against recorded fixtures.
 *
 * The case that matters most is the one that decided the design: two artists
 * called WITCH and two called Pentagram. A name search returns identical
 * results for both members of each pair, so any strategy that trusts the top
 * score merges two bands into one. These tests assert the pairs stay apart.
 *
 * No live calls (constraint 1). Every response is replayed from
 * tests/fixtures/musicbrainz-identity.json.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..');

const { openDatabase, upsertArtist, queueForReview, addArtistLinks, setArtistMbid } = await import(
  '../src/db/index.ts'
);
const { resolveBySpotifyUrl, searchByName, fetchArtistLinks, classifyLink } = await import(
  '../src/adapters/musicbrainz.ts'
);
const { resolveArtists, resolveStatus } = await import('../src/jobs/resolve.ts');
const { normalizeName } = await import('../src/matcher/normalize.ts');

const fixture = JSON.parse(
  readFileSync(join(root, 'tests', 'fixtures', 'musicbrainz-identity.json'), 'utf8'),
);

let failed = 0;
const check = (ok, msg, detail) => {
  if (ok) console.log(`pass  ${msg}`);
  else {
    console.error(`FAIL  ${msg}${detail ? `\n      ${detail}` : ''}`);
    failed++;
  }
};

/**
 * A fetch that serves the fixture and refuses anything it does not recognise.
 *
 * Throwing on an unknown URL is deliberate: a silent fallback to `{}` would let
 * a test pass while the code called an endpoint nobody recorded.
 */
function fixtureFetch(opts = {}) {
  const calls = [];
  return {
    calls,
    fetch: async (url) => {
      calls.push(url);
      if (opts.status503 && calls.length <= opts.status503) {
        // MusicBrainz returns a JSON body on 503 — the exact shape that reads
        // as "empty" if a caller parses before checking status.
        return new Response(JSON.stringify({ error: 'currently busy' }), { status: 503 });
      }

      const u = new URL(url);
      if (u.pathname.endsWith('/url')) {
        const resource = u.searchParams.get('resource');
        const spotifyId = resource?.split('/').pop();
        const hit = fixture.urlLookups[spotifyId];
        if (!hit) return new Response('{}', { status: 404 });
        if (hit.response?.__status === 404) return new Response('{}', { status: 404 });
        return new Response(JSON.stringify(hit.response), { status: 200 });
      }

      if (u.pathname.match(/\/artist\/[0-9a-f-]{36}$/)) {
        const mbid = u.pathname.split('/').pop();
        const links = fixture.artistLinks?.[mbid];
        if (!links) return new Response('{}', { status: 404 });
        return new Response(JSON.stringify(links), { status: 200 });
      }

      if (u.pathname.endsWith('/artist')) {
        const q = u.searchParams.get('query') ?? '';
        const name = q.match(/artist:"([^"]+)"/)?.[1];
        const hit = fixture.nameSearches[name];
        if (!hit) return new Response(JSON.stringify({ artists: [] }), { status: 200 });
        return new Response(JSON.stringify(hit), { status: 200 });
      }

      throw new Error(`fixture has no response for ${url}`);
    },
  };
}

const noSleep = async () => {};
const client = (f) => ({ contact: 'test', fetchImpl: f, sleep: noSleep });

// --- The adapter ------------------------------------------------------------

console.log('\n# resolveBySpotifyUrl');

{
  const { fetch } = fixtureFetch();
  const spotifyIds = Object.keys(fixture.urlLookups);
  const results = [];
  for (const id of spotifyIds) {
    results.push({ id, ...(await resolveBySpotifyUrl(id, client(fetch))) });
  }

  const resolved = results.filter((r) => r.mbid);
  check(resolved.length === spotifyIds.length, `every recorded artist resolves (${resolved.length}/${spotifyIds.length})`);
  check(
    resolved.every((r) => r.method === 'spotify-url'),
    'resolution reports the spotify-url method',
  );

  const mbids = new Set(resolved.map((r) => r.mbid));
  check(
    mbids.size === resolved.length,
    'every artist gets a DISTINCT mbid — the two WITCHes and two Pentagrams stay apart',
    `${resolved.length} artists produced ${mbids.size} mbids`,
  );

  // Name the specific pairs, so a regression says which one broke.
  const byName = (n) => results.filter((r) => fixture.urlLookups[r.id].artist.toLowerCase() === n);
  for (const name of ['witch', 'pentagram']) {
    const pair = byName(name);
    check(
      pair.length === 2 && pair[0].mbid !== pair[1].mbid,
      `the two ${name} artists resolve to different mbids`,
      pair.map((p) => p.mbid).join(' vs '),
    );
  }
}

console.log('\n# searchByName never auto-accepts');

{
  const { fetch } = fixtureFetch();
  const r = await searchByName('WITCH', client(fetch));
  check(r.mbid === null, 'name search returns no mbid, only candidates');
  check((r.candidates?.length ?? 0) > 1, 'name search returns several candidates to judge');

  // The reason the design does not trust this: both roster WITCHes would get
  // this same top hit.
  const other = await searchByName('Witch', client(fetch));
  check(
    r.candidates?.[0]?.mbid === other.candidates?.[0]?.mbid,
    'a name search cannot tell the two WITCHes apart — which is why it is a fallback',
  );
}

console.log('\n# 503 handling');

{
  // Two 503s then the real response: a JSON body on 503 must not be read as data.
  const { fetch, calls } = fixtureFetch({ status503: 2 });
  const id = Object.keys(fixture.urlLookups)[0];
  const r = await resolveBySpotifyUrl(id, client(fetch));
  check(r.mbid !== null, 'a 503 is retried rather than read as an empty result');
  check(calls.length === 3, `retried until success (${calls.length} calls)`);
}

console.log('\n# link classification');

{
  check(classifyLink('social network', 'https://www.instagram.com/band/') === 'instagram', 'instagram by host');
  check(classifyLink('free streaming', 'https://open.spotify.com/artist/x') === 'spotify', 'spotify by host');
  check(classifyLink('official homepage', 'https://example.com') === 'website', 'homepage by relation type');
  check(classifyLink('purchase for download', 'https://band.bandcamp.com/') === 'bandcamp', 'bandcamp by host');
  check(classifyLink('social network', 'https://www.tiktok.com/@band') === 'tiktok', 'tiktok by host');
  check(classifyLink('whatever', 'not a url') === 'other', 'an unparseable url is other, not a crash');
}

// --- The job ----------------------------------------------------------------

console.log('\n# the resolve job');

/** A database seeded with the fixture's artists, mbid deliberately NULL. */
function seedDb() {
  const db = openDatabase(':memory:');
  for (const [spotifyId, entry] of Object.entries(fixture.urlLookups)) {
    upsertArtist(db, {
      name: entry.artist,
      nameNormalized: normalizeName(entry.artist),
      externalId: { source: 'spotify', id: spotifyId },
    });
  }
  return db;
}

{
  const db = seedDb();
  const { fetch } = fixtureFetch();
  const before = resolveStatus(db);
  check(before.resolved === 0, 'nothing is resolved before the job runs');

  const result = await resolveArtists({ db, contact: 'test', fetchImpl: fetch, sleep: noSleep });

  check(result.complete === true, 'the job reports complete when the roster is exhausted');
  check(result.resolved === before.total, `every artist resolved (${result.resolved}/${before.total})`);

  const after = resolveStatus(db);
  check(after.resolved === after.total, 'the database agrees every artist has an mbid');

  const distinct = db.prepare('SELECT COUNT(DISTINCT mbid) c FROM artists WHERE mbid IS NOT NULL').get().c;
  check(distinct === after.total, 'the job wrote distinct mbids, not one shared identity', `${distinct} of ${after.total}`);

  const links = db.prepare('SELECT COUNT(*) c FROM artist_links').get().c;
  check(links > 0, `artist links were stored alongside the identity (${links})`);
  const kinds = db.prepare('SELECT DISTINCT kind FROM artist_links').all().map((r) => r.kind);
  check(!kinds.includes('spotify'), 'the spotify link is not stored back — we already have that id');
}

console.log('\n# the job is resumable and honest');

{
  const db = seedDb();
  const { fetch } = fixtureFetch();
  const total = resolveStatus(db).total;

  const first = await resolveArtists({ db, contact: 'test', fetchImpl: fetch, sleep: noSleep, maxArtists: 2 });
  check(first.attempted === 2, 'a budget stops the run early');
  check(first.complete === false, 'a run that stopped early is never reported complete');

  const mid = resolveStatus(db);
  check(mid.resolved === 2, 'work done before the stop is kept');

  const second = await resolveArtists({ db, contact: 'test', fetchImpl: fetch, sleep: noSleep });
  check(second.complete === true, 'resuming finishes the roster');
  check(resolveStatus(db).resolved === total, 'every artist is resolved after the resume');

  // The resume must not redo work: only the remaining artists get looked up.
  check(
    second.attempted === total - 2,
    `the resume skipped the artists already done (${second.attempted} of ${total - 2})`,
  );
}

console.log('\n# an unresolvable artist is queued, never guessed');

{
  const db = openDatabase(':memory:');
  // An artist whose Spotify id has no MusicBrainz url relation, but whose name
  // does match several candidates.
  upsertArtist(db, {
    name: 'WITCH',
    nameNormalized: normalizeName('WITCH'),
    externalId: { source: 'spotify', id: 'unknown-spotify-id' },
  });

  const { fetch } = fixtureFetch();
  const result = await resolveArtists({ db, contact: 'test', fetchImpl: fetch, sleep: noSleep });

  check(result.resolved === 0, 'no mbid is invented when the url lookup finds nothing');
  check(result.queued === 1, 'the artist goes to the review queue instead');

  const row = db.prepare('SELECT * FROM match_queue').get();
  check(row?.status === 'pending', 'the queued row is pending a human decision');
  check(
    db.prepare('SELECT mbid FROM artists').get().mbid === null,
    'the artist still has no mbid — a guess is worse than nothing',
  );

  const payload = JSON.parse(row.payload_json);
  check((payload.candidates?.length ?? 0) > 1, 'the queue row carries the candidates to choose between');
}

console.log('\n# a busy MusicBrainz degrades, it does not stop the run');

{
  const db = seedDb();
  const total = resolveStatus(db).total;

  // Fail the first artist's lookup permanently, serve everyone else normally.
  const { fetch: inner } = fixtureFetch();
  let firstArtistCalls = 0;
  const flaky = async (url) => {
    if (url.includes(Object.keys(fixture.urlLookups)[0])) {
      firstArtistCalls++;
      return new Response(JSON.stringify({ error: 'currently busy' }), { status: 503 });
    }
    return inner(url);
  };

  const result = await resolveArtists({ db, contact: 'test', fetchImpl: flaky, sleep: noSleep });

  check(result.transientFailures === 1, `the busy artist is counted as transient (${result.transientFailures})`);
  check(result.resolved === total - 1, `every other artist still resolved (${result.resolved}/${total - 1})`);
  check(result.complete === true, 'the run finishes rather than aborting on one busy lookup');
  check(firstArtistCalls > 1, `the busy artist was retried before giving up (${firstArtistCalls} attempts)`);

  // The skipped artist keeps mbid NULL, so the next run picks it up again.
  const stillNull = db.prepare('SELECT COUNT(*) c FROM artists WHERE mbid IS NULL').get().c;
  check(stillNull === 1, 'the skipped artist is left for the next run');
}

console.log('\n# health reflects what happened');

{
  const db = seedDb();
  // Everything 503s: the job did not crash, but the source is not healthy.
  const alwaysBusy = async () =>
    new Response(JSON.stringify({ error: 'currently busy' }), { status: 503 });

  const result = await resolveArtists({ db, contact: 'test', fetchImpl: alwaysBusy, sleep: noSleep });
  check(result.resolved === 0, 'nothing resolves when the source is down');

  const health = db.prepare("SELECT status FROM adapter_health WHERE source = 'musicbrainz'").get();
  check(
    health?.status !== 'ok',
    'a run where every lookup failed is not reported as a healthy source',
    `status was ${health?.status}`,
  );
}

console.log('\n# an existing identity is never overwritten');

{
  const db = openDatabase(':memory:');
  const id = upsertArtist(db, { name: 'Haken', nameNormalized: 'haken' });
  setArtistMbid(db, id, 'human-confirmed-mbid');
  setArtistMbid(db, id, 'a-different-mbid');
  check(
    db.prepare('SELECT mbid FROM artists WHERE id = ?').get(id).mbid === 'human-confirmed-mbid',
    'setArtistMbid does not overwrite an identity that is already set',
  );
}

console.log('\n# db helpers');

{
  const db = openDatabase(':memory:');
  const id = upsertArtist(db, { name: 'Test', nameNormalized: 'test' });

  const first = addArtistLinks(db, id, [{ kind: 'bandcamp', url: 'https://x.bandcamp.com/' }], 'musicbrainz');
  const again = addArtistLinks(db, id, [{ kind: 'bandcamp', url: 'https://x.bandcamp.com/' }], 'musicbrainz');
  check(first === 1 && again === 0, 'adding the same link twice writes one row');
  check(addArtistLinks(db, id, [], 'musicbrainz') === 0, 'an empty link list is a no-op');

  queueForReview(db, { rawName: 'A', source: 'musicbrainz', score: 0.5 });
  queueForReview(db, { rawName: 'A', source: 'eventim', score: 0.5 });
  check(
    db.prepare('SELECT COUNT(*) c FROM match_queue').get().c === 2,
    'the same name from two sources is two judgements, not one',
  );
}

console.log(failed ? `\n${failed} check(s) failed` : '\nall resolve checks passed');
// The exit call is the last statement in the file — see decision 031.
process.exit(failed ? 1 : 0);
