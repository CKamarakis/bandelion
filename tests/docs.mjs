/**
 * Documentation is tested, not remembered (constraint 3).
 *
 * Asserts that CLAUDE.md's Architecture section names only paths that exist,
 * and that every npm script is documented. Prose drifts silently; this fails
 * the build instead.
 *
 * The failure mode this is for: on the previous project CLAUDE.md described a
 * pre-React build for an entire React conversion, because two patch attempts
 * failed silently on string-match and nobody read the file back.
 */

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..');

let failed = 0;
const check = (ok, msg, detail) => {
  if (ok) console.log(`pass  ${msg}`);
  else {
    console.error(`FAIL  ${msg}${detail ? `\n      ${detail}` : ''}`);
    failed++;
  }
};

const claude = readFileSync(join(root, 'CLAUDE.md'), 'utf8');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));

// --- Every path named in the Architecture block exists ----------------------

const archBlock = claude.match(/## Architecture[\s\S]*?```([\s\S]*?)```/);
check(Boolean(archBlock), 'CLAUDE.md has an Architecture section with a path listing');

if (archBlock) {
  // Lines look like: `src/adapters/    one file per source, ...`
  const paths = archBlock[1]
    .split('\n')
    .map((l) => l.trim().split(/\s+/)[0])
    .filter((p) => p && /^[\w./-]+$/.test(p) && p.includes('/'));

  check(paths.length > 0, 'the Architecture block names at least one path');

  for (const p of paths) {
    check(existsSync(join(root, p)), `Architecture names an existing path: ${p}`);
  }
}

// --- Every npm script is documented -----------------------------------------
// A script nobody documents is a script nobody runs.

const commandsBlock = claude.match(/## Commands[\s\S]*?```bash([\s\S]*?)```/);
check(Boolean(commandsBlock), 'CLAUDE.md has a Commands section');

if (commandsBlock) {
  const documented = commandsBlock[1];
  for (const script of Object.keys(pkg.scripts ?? {})) {
    check(
      documented.includes(`npm run ${script}`) || documented.includes(`npm ${script}`),
      `CLAUDE.md documents the "${script}" script`,
    );
  }
}

// --- Documented scripts actually exist --------------------------------------
// The reverse drift: a command in the docs that was renamed in package.json.

if (commandsBlock) {
  for (const [, script] of commandsBlock[1].matchAll(/npm run ([\w:]+)/g)) {
    check(
      Object.hasOwn(pkg.scripts ?? {}, script),
      `documented script "${script}" exists in package.json`,
    );
  }
}

// --- Files referenced elsewhere in the docs ---------------------------------
// Backtick-quoted paths in prose rot the same way. Only check ones that look
// like real repo paths, so a filename in an example is not a false positive.

const referenced = new Set();
for (const [, p] of claude.matchAll(/`((?:src|tests|docs)\/[\w./-]+)`/g)) {
  referenced.add(p);
}
for (const p of referenced) {
  check(existsSync(join(root, p)), `CLAUDE.md references an existing file: ${p}`);
}

// --- README stays consistent about how to run it ----------------------------

const readme = readFileSync(join(root, 'README.md'), 'utf8');
for (const [, script] of readme.matchAll(/npm run ([\w:]+)/g)) {
  check(
    Object.hasOwn(pkg.scripts ?? {}, script),
    `README references an existing script: ${script}`,
  );
}

console.log(failed ? `\n${failed} check(s) failed` : '\nall docs checks passed');
process.exit(failed ? 1 : 0);
