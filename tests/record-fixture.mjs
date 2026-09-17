/**
 * Capture a live upstream response into tests/fixtures/.
 *
 * Constraint 1 says no test calls a live third-party API. This is the one
 * script that does, and it is not a test: you run it by hand, it writes a file,
 * and from then on the suite replays that file. When a source changes its JSON,
 * you re-record and the diff names what broke.
 *
 * Usage:
 *   npm run fixtures:record -- albums <artistId> [<artistId>...]
 *   npm run fixtures:record -- following
 *   npm run fixtures:record -- liked
 *   npm run fixtures:record -- roster-sample [count]
 *   npm run fixtures:record -- mbid
 *   npm run fixtures:record -- releases
 *
 * `mbid` records MusicBrainz identity lookups and needs no Spotify token. It
 * deliberately records the ambiguous roster names (two WITCHes, two
 * Pentagrams), because they are the cases that decide how resolution works.
 *
 * `roster-sample` picks artists out of your own imported roster, spread across
 * the popularity range, because a fixture recorded only from famous artists
 * misses the shapes that break parsers — the missing image, the empty genre
 * list, the single with no album.
 *
 * The token comes from the database via getAccessToken, which refreshes it if
 * it has expired. Nothing here handles OAuth: connect the account in the UI
 * first.
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { loadDotEnv } from '../src/config-env.ts';

// Before any import that reads process.env — see decision 030. The imports
// below are dynamic for exactly that reason.
loadDotEnv();

const { getAccessToken, db, NotConnectedError } = await import('../src/auth/session.ts');

const root = join(import.meta.dirname, '..');
const FIXTURES = join(root, 'tests', 'fixtures');
const API = 'https://api.spotify.com/v1';

const [mode, ...rest] = process.argv.slice(2);

if (!mode) {
  console.error(
    'Usage:\n' +
      '  npm run fixtures:record -- albums <artistId> [<artistId>...]\n' +
      '  npm run fixtures:record -- following\n' +
      '  npm run fixtures:record -- liked          (Liked Songs, trimmed by shape)\n' +
      '  npm run fixtures:record -- roster-sample [count]\n' +
      '  npm run fixtures:record -- mbid            (MusicBrainz identity, no Spotify token)\n' +
      '  npm run fixtures:record -- releases        (MusicBrainz release-groups)',
  );
  process.exit(2);
}

/**
 * MusicBrainz release-groups, recorded for the release pass.
 *
 * Chosen, not sampled. The set has to contain the cases the code must get
 * right, or the tests prove nothing:
 *
 *  - Boy Harsher: a genuinely upcoming release (GET MEAN, dated ahead of the
 *    recording). Spotify has no future-dated releases at all — checked across
 *    60 artists and 542 albums — so the lookahead is MusicBrainz-only, and
 *    without this artist no test exercises it.
 *  - Haken: Fauna and Fauna (Deluxe Edition), the deluxe-vs-repressing case
 *    that `total_tracks` exists to separate.
 */
if (mode === 'releases') {
  const { loadConfig } = await import('../src/config.ts');
  const contact = loadConfig().musicbrainzContact;
  if (!contact) {
    console.error('MUSICBRAINZ_CONTACT is not set; MusicBrainz needs a real User-Agent.');
    process.exit(1);
  }

  const ua = `Bandelion/0.1 ( ${contact} )`;
  const pause = (ms) => new Promise((r) => setTimeout(r, ms));

  async function mbGet(path) {
    for (let attempt = 0; attempt < 6; attempt++) {
      let res;
      try {
        res = await fetch(`https://musicbrainz.org/ws/2/${path}`, {
          headers: { 'User-Agent': ua, Accept: 'application/json' },
        });
      } catch {
        await pause(3000);
        continue;
      }
      // A 5xx carries a JSON body, so status is checked before parsing.
      if (res.status >= 500) { await pause(3000); continue; }
      if (!res.ok) throw new Error(`GET ${path} -> ${res.status}`);
      return res.json();
    }
    throw new Error(`MusicBrainz stayed busy: ${path}`);
  }

  const wanted = ['Boy Harsher', 'Haken', 'Molly Nilsson', 'Tramhaus'];
  const rows = db()
    .prepare(
      `SELECT id, name, mbid FROM artists
        WHERE mbid IS NOT NULL AND name IN (${wanted.map(() => '?').join(',')})
        ORDER BY name`,
    )
    .all(...wanted);

  if (rows.length === 0) {
    console.error('None of the chosen artists are resolved yet. Run: npm run ingest resolve');
    process.exit(1);
  }

  const today = new Date().toISOString().slice(0, 10);
  const recorded = {
    _comment:
      'Live GET /ws/2/release-group?artist=<mbid>, recorded by ' +
      'npm run fixtures:record -- releases. Browse, not search: search paging is ' +
      'unstable and drops ~22% of rows per sweep (decision 033). Chosen artists, ' +
      'not sampled — Boy Harsher carries a future-dated release, which Spotify ' +
      'does not expose at all, and Haken carries a deluxe edition sharing a date ' +
      'with its standard release.',
    _recordedAt: new Date().toISOString(),
    _recordedRelativeTo: today,
    artists: {},
  };

  for (const row of rows) {
    const data = await mbGet(`release-group?artist=${row.mbid}&fmt=json&limit=100`);
    const groups = data['release-groups'] ?? [];
    const future = groups.filter((g) => (g['first-release-date'] ?? '') > today).length;
    recorded.artists[row.mbid] = { name: row.name, response: data };
    console.log(`  ${row.name}: ${groups.length} release-groups, ${future} future-dated`);
    await pause(1200);
  }

  const totalFuture = Object.values(recorded.artists).reduce(
    (n, a) => n + (a.response['release-groups'] ?? []).filter((g) => (g['first-release-date'] ?? '') > today).length,
    0,
  );
  write('musicbrainz-releases.json', recorded);
  if (totalFuture === 0) {
    console.log(
      '\nWarning: no future-dated release in this recording, so the upcoming\n' +
        'path is not covered. Pick an artist with one before relying on it.',
    );
  } else {
    console.log(`\n${totalFuture} future-dated release-group(s) captured.`);
  }
  process.exit(0);
}

/**
 * MusicBrainz identity resolution, recorded from the ambiguous cases.
 *
 * The cases that matter are chosen rather than sampled: the two WITCHes and two
 * Pentagrams are the reason resolution works the way it does, so the fixture
 * has to contain them or the tests prove nothing.
 */
if (mode === 'mbid') {
  const { loadConfig } = await import('../src/config.ts');
  const contact = loadConfig().musicbrainzContact;
  if (!contact) {
    console.error('MUSICBRAINZ_CONTACT is not set; MusicBrainz needs a real User-Agent.');
    process.exit(1);
  }

  const ua = `Bandelion/0.1 ( ${contact} )`;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  async function mbIdentityGet(path) {
    for (let attempt = 0; attempt < 5; attempt++) {
      const res = await fetch(`https://musicbrainz.org/ws/2/${path}`, {
        headers: { 'User-Agent': ua, Accept: 'application/json' },
      });
      // A 503 carries a JSON body, so status must be checked before parsing.
      if (res.status === 503) { await sleep(2500); continue; }
      if (res.status === 404) return { __status: 404 };
      if (!res.ok) throw new Error(`GET ${path} -> ${res.status}`);
      return res.json();
    }
    throw new Error(`MusicBrainz stayed busy: ${path}`);
  }

  const rows = db()
    .prepare(
      `SELECT a.id, a.name, x.external_id AS spotifyId
         FROM artists a
         JOIN artist_external_ids x ON x.artist_id = a.id AND x.source = 'spotify'
        WHERE a.name_normalized IN ('witch','pentagram')
           OR a.name IN ('Haken', '*shels')
        ORDER BY a.name_normalized, a.id`,
    )
    .all();

  if (rows.length === 0) {
    console.error('No matching artists in the roster. Import it first.');
    process.exit(1);
  }

  const recorded = {
    _comment:
      'Live MusicBrainz responses, recorded by npm run fixtures:record -- mbid. ' +
      'Contains the ambiguous pairs (two WITCHes, two Pentagrams) because they ' +
      'are why resolution joins on the Spotify URL relation rather than on a ' +
      'name search — a name query for either returns identical results. ' +
      'A 503 from MusicBrainz returns a JSON body, so status is checked first.',
    _recordedAt: new Date().toISOString(),
    urlLookups: {},
    nameSearches: {},
  };

  for (const row of rows) {
    const resource = `https://open.spotify.com/artist/${row.spotifyId}`;
    recorded.urlLookups[row.spotifyId] = {
      artist: row.name,
      response: await mbIdentityGet(`url?resource=${encodeURIComponent(resource)}&inc=artist-rels&fmt=json`),
    };
    console.log(`  url  ${row.name} (${row.spotifyId})`);
    await sleep(1200);
  }

  for (const name of ['WITCH', 'Witch', 'Pentagram']) {
    const q = encodeURIComponent(`artist:"${name}"`);
    recorded.nameSearches[name] = await mbIdentityGet(`artist?query=${q}&fmt=json&limit=5`);
    console.log(`  name ${name}`);
    await sleep(1200);
  }

  // One artist's links, so the link classifier has real relation shapes.
  const haken = rows.find((r) => r.name === 'Haken');
  const hakenMbid = haken
    ? recorded.urlLookups[haken.spotifyId]?.response?.relations?.find((r) => r.artist)?.artist?.id
    : null;
  if (hakenMbid) {
    recorded.artistLinks = { [hakenMbid]: await mbIdentityGet(`artist/${hakenMbid}?inc=url-rels&fmt=json`) };
    console.log(`  links ${hakenMbid}`);
  }

  write('musicbrainz-identity.json', recorded);
  process.exit(0);
}

/**
 * One authorised GET.
 *
 * Unlike an adapter, this throws on failure. A recorder that swallows an error
 * would write a fixture of the error page, and the suite would then replay
 * Spotify's 403 forever as though it were the real shape.
 */
async function get(token, url) {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`GET ${url} -> ${res.status}\n${body.slice(0, 400)}`);
  }
  return res.json();
}

function write(name, data) {
  mkdirSync(FIXTURES, { recursive: true });
  const path = join(FIXTURES, name);
  writeFileSync(path, JSON.stringify(data, null, 2) + '\n');
  console.log(`wrote tests/fixtures/${name}`);
}

/**
 * A spread of artists from the imported roster.
 *
 * Ordered by popularity and sampled at even intervals rather than taking the
 * top N: the interesting parse failures live at the sparse end.
 */
function rosterSample(count) {
  const rows = db()
    .prepare(
      `SELECT a.name, x.external_id AS id
         FROM artists a
         JOIN artist_external_ids x ON x.artist_id = a.id AND x.source = 'spotify'
        ORDER BY a.name`,
    )
    .all();

  if (rows.length === 0) {
    throw new Error('The roster is empty. Run the roster import first.');
  }

  const step = Math.max(1, Math.floor(rows.length / count));
  const picked = [];
  for (let i = 0; i < rows.length && picked.length < count; i += step) {
    picked.push(rows[i]);
  }
  return picked;
}

try {
  const token = await getAccessToken();

  if (mode === 'following') {
    const data = await get(token, `${API}/me/following?type=artist&limit=50`);
    write('spotify-following-live.json', data);
  } else if (mode === 'liked') {
    /*
     * Liked Songs, trimmed to the shapes the extraction branches on.
     *
     * Chosen, not sampled, for the same reason the `releases` mode is: a page
     * of 50 ordinary solo tracks would exercise one branch and prove nothing
     * about the other three. Scans several pages looking for one of each:
     *
     *  - a solo track: one artist, album artist identical
     *  - a collaboration: two or more track artists
     *  - a compilation: an album artist crediting nobody who plays here
     *    ("Various Artists", or a label, or a DJ) — the case the drop rule is for
     *  - an album-artist mismatch: album credited to someone who does perform,
     *    alongside a guest who does not appear on the album credit
     *
     * The names are then replaced before writing. This repository is public,
     * and a fixture is the shape of Spotify's response, not a record of what
     * anyone listens to: the structure is what the tests read, so keeping the
     * real titles would publish a personal library to prove nothing.
     */
    const wanted = {
      solo: (t) => t.artists?.length === 1 && t.album?.artists?.length === 1,
      collaboration: (t) => (t.artists?.length ?? 0) >= 2,
      compilation: (t) => {
        const performing = new Set((t.artists ?? []).map((a) => a.id));
        return (t.album?.artists ?? []).some((a) => !performing.has(a.id));
      },
      mismatch: (t) => {
        const albumIds = new Set((t.album?.artists ?? []).map((a) => a.id));
        return (
          (t.artists?.length ?? 0) >= 2 && (t.artists ?? []).some((a) => !albumIds.has(a.id))
        );
      },
    };

    const picked = {};
    let url = `${API}/me/tracks?limit=50`;
    let scanned = 0;
    let total = null;

    // Cap the scan: a library with no compilations should not page all 42.
    for (let page = 0; page < 6 && url; page++) {
      const data = await get(token, url);
      total = data.total ?? total;

      for (const item of data.items ?? []) {
        if (!item?.track) continue;
        scanned++;
        for (const [shape, matches] of Object.entries(wanted)) {
          if (picked[shape]) continue;
          if (!matches(item.track)) continue;
          /*
           * One track per shape, and never the same track twice.
           *
           * The shapes overlap — a collaboration whose album credits only one
           * of the performers satisfies both `collaboration` and `mismatch` —
           * so without this the fixture stores one track under two keys and
           * the second shape is never independently covered. It looked like
           * four cases and was three.
           */
          if (Object.values(picked).some((p) => p.track.id === item.track.id)) continue;
          picked[shape] = item;
        }
      }

      if (Object.keys(picked).length === Object.keys(wanted).length) break;
      url = data.next;
      await new Promise((r) => setTimeout(r, 120));
    }

    const missing = Object.keys(wanted).filter((s) => !picked[s]);
    for (const shape of missing) {
      console.log(`  note: no ${shape} track found in ${scanned} scanned`);
    }
    for (const [shape, item] of Object.entries(picked)) {
      const names = (item.track.artists ?? []).map((a) => a.name).join(', ');
      const album = (item.track.album?.artists ?? []).map((a) => a.name).join(', ');
      console.log(`  ${shape}: "${item.track.name}" by ${names} [album: ${album}]`);
    }

    /*
     * Replace every name and id with an invented one, consistently.
     *
     * Consistently is the load-bearing word: the same artist must keep the
     * same substitute everywhere, or the fixture stops exercising what it was
     * recorded for. The compilation case depends on an album artist NOT being
     * among the track artists, and the mismatch case on one who is — both are
     * comparisons between ids, so remapping each id to exactly one placeholder
     * preserves the relationships while losing the identities.
     *
     * "Various Artists" keeps its real name. It is Spotify's own placeholder
     * rather than anyone's listening, and a test asserts on that exact string.
     */
    const anonymise = () => {
      const artistIds = new Map();
      const artistNames = new Map();
      let nextArtist = 0;

      const fakeArtist = (a) => {
        if (!a?.id) return a;
        if (!artistIds.has(a.id)) {
          const n = ++nextArtist;
          artistIds.set(a.id, `artist${String(n).padStart(6, '0')}fixture${n}`);
          artistNames.set(
            a.id,
            a.name === 'Various Artists' ? a.name : `Fixture Artist ${n}`,
          );
        }
        return { ...a, id: artistIds.get(a.id), name: artistNames.get(a.id) };
      };

      let nextTrack = 0;
      for (const item of Object.values(picked)) {
        const t = item.track;
        const n = ++nextTrack;
        t.artists = (t.artists ?? []).map(fakeArtist);
        if (t.album) {
          t.album.artists = (t.album.artists ?? []).map(fakeArtist);
          t.album.name = `Fixture Album ${n}`;
          if (t.album.id) t.album.id = `album${String(n).padStart(7, '0')}fixture${n}`;
          // Cover art urls point at a real album; the tests never read them.
          if (Array.isArray(t.album.images)) {
            t.album.images = t.album.images.map((img) => ({
              ...img,
              url: `https://i.scdn.co/image/fixture${n}`,
            }));
          }
          delete t.album.external_urls;
        }
        t.name = `Fixture Track ${n}`;
        if (t.id) t.id = `track${String(n).padStart(7, '0')}fixture${n}`;
        delete t.external_urls;
        delete t.external_ids;
        delete t.preview_url;
        delete t.uri;
        // When this was liked says nothing about the response SHAPE, and
        // everything about a person's week.
        item.added_at = `2026-01-0${n}T00:00:00Z`;
      }
    };

    anonymise();

    write('spotify-liked.json', {
      _comment:
        'Live GET /v1/me/tracks?limit=50, recorded by npm run fixtures:record -- liked. ' +
        'ANONYMISED: every track, album and artist name and id is a placeholder, ' +
        'remapped consistently so the relationships the tests read (which artist plays ' +
        'on which track, which album artist is absent from the lineup) survive. ' +
        '"Various Artists" is kept verbatim because it is Spotify\'s own placeholder ' +
        'and a test asserts on it. The SHAPE is real; the content is not. ' +
        'Trimmed by hand-picked SHAPE, not sampled: one track per extraction branch ' +
        '(solo, collaboration, compilation, album-artist mismatch). `total` is the real ' +
        'library size at recording time; `items` is a deliberate subset, so a test must ' +
        'not assert items.length === total. Re-record when the upstream shape changes; ' +
        'the diff names what broke.',
      _recordedAt: new Date().toISOString(),
      _shapes: Object.keys(picked),
      page1: {
        items: Object.values(picked),
        // A second page exists in the real response; the fixture's paging test
        // supplies its own `next`, so this one ends the walk.
        next: null,
        total,
      },
    });
  } else if (mode === 'albums' || mode === 'roster-sample') {
    const targets =
      mode === 'albums'
        ? rest.map((id) => ({ id, name: null }))
        : rosterSample(Number(rest[0]) || 6);

    if (targets.length === 0) {
      throw new Error('No artist ids given.');
    }

    const recorded = {
      _comment:
        'Live GET /v1/artists/{id}/albums?include_groups=album,single&limit=10, ' +
        'no market parameter, recorded by npm run fixtures:record. ' +
        'limit=10 is the real ceiling here: 20 and above return 400 ' +
        '"Invalid limit", unlike /me/following which allows 50. ' +
        'Keyed by artist id. Re-record when the upstream shape changes; the diff ' +
        'names what broke.',
      _recordedAt: new Date().toISOString(),
      artists: {},
    };

    for (const { id, name } of targets) {
      const url = `${API}/artists/${id}/albums?include_groups=album,single&limit=10`;
      const data = await get(token, url);
      recorded.artists[id] = { name, response: data };
      console.log(`  ${name ?? id}: ${data.items?.length ?? 0} albums (total ${data.total})`);

      // Spotify's limit is a rolling 30s window. A handful of sequential calls
      // is nowhere near it, but the pause keeps this honest if someone passes
      // a hundred ids.
      await new Promise((r) => setTimeout(r, 120));
    }

    write('spotify-albums.json', recorded);
  } else {
    throw new Error(`Unknown mode: ${mode}`);
  }
} catch (err) {
  if (err instanceof NotConnectedError) {
    console.error(`\n${err.message}\nConnect the account at http://127.0.0.1:3000 first.`);
    process.exit(1);
  }
  console.error(`\n${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
}
