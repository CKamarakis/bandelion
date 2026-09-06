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

// --- A script's target file exists ------------------------------------------
// The third direction, and the one that actually bit: `fixtures:record` and
// `seed` were documented, present in package.json, and pointed at files nobody
// ever wrote. Both checks above passed the whole time, because each only
// compared the docs against package.json — neither looked at the disk.
//
// Only local paths are checked. `next dev` and friends resolve through
// node_modules and are not ours to verify.

const LOCAL_PATH = /(?:^|\s)((?:src|tests|scripts)\/[\w./-]+\.(?:mjs|js|ts|tsx))/g;

for (const [name, command] of Object.entries(pkg.scripts ?? {})) {
  for (const [, target] of command.matchAll(LOCAL_PATH)) {
    check(
      existsSync(join(root, target)),
      `script "${name}" points at an existing file: ${target}`,
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

// --- LIMITS.md stays honest -------------------------------------------------
// A hand-kept list of known gaps rots the same way prose does, and rots
// *silently*: a limit that was fixed but still listed teaches everyone to
// distrust the file, which is worse than not having it.
//
// This cannot check whether a limit is still true — only a human knows that.
// What it can check is that the file keeps the shape that makes it useful, and
// that every decision it cites actually exists.

const limits = readFileSync(join(root, 'LIMITS.md'), 'utf8');

{
  const entries = [...limits.matchAll(/^## (L\d+) · (.+?) · (blocks-flow|degrades|cosmetic)$/gm)];
  check(entries.length > 0, 'LIMITS.md has entries in the documented format');

  // Ids are how a commit message or a decision refers to one of these, so a
  // duplicate id makes the reference ambiguous.
  const ids = entries.map(([, id]) => id);
  check(new Set(ids).size === ids.length, 'LIMITS.md entry ids are unique', ids.join(' '));

  // Every entry needs an exit condition. An entry with no trigger is a
  // complaint, not a plan, and will still be here in a year.
  const sections = limits.split(/^## /m).slice(1);
  for (const section of sections) {
    const heading = section.split('\n')[0];
    const id = heading.match(/^(L\d+)/)?.[1];
    if (!id) continue;
    check(
      /\*\*Trigger:?\*\*|\*\*Trigger\b/.test(section) || /\*\*What would lift it/.test(section),
      `${id} says what would lift it or when to act`,
    );
  }

  // Decisions cited by number must exist, so a renumbering does not leave
  // dangling references.
  const decisions = readFileSync(join(root, 'DECISIONS.md'), 'utf8');
  const cited = new Set([...limits.matchAll(/decision (\d{3})/g)].map(([, n]) => n));
  for (const n of cited) {
    check(
      new RegExp(`^## ${n} · `, 'm').test(decisions),
      `LIMITS.md cites decision ${n}, which exists`,
    );
  }
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
