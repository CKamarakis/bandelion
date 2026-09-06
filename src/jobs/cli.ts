/**
 * `npm run ingest` — run the import jobs from a terminal.
 *
 * Exists because the first roster import takes a while and nobody should watch
 * a browser tab for it. It is also how you re-run after following new artists,
 * without waiting for a scheduler.
 *
 * Safe to interrupt: every job checkpoints, so Ctrl-C costs at most one page.
 */

import { loadDotEnv } from '../config-env.ts';

/*
 * .env has to be in the environment before any module that reads it is
 * evaluated. Static imports are hoisted and run before any statement in this
 * file, so the rest are dynamic and come after this call. Written as a plain
 * import with a call underneath, it looks correct and silently is not.
 */
loadDotEnv();

const { loadConfig } = await import('../config.ts');
const { getDatabase } = await import('../db/index.ts');
const { getAccessToken, LOCAL_USER_ID, NotConnectedError } = await import('../auth/session.ts');
const { importRoster, rosterStatus } = await import('./roster.ts');

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

/*
 * Subcommands. No argument runs the roster import, which is what `npm run
 * ingest` did before resolution existed and what most people mean.
 */
const command = process.argv[2] ?? 'roster';

if (command === 'resolve') {
  const { resolveArtists, resolveStatus } = await import('./resolve.ts');

  if (!cfg.musicbrainzContact) {
    console.error(
      'MUSICBRAINZ_CONTACT is not set.\n' +
        'MusicBrainz requires a real contact address in the User-Agent; see .env.example.',
    );
    process.exit(2);
  }

  const status = resolveStatus(db);
  console.log(
    `identities: ${status.resolved}/${status.total} artist(s) resolved, status ${status.status}`,
  );
  if (status.resolved === status.total && status.total > 0) {
    console.log('nothing to do.');
    process.exit(0);
  }

  /*
   * Measured on a real 625-artist roster: about 8 seconds per artist, not the
   * 1.1s the pacing alone suggests. Each artist costs two calls (identity then
   * links) and MusicBrainz 503s often enough that retries dominate. Quoting the
   * theoretical rate here promised 12 minutes for a job that takes over an hour.
   */
  const remaining = status.total - status.resolved;
  console.log(
    `about ${Math.ceil((remaining * 8) / 60)} minute(s) for ${remaining} artist(s). ` +
      'Safe to stop with Ctrl-C; it resumes.\n',
  );

  const result = await resolveArtists({
    db,
    contact: `Bandelion/0.1 ( ${cfg.musicbrainzContact} )`,
    signal: controller.signal,
    onProgress: ({ attempted, resolved }) => {
      if (attempted % 25 === 0) console.log(`  ${attempted} attempted, ${resolved} resolved`);
    },
  });

  console.log(
    `\n${result.resolved} resolved, ${result.queued} queued for review, ` +
      `${result.unresolved} with no MusicBrainz record.`,
  );
  if (result.queued > 0) {
    console.log('Queued artists need a human decision: MusicBrainz has several acts by that name.');
  }
  if (!result.complete) {
    console.log(result.error ? `stopped: ${result.error}` : 'stopped early. Run again to resume.');
  }
  process.exit(result.complete ? 0 : 1);
}

if (command !== 'roster') {
  console.error(`Unknown command "${command}". Use: roster (default) or resolve.`);
  process.exit(2);
}

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
