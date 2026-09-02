/**
 * The connect screen.
 *
 * Until a Spotify account is connected there is no roster and therefore no
 * feed, so this is the whole app on a fresh instance. Server component: the
 * connection state is read from SQLite at request time, so no loading flash and
 * no client fetch.
 */

import { loadConfig } from '../config.ts';
import { loadTokens } from '../db/index.ts';
import { LOCAL_USER_ID, db } from '../auth/session.ts';
import { SPOTIFY_SCOPES } from '../auth/spotify.ts';

export const dynamic = 'force-dynamic';

/*
 * Copy, hoisted so the markup stays readable and so the strings are reviewable
 * in one place against the eight rules.
 *
 * Rule 8 governs every line here. "Artists you follow on Spotify" is what the
 * roster actually is: followed artists, not listening history. Naming the two
 * scopes is honest about exactly what the grant covers.
 */
const TITLE = 'Bandelion';
const TAGLINE = 'Releases and gigs from the artists you follow.';
const CONNECT_HEADING = 'Connect Spotify to start';
const CONNECT_BODY =
  'Bandelion reads the artists you follow, then checks for new releases and gigs in your city.';
const CONNECT_CTA = 'Connect Spotify';
const SCOPE_NOTE = 'Read-only access. Bandelion never changes anything on your Spotify account.';

const CONNECTED_HEADING = 'Spotify connected';
const CONNECTED_BODY = 'Next: import the artists you follow, then run the first ingest.';
const DISCONNECT_CTA = 'Disconnect';

const NOT_CONFIGURED_HEADING = 'Add your Spotify credentials';
const NOT_CONFIGURED_BODY =
  'Set SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET in .env, then restart the server.';

/*
 * Callback outcomes. Each names what happened and what to do about it. No
 * apology, no "please", and nothing claiming a cause we did not observe.
 */
const AUTH_ERRORS: Record<string, string> = {
  cancelled: 'Spotify sign-in was cancelled.',
  state_mismatch: 'That sign-in link expired. Start again.',
  missing_verifier: 'That sign-in link expired. Start again.',
  no_code: 'Spotify did not return an authorization code.',
  not_configured: 'Set SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET in .env, then restart.',
  exchange_failed: 'Spotify rejected the sign-in. Check the server log for details.',
};
const AUTH_ERROR_FALLBACK = 'Spotify sign-in did not complete.';

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const cfg = loadConfig();
  const configured = Boolean(cfg.spotify.clientId && cfg.spotify.clientSecret);

  let connected = false;
  try {
    connected = loadTokens(db(), LOCAL_USER_ID, 'spotify') !== null;
  } catch (err) {
    // The page must render even with no database yet. Constraint 2's spirit:
    // one broken dependency degrades a section, it does not blank the screen.
    console.error('[page] could not read connection state:', err);
  }

  const rawError = params.auth_error;
  const errorKey = Array.isArray(rawError) ? rawError[0] : rawError;
  const errorMessage = errorKey ? (AUTH_ERRORS[errorKey] ?? AUTH_ERROR_FALLBACK) : null;

  return (
    <main style={S.page}>
      <header style={S.masthead}>
        <div style={S.catRow}>
          <span className="cat">BND 0001</span>
          <span className="cat">{cfg.city.toUpperCase()}</span>
        </div>
        <h1>{TITLE}</h1>
        <p style={S.tagline}>{TAGLINE}</p>
      </header>

      {/* The heavy rule that separates masthead from content. Its own element
          rather than a border, so the panel below can sit flush against it. */}
      <hr style={S.rule} />

      {errorMessage ? (
        <div style={S.notice} role="status">
          {/* Colour never carries meaning alone: border plus label. */}
          <span className="cat" style={S.noticeLabel}>
            Sign-in
          </span>
          <span style={S.noticeText}>{errorMessage}</span>
        </div>
      ) : null}

      <section className="block block-yellow" style={S.panel}>
        {!configured ? (
          <>
            <h2>{NOT_CONFIGURED_HEADING}</h2>
            <p style={S.body}>{NOT_CONFIGURED_BODY}</p>
          </>
        ) : connected ? (
          <>
            <h2>{CONNECTED_HEADING}</h2>
            <p style={S.body}>{CONNECTED_BODY}</p>
            <dl style={S.meta}>
              <dt style={S.metaKey}>Scope</dt>
              <dd style={S.metaVal}>{SPOTIFY_SCOPES.join(' · ')}</dd>
            </dl>
            <form action="/api/auth/disconnect" method="post">
              <button type="submit" className="btn btn-secondary">
                {DISCONNECT_CTA}
              </button>
            </form>
          </>
        ) : (
          <>
            <h2>{CONNECT_HEADING}</h2>
            <p style={S.body}>{CONNECT_BODY}</p>
            <a className="btn" href="/api/auth/login">
              {CONNECT_CTA}
            </a>
            <p style={S.note}>{SCOPE_NOTE}</p>
          </>
        )}
      </section>
    </main>
  );
}

/*
 * Layout only. Colour and type live in globals.css so contrast is testable.
 *
 * Three fixes came from reading the screenshots rather than the markup:
 *  - the masthead rule was invisible because the panel sat flush against it
 *  - the tagline wrapped mid-phrase at 38ch
 *  - nothing was yellow, so the page read as a wireframe rather than a flyer
 *
 * A fourth apparent bug, the notice overflowing at 390px, was the screenshot
 * harness rather than the page: --window-size crops without resizing the layout
 * viewport. Measured at 390px the content fits. See tests/screenshots.mjs.
 */
const S: Record<string, React.CSSProperties> = {
  // No overflow-x guard here on purpose: hiding overflow hides the bug too.
  // tests/screenshots.mjs measures scrollWidth against the viewport and fails
  // the run instead, so real overflow surfaces rather than being clipped.
  page: { maxWidth: '760px', margin: '0 auto', padding: '48px 24px 96px' },
  masthead: { paddingBottom: '20px' },
  rule: { height: '6px', background: 'var(--ink)', border: 'none', margin: '0' },
  catRow: { display: 'flex', justifyContent: 'space-between', marginBottom: '14px' },
  tagline: { margin: '18px 0 0', fontSize: '0.95rem', maxWidth: '46ch' },
  notice: {
    // Wraps instead of overflowing: at 390px the label sits above the message.
    display: 'flex',
    flexWrap: 'wrap',
    gap: '4px 12px',
    alignItems: 'baseline',
    padding: '12px 16px',
    marginBottom: '-2px',
    borderLeft: '6px solid var(--magenta)',
    borderTop: '2px solid var(--ink)',
    borderRight: '2px solid var(--ink)',
    borderBottom: '2px solid var(--ink)',
    background: 'var(--white)',
  },
  noticeLabel: { flexShrink: 0 },
  noticeText: { minWidth: 0, overflowWrap: 'anywhere' },
  // Yellow is flyer stock: a surface black type sits on, measured at ~9:1.
  panel: { padding: '30px 26px 34px' },
  body: { margin: '14px 0 24px', maxWidth: '52ch' },
  note: { margin: '20px 0 0', fontSize: '0.8rem', maxWidth: '52ch' },
  meta: { display: 'flex', flexWrap: 'wrap', gap: '10px', margin: '0 0 22px', fontSize: '0.8rem' },
  metaKey: { margin: 0, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.12em' },
  metaVal: { margin: 0, overflowWrap: 'anywhere' },
};
