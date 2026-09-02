/**
 * The Spotify roster adapter, against recorded fixtures.
 *
 * The assertions that matter here are not "does it parse". They are:
 *   - a failure mid-roster keeps the artists already fetched
 *   - `complete` never claims success when the fetch did not finish
 *   - a 403 is explained as the allowlist, because that is what it always is
 *
 * No network. `fetchImpl` is injected; if this suite ever hits accounts.
 * spotify.com it is a bug in the test, not a flaky upstream.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fetchFollowedArtists, spotifyAdapter } from '../src/adapters/spotify.ts';
import { normalizeName } from '../src/matcher/normalize.ts';

const fixtures = JSON.parse(
  readFileSync(join(import.meta.dirname, 'fixtures', 'spotify-following.json'), 'utf8'),
);

let failed = 0;
const check = (ok, msg, detail) => {
  if (ok) console.log(`pass  ${msg}`);
  else {
    console.error(`FAIL  ${msg}${detail ? `\n      ${detail}` : ''}`);
    failed++;
  }
};

const respond = (body, status = 200, headers = {}) => ({
  ok: status < 400,
  status,
  headers: new Headers(headers),
  async json() {
    return body;
  },
  async text() {
    return JSON.stringify(body);
  },
});

/** Serves the two recorded pages, following the cursor like Spotify does. */
function pagedFetch(onCall = () => {}) {
  return async (url) => {
    onCall(String(url));
    return String(url).includes('after=')
      ? respond(fixtures.page2)
      : respond(fixtures.page1);
  };
}

// --- The happy path ---------------------------------------------------------

const urls = [];
const ok = await fetchFollowedArtists({
  accessToken: 'test_token',
  fetchImpl: pagedFetch((u) => urls.push(u)),
});

check(ok.complete === true, 'a finished fetch reports complete');
check(ok.error === undefined, 'a finished fetch reports no error');
check(ok.artists.length === 3, 'both pages are collected', `got ${ok.artists.length}`);
check(urls.length === 2, 'the cursor is followed exactly once', `got ${urls.length} requests`);
check(urls[1].includes('after=3xR6ZBAsGoLnPYqPZmVJcH'), 'the second request uses the cursor from page 1');

const [horses, sigur, thethe] = ok.artists;
check(horses.name === 'Band of Horses', 'artist names are read');
check(horses.externalId === '0OdUWJ0sBjDrqHygGUXeCF', 'the Spotify id is captured as externalId');
check(horses.imageUrl === 'https://i.scdn.co/image/ab6761610000e5eb1', 'the largest image is taken');
check(horses.genres.length === 2, 'genres are carried through');
check(horses.popularity === 62, 'popularity is carried through');

// An artist with no images is normal (small acts). It must not become undefined
// or an exception — the UI checks for null.
check(thethe.imageUrl === null, 'an artist with no images yields null, not undefined');
check(Array.isArray(thethe.genres), 'genres is always an array');

// These names exist in the fixture precisely because they are the matcher's
// hard cases: an accent, and a name that is entirely a stopword article.
check(normalizeName(sigur.name).length > 0, 'an accented name normalizes to something non-empty');
check(normalizeName(thethe.name).length > 0, 'a name made only of articles does not normalize to empty');

// --- Auth is required -------------------------------------------------------

const noToken = await spotifyAdapter.fetch({ city: 'Berlin', from: '2026-09-01', to: '2026-12-01' });
check(noToken.complete === false, 'no access token is reported as incomplete, not as an empty result');
check(noToken.events.length === 0, 'no access token yields no events');
check(/token/i.test(noToken.error ?? ''), 'the error names the missing token');

check(
  spotifyAdapter.enabled({ SPOTIFY_CLIENT_ID: 'a', SPOTIFY_CLIENT_SECRET: 'b' }),
  'the adapter is enabled when both credentials are present',
);
check(!spotifyAdapter.enabled({ SPOTIFY_CLIENT_ID: 'a' }), 'a missing secret disables the adapter');
check(!spotifyAdapter.enabled({}), 'no credentials disables the adapter');
check(
  !spotifyAdapter.enabled({ SPOTIFY_CLIENT_ID: '   ', SPOTIFY_CLIENT_SECRET: '  ' }),
  'whitespace-only credentials do not count as configured',
);

// --- Failure never throws, and never lies -----------------------------------
// This is constraint 2. An adapter that throws takes the whole ingest with it.

const http403 = await fetchFollowedArtists({
  accessToken: 'bad',
  fetchImpl: async () => respond(fixtures.error403, 403),
});
check(http403.complete === false, 'a 403 reports incomplete');
check(http403.artists.length === 0, 'a 403 yields no artists');
check(
  /allowlist|User Management|development mode/i.test(http403.error ?? ''),
  'a 403 explains the development-mode allowlist rather than saying "failed"',
  http403.error,
);

const http429 = await fetchFollowedArtists({
  accessToken: 't',
  fetchImpl: async () => respond(fixtures.error429, 429, { 'retry-after': '30' }),
});
check(/rate limit/i.test(http429.error ?? ''), 'a 429 is reported as a rate limit');
check(/30/.test(http429.error ?? ''), 'the retry-after value is surfaced');

const http401 = await fetchFollowedArtists({
  accessToken: 'expired',
  fetchImpl: async () => respond({ error: { status: 401, message: 'The access token expired' } }, 401),
});
check(/401|expired|invalid/i.test(http401.error ?? ''), 'a 401 is reported as an expired token');

// A thrown network error is the case that would take down an ingest run.
const netFail = await fetchFollowedArtists({
  accessToken: 't',
  fetchImpl: async () => {
    throw new TypeError('fetch failed');
  },
});
check(netFail.complete === false, 'a thrown network error is caught, not propagated');
check(netFail.artists.length === 0, 'a network error yields no artists');
check(/fetch failed/.test(netFail.error ?? ''), 'the network error message is preserved');

// The one that matters most: page 1 succeeds, page 2 dies. Losing the first
// page because the second failed would make every poll all-or-nothing.
const partial = await fetchFollowedArtists({
  accessToken: 't',
  fetchImpl: async (url) => {
    if (String(url).includes('after=')) throw new Error('connection reset');
    return respond(fixtures.page1);
  },
});
check(partial.artists.length === 2, 'a failure on page 2 keeps the artists from page 1');
check(partial.complete === false, 'a partial roster is never reported as complete');
check(/connection reset/.test(partial.error ?? ''), 'the partial result explains why it stopped');

// Silence vs emptiness: the defining bug class in this project.
const shapeChange = await fetchFollowedArtists({
  accessToken: 't',
  fetchImpl: async () => respond({ artists: { total: 0 } }),
});
check(shapeChange.complete === false, 'an unrecognised response shape is not reported as complete');
check(
  /shape|items/i.test(shapeChange.error ?? ''),
  'an unrecognised shape says so, rather than reading zero artists silently',
  shapeChange.error,
);

// A genuinely empty roster is different, and must stay distinguishable.
const trulyEmpty = await fetchFollowedArtists({
  accessToken: 't',
  fetchImpl: async () => respond({ artists: { items: [], next: null, total: 0 } }),
});
check(trulyEmpty.complete === true, 'a genuinely empty roster reports complete');
check(trulyEmpty.artists.length === 0, 'a genuinely empty roster has no artists');

// A cursor that never ends would otherwise hang ingest forever.
const looping = await fetchFollowedArtists({
  accessToken: 't',
  maxPages: 3,
  fetchImpl: async () =>
    respond({
      artists: {
        items: [{ id: 'x', name: 'Loop' }],
        next: 'https://api.spotify.com/v1/me/following?type=artist&after=x',
      },
    }),
});
check(looping.complete === false, 'a non-terminating cursor stops and reports incomplete');
check(looping.artists.length === 3, 'the page cap is respected', `got ${looping.artists.length}`);

// Malformed items must be skipped, not crash the run or become empty artists.
const junk = await fetchFollowedArtists({
  accessToken: 't',
  fetchImpl: async () =>
    respond({
      artists: {
        items: [null, { name: 'No Id' }, { id: 'no-name' }, { id: 'ok', name: 'Real Band' }],
        next: null,
      },
    }),
});
check(junk.complete === true, 'malformed items do not fail the whole page');
check(junk.artists.length === 1, 'items missing an id or name are skipped', `got ${junk.artists.length}`);
check(junk.artists[0].name === 'Real Band', 'the valid item survives');

console.log(failed ? `\n${failed} check(s) failed` : '\nall spotify adapter checks passed');
process.exit(failed ? 1 : 0);
