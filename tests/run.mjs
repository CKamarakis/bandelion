/**
 * Test runner. Spawns every *.mjs in this directory except itself and any
 * manual tools, and fails if any of them do.
 *
 * No framework, deliberately: each suite is a standalone Node script with a
 * check function and an exit code. Adding a file to this directory enrols it
 * automatically.
 *
 * One trap, learned on a previous project: because this globs the directory, a
 * scratch file left in tests/ becomes part of the suite. Keep throwaway probes
 * elsewhere — there is a scratchpad directory for that.
 */

import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const dir = import.meta.dirname;

/**
 * Not suites. `screenshots.mjs` needs a running server and a browser, and the
 * next-resolve pair are module hooks loaded via --import below.
 */
const MANUAL = new Set([
  'run.mjs',
  'screenshots.mjs',
  'record-fixture.mjs',
  'next-resolve.mjs',
  'next-resolve-hooks.mjs',
]);

const suites = readdirSync(dir)
  .filter((f) => f.endsWith('.mjs') && !MANUAL.has(f))
  .sort();

if (suites.length === 0) {
  console.error('no suites found in tests/');
  process.exit(1);
}

let failed = [];

for (const suite of suites) {
  console.log(`\n─── ${suite} ${'─'.repeat(Math.max(0, 60 - suite.length))}`);
  // --experimental-strip-types so suites can import the .ts source directly.
  // No build step for tests: the thing under test is the source, not a bundle.
  // --import next-resolve so route handlers, which import `next/server`, can be
  // called in process rather than through a running server.
  // --import takes a URL, not a path: a bare Windows path is read as the
  // scheme 'c:' and rejected with ERR_UNSUPPORTED_ESM_URL_SCHEME.
  const r = spawnSync(
    process.execPath,
    [
      '--experimental-strip-types',
      '--import',
      pathToFileURL(join(dir, 'next-resolve.mjs')).href,
      join(dir, suite),
    ],
    { stdio: 'inherit', encoding: 'utf8' },
  );
  if (r.status !== 0) failed.push(suite);
}

console.log(`\n${'═'.repeat(64)}`);
if (failed.length) {
  console.error(`FAILED: ${failed.join(', ')}`);
  process.exit(1);
}
console.log(`all ${suites.length} suite(s) passed`);
