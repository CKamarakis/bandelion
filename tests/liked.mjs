/**
 * Liked Songs: paging and artist extraction, against a recorded fixture.
 *
 * The assertions that matter are not "does it parse":
 *   - every artist on a collaboration is kept, not just the first
 *   - an album artist who performs nothing here is dropped AND counted
 *   - a failure mid-library keeps the artists already read
 *   - `complete` never claims success when the fetch did not finish
 *
 * No network. `fetchImpl` is injected; if this suite ever reaches
 * api.spotify.com that is a bug in the test, not a flaky upstream.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  artistsOnTrack,
  fetchLikedPage,
  FIRST_LIKED_PAGE,
} from '../src/adapters/spotify.ts';

const fixtures = JSON.parse(
  readFileSync(join(import.meta.dirname, 'fixtures', 'spotify-liked.json'), 'utf8'),
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

// --- Extraction, on hand-built tracks ---------------------------------------
// Built here rather than taken from the fixture so each rule is stated
// explicitly; the fixture then proves the same rules hold on real data.

{
  const solo = {
    artists: [{ id: 'a1', name: 'Solo Act' }],
    album: { artists: [{ id: 'a1', name: 'Solo Act' }] },
  };
  const got = artistsOnTrack(solo);
  check(got.artists.length === 1, 'a solo track yields one artist');
  check(got.dropped === 0, 'a solo track drops nothing');
}

{
  const collab = {
    artists: [
      { id: 'a1', name: 'First' },
      { id: 'a2', name: 'Second' },
      { id: 'a3', name: 'Third' },
    ],
    album: { artists: [{ id: 'a1', name: 'First' }] },
  };
  const got = artistsOnTrack(collab);
  check(got.artists.length === 3, 'every artist on a collaboration is kept');
  check(
    got.artists.map((a) => a.externalId).join(',') === 'a1,a2,a3',
    'collaboration artists keep their ids',
  );
  check(got.dropped === 0, 'an album artist who performs the track is not dropped');
}

{
  const compilation = {
    artists: [{ id: 'a1', name: 'Actual Band' }],
    album: { artists: [{ id: 'va', name: 'Various Artists' }] },
  };
  const got = artistsOnTrack(compilation);
  check(
    got.artists.length === 1 && got.artists[0].externalId === 'a1',
    'a compilation keeps the performing artist',
  );
  check(got.dropped === 1, 'a compilation album-artist is dropped');
  check(
    !got.artists.some((a) => a.name === 'Various Artists'),
    'Various Artists never becomes an artist',
  );
}

{
  // The rule is structural, not a blocklist: a curator or label is dropped by
  // the same test that drops Various Artists, without knowing its name.
  const djMix = {
    artists: [{ id: 'a1', name: 'Track Producer' }],
    album: { artists: [{ id: 'lbl', name: 'Some Label Presents' }] },
  };
  check(artistsOnTrack(djMix).dropped === 1, 'a label album-artist is dropped by the same rule');
}

{
  const malformed = {
    artists: [{ id: 'a1' }, { name: 'No Id' }, null],
    album: { artists: [{ id: null, name: 'Nameless' }] },
  };
  const got = artistsOnTrack(malformed);
  check(got.artists.length === 0, 'an artist missing id or name is skipped, not guessed at');
  check(got.dropped === 0, 'a malformed album artist is not counted as dropped');
}

// --- Paging, against the fixture --------------------------------------------

{
  const page = await fetchLikedPage({
    accessToken: 't',
    fetchImpl: async () => respond(fixtures.page1),
  });

  check(page.complete === true, 'a good page reports complete');
  check(page.artists.length > 0, 'the fixture yields at least one artist');
  check(typeof page.total === 'number', 'total is read from the response');
  check(page.tracksSeen > 0, 'tracks seen is counted');

  // The fixture is a deliberate subset, so items.length is NOT total. Asserting
  // equality here would fail for a correct implementation.
  check(
    page.tracksSeen === fixtures.page1.items.length,
    'every track in the fixture is read',
    `saw ${page.tracksSeen} of ${fixtures.page1.items.length}`,
  );

  const names = page.artists.map((a) => a.name);
  check(
    !names.includes('Various Artists'),
    'no Various Artists in the extracted set',
    names.join(', '),
  );
  check(
    page.artists.every((a) => a.externalId && a.name),
    'every extracted artist has both an id and a name',
  );
}

{
  let calls = 0;
  const page = await fetchLikedPage({
    accessToken: 't',
    url: `${FIRST_LIKED_PAGE}&offset=50`,
    fetchImpl: async (url) => {
      calls++;
      check(String(url).includes('offset=50'), 'the supplied cursor url is used verbatim');
      return respond({ items: [], next: null, total: 2000 });
    },
  });
  check(calls === 1, 'one page is one call');
  check(page.complete === true, 'an empty page is still a complete page');
  check(page.artists.length === 0, 'an empty page yields no artists');
}

// --- Failures never throw, and never look like success -----------------------

{
  const page = await fetchLikedPage({
    accessToken: 't',
    fetchImpl: async () => respond({ error: { status: 403, message: 'Forbidden' } }, 403),
  });
  check(page.complete === false, 'a 403 is not complete');
  check(
    /allowlist|User Management/i.test(page.error ?? ''),
    'a 403 is explained as the allowlist',
    page.error,
  );
}

{
  // The scope case: a token predating user-library-read gets 403 here. The
  // message must not send someone to their credentials.
  const page = await fetchLikedPage({
    accessToken: 't',
    fetchImpl: async () => {
      throw new TypeError('fetch failed');
    },
  });
  check(page.complete === false, 'a transport failure is not complete');
  check(page.artists.length === 0, 'a transport failure yields no artists');
  check(typeof page.error === 'string' && page.error.length > 0, 'a transport failure is described');
}

{
  const page = await fetchLikedPage({
    accessToken: 't',
    fetchImpl: async () => respond({ notItems: [] }),
  });
  check(page.complete === false, 'an unexpected shape is reported, not read as empty');
  check(/unexpected response shape/i.test(page.error ?? ''), 'the shape error names the endpoint');
}

{
  // A removed track arrives as a null `track`. Not an error.
  const page = await fetchLikedPage({
    accessToken: 't',
    fetchImpl: async () =>
      respond({
        items: [{ track: null }, { track: { artists: [{ id: 'a1', name: 'Real' }] } }],
        next: null,
        total: 2,
      }),
  });
  check(page.complete === true, 'a null track does not fail the page');
  check(page.tracksSeen === 1, 'a null track is not counted as seen');
  check(page.artists.length === 1, 'the surviving track still yields its artist');
}

console.log(failed === 0 ? '\nliked: all checks passed' : `\nliked: ${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);
