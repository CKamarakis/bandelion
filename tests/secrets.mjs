/**
 * Nothing private reaches the repo.
 *
 * This is a public repository. Credentials, tokens and personal data must never
 * be committed, and "we were careful" is not a control. This suite is the
 * control: it fails the build rather than relying on anyone remembering.
 *
 * Scans tracked files only — .env and /data/ are gitignored and irrelevant here.
 * What matters is what git would actually publish.
 */

import { execSync } from 'node:child_process';
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

/** Files git is actually tracking. Untracked scratch files are not our problem. */
function trackedFiles() {
  try {
    return execSync('git ls-files', { cwd: root, encoding: 'utf8' })
      .split('\n')
      .filter(Boolean);
  } catch {
    return [];
  }
}

const SKIP_BINARY = /\.(png|jpg|jpeg|gif|webp|ico|woff2?|ttf|pdf|zip)$/i;

/**
 * Patterns for credentials that would be real if present.
 *
 * Deliberately narrow: a rule matching the word "secret" would fire on every
 * mention in the docs and get muted within a week, which is how these checks
 * die. Each pattern targets an assignment with a plausible value.
 */
const SECRET_PATTERNS = [
  {
    name: 'Spotify client id or secret with a value',
    // 32 hex chars is the Spotify format. Empty assignments are fine.
    re: /SPOTIFY_CLIENT_(?:ID|SECRET)\s*[=:]\s*['"]?[0-9a-f]{32}/i,
  },
  {
    name: 'assigned API key or token',
    re: /(?:api[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret)\s*[=:]\s*['"][A-Za-z0-9_\-]{16,}['"]/i,
  },
  { name: 'private key block', re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  { name: 'AWS access key id', re: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: 'GitHub token', re: /\bgh[pousr]_[A-Za-z0-9]{36,}\b/ },
  { name: 'Slack token', re: /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/ },
  { name: 'bearer token literal', re: /Bearer\s+[A-Za-z0-9_\-.]{30,}/ },
];

/**
 * Personal data. The owner's email is the realistic leak here: it ends up in
 * example config, a User-Agent string, or a test fixture.
 *
 * MusicBrainz asks for a contact address in the User-Agent. That contact must
 * come from env at runtime, never a literal in source.
 */
const PERSONAL_PATTERNS = [
  {
    name: 'real email address',
    re: /\b[A-Za-z0-9._%+-]+@(?!example\.(?:com|org)\b)[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/,
    // Addresses that are meant to be there: upstream contacts, not ours.
    allow: [/api@bandsintown\.com/i, /noreply@anthropic\.com/i],
  },
];

const tracked = trackedFiles();
check(tracked.length > 0, 'git is tracking files (repo initialised)');

// The gitignore rules that keep secrets out in the first place.
const gitignore = existsSync(join(root, '.gitignore'))
  ? readFileSync(join(root, '.gitignore'), 'utf8')
  : '';
for (const rule of ['.env', '/data/', '*.db']) {
  check(
    gitignore.split('\n').some((l) => l.trim() === rule),
    `.gitignore excludes ${rule}`,
  );
}

check(!tracked.includes('.env'), '.env is not tracked by git');
check(
  !tracked.some((f) => f.endsWith('.db')),
  'no SQLite database is tracked by git',
);

// .env.example must stay a template: keys present, values empty.
if (existsSync(join(root, '.env.example'))) {
  const example = readFileSync(join(root, '.env.example'), 'utf8');
  const filled = example
    .split('\n')
    .filter((l) => /^[A-Z_]+=.+/.test(l.trim()))
    // Non-secret defaults are the point of the file. The redirect URI is one:
    // it is public by construction (it travels in the authorize URL) and is
    // identical for every local instance, so shipping the working value beats
    // making everyone retype a string Spotify compares byte for byte.
    .filter((l) =>
      !/^(BANDELION_|RELEASE_WINDOW_|ENABLE_|DATABASE_PATH|SPOTIFY_REDIRECT_URI)/.test(
        l.trim(),
      ),
    )
    // example.com is the reserved placeholder domain (RFC 2606). An address
    // there is a template, and the real-email scan below still catches a
    // genuine one.
    .filter((l) => !/@example\.(com|org|net)\s*$/.test(l.trim()));
  check(
    filled.length === 0,
    '.env.example has no filled-in credential values',
    filled.join('\n      '),
  );
}

let scanned = 0;
for (const file of tracked) {
  if (SKIP_BINARY.test(file)) continue;
  const path = join(root, file);
  if (!existsSync(path)) continue;

  const content = readFileSync(path, 'utf8');
  scanned++;

  // This file necessarily contains the patterns it searches for.
  if (file === 'tests/secrets.mjs') continue;

  for (const { name, re } of SECRET_PATTERNS) {
    const m = content.match(re);
    check(!m, `no ${name} in ${file}`, m ? `matched: ${m[0].slice(0, 40)}…` : '');
  }

  for (const { name, re, allow = [] } of PERSONAL_PATTERNS) {
    for (const line of content.split('\n')) {
      const m = line.match(re);
      if (!m) continue;
      if (allow.some((a) => a.test(m[0]))) continue;
      check(false, `no ${name} in ${file}`, `matched: ${m[0]}`);
    }
  }
}

check(scanned > 0, `scanned ${scanned} tracked text files`);

console.log(failed ? `\n${failed} check(s) failed` : '\nall secret checks passed');
process.exit(failed ? 1 : 0);
