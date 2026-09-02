/**
 * The resolve hook itself. See tests/next-resolve.mjs for why this exists.
 *
 * Deliberately narrow: it rewrites only the handful of bare Next subpath
 * specifiers that route handlers use, and leaves everything else alone. A hook
 * that rewrote broadly could mask a genuinely missing dependency.
 */

/** Bare specifiers Next's bundler resolves but Node cannot. */
const NEXT_SUBPATHS = new Set(['next/server', 'next/headers', 'next/navigation']);

export async function resolve(specifier, context, nextResolve) {
  if (NEXT_SUBPATHS.has(specifier)) {
    return nextResolve(`${specifier}.js`, context);
  }
  return nextResolve(specifier, context);
}
