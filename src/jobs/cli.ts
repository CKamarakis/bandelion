/**
 * `npm run ingest` — run the import jobs from a terminal.
 *
 * Exists because the first roster import takes a while and nobody should watch
 * a browser tab for it. It is also how you re-run after following new artists,
 * without waiting for a scheduler.
 *
 * Safe to interrupt: every job checkpoints, so Ctrl-C costs at most one page.
 */

import { loadConfig } from '../config.ts';
import { getDatabase } from '../db/index.ts';
import { getAccessToken, LOCAL_USER_ID, NotConnectedError } from '../auth/session.ts';
import { importRoster, rosterStatus } from './roster.ts';

const cfg = loadConfig();
const db = getDatabase(cfg.databasePath);

// Ctrl-C stops after the current page rather than mid-write, so the checkpoint
// stays consistent with what is actually in the database.
const controller = new AbortController();
let stopping = false;
process.on('SIGINT', () => {
  if (stopping) process.exit(130);
  stopping = true;
  console.log('\nstopping after the current page. Ctrl-C again to force.');
  controller.abort();
});

const before = rosterStatus(db, LOCAL_USER_ID);
console.log(`roster: ${before.imported} artist(s) in the database, status ${before.status}`);

try {
  const result = await importRoster({
    db,
    userId: LOCAL_USER_ID,
    getAccessToken: () => getAccessToken(db),
    signal: controller.signal,
    onPage: ({ done, total }) => {
      // No invented denominator: if Spotify did not say how many there are, do
      // not imply a percentage.
      console.log(total === null ? `  ${done} imported` : `  ${done}/${total} imported`);
    },
  });

  if (result.complete) {
    console.log(`\ndone. ${result.imported} artist(s) written in ${result.pagesFetched} page(s).`);
  } else {
    console.log(
      `\nstopped: ${result.error}\n` +
        `${result.imported} artist(s) written in ${result.pagesFetched} page(s). ` +
        'Run again to resume from here.',
    );
  }
  process.exit(result.complete ? 0 : 1);
} catch (err) {
  if (err instanceof NotConnectedError) {
    console.error(`\n${err.message}\nConnect an account at http://127.0.0.1:3000 first.`);
    process.exit(2);
  }
  throw err;
}
