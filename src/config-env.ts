/**
 * Load `.env` into process.env, for entry points Next does not start.
 *
 * Next reads .env itself, so the app never needs this. `npm run ingest` runs
 * under plain Node, which does not, and the symptom was confusing: the CLI
 * reported TOKEN_ENCRYPTION_KEY missing while the web UI worked fine on the
 * same machine.
 *
 * Deliberately tiny rather than a dependency: Bandelion's .env is a handful of
 * KEY=value lines, and a self-hosted app should not pull a package to read one.
 * Values already in the environment win, so a real env var beats the file.
 */

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

export function loadDotEnv(path = join(process.cwd(), '.env')): void {
  if (!existsSync(path)) return;

  for (const raw of readFileSync(path, 'utf8').split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;

    const eq = line.indexOf('=');
    if (eq === -1) continue;

    const key = line.slice(0, eq).trim();
    if (!key || key in process.env) continue;

    let value = line.slice(eq + 1).trim();
    // Strip matching quotes, which people add out of habit around values with
    // spaces. An unmatched quote is left alone rather than half-stripped.
    if (value.length >= 2 && value[0] === value.at(-1) && (value[0] === '"' || value[0] === "'")) {
      value = value.slice(1, -1);
    }

    process.env[key] = value;
  }
}
