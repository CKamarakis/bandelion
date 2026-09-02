/**
 * A module resolution hook so suites can import route handlers directly.
 *
 * Next resolves the bare specifier `next/server` through its own bundler; plain
 * Node does not, and fails with ERR_MODULE_NOT_FOUND. The file it wants is
 * `next/server.js`.
 *
 * Fixing this in the hook rather than in the routes is deliberate: `next/server`
 * is the correct import for a route handler, and rewriting application source to
 * suit a test runner means the suite no longer tests what ships.
 *
 * Used via --import in tests/run.mjs.
 */

import { register } from 'node:module';
import { pathToFileURL } from 'node:url';

register('./next-resolve-hooks.mjs', pathToFileURL(import.meta.filename));
