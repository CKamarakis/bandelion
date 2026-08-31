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

const dir = import.meta.dirname;

/** Run on demand, not as part of the suite. */
const MANUAL = new Set(['run.mjs', 'screenshots.mjs', 'record-fixture.mjs']);

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
  const r = spawnSync(process.execPath, [join(dir, suite)], {
    stdio: 'inherit',
    encoding: 'utf8',
  });
  if (r.status !== 0) failed.push(suite);
}

console.log(`\n${'═'.repeat(64)}`);
if (failed.length) {
  console.error(`FAILED: ${failed.join(', ')}`);
  process.exit(1);
}
console.log(`all ${suites.length} suite(s) passed`);
