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
      '  npm run fixtures:record -- roster-sample [count]',
  );
  process.exit(2);
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
