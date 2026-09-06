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
 *   npm run fixtures:record -- roster-sample [count]
 *   npm run fixtures:record -- mbid
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
      '  npm run fixtures:record -- roster-sample [count]\n' +
      '  npm run fixtures:record -- mbid            (MusicBrainz, no Spotify token needed)',
  );
  process.exit(2);
}

/**
 * MusicBrainz identity resolution, recorded from the ambiguous cases.
 *
 * Separate from the Spotify path below because it needs no token, and because
 * the cases that matter are chosen rather than sampled: the two WITCHes and two
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

  async function mbGet(path) {
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
      response: await mbGet(`url?resource=${encodeURIComponent(resource)}&inc=artist-rels&fmt=json`),
    };
    console.log(`  url  ${row.name} (${row.spotifyId})`);
    await sleep(1200);
  }

  for (const name of ['WITCH', 'Witch', 'Pentagram']) {
    const q = encodeURIComponent(`artist:"${name}"`);
    recorded.nameSearches[name] = await mbGet(`artist?query=${q}&fmt=json&limit=5`);
    console.log(`  name ${name}`);
    await sleep(1200);
  }

  // One artist's links, so the link classifier has real relation shapes.
  const haken = rows.find((r) => r.name === 'Haken');
  const hakenMbid = haken
    ? recorded.urlLookups[haken.spotifyId]?.response?.relations?.find((r) => r.artist)?.artist?.id
    : null;
  if (hakenMbid) {
    recorded.artistLinks = { [hakenMbid]: await mbGet(`artist/${hakenMbid}?inc=url-rels&fmt=json`) };
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
