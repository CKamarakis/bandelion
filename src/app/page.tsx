/**
 * The connect screen.
 *
 * Until a Spotify account is connected there is no roster and therefore no
 * feed, so this is the whole app on a fresh instance. Server component: the
 * connection state is read from SQLite at request time, so no loading flash and
 * no client fetch.
 */

import { loadConfig } from '../config.ts';
import { loadTokens, getFeed, getFeedCounts, type FeedItem } from '../db/index.ts';
import { LOCAL_USER_ID, db } from '../auth/session.ts';
import { rosterStatus } from '../jobs/roster.ts';
import { likedStatus } from '../jobs/liked.ts';
import { RosterImport } from './RosterImport.tsx';
import { ConnectSpotify } from './ConnectSpotify.tsx';
import { InfoNote } from './InfoNote.tsx';
import { Feed } from './Feed.tsx';

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
/*
 * "Follow and like" rather than "follow": the roster is now two lists, and a
 * tagline naming only one of them describes a feed the app no longer shows.
 */
const TAGLINE = 'Releases and gigs from the artists you follow and like.';
const CONNECT_HEADING = 'Connect Spotify to start';
const CONNECT_BODY =
  'Bandelion reads the artists you follow and the artists on your liked songs, ' +
  'then checks for new releases and gigs in your city.';
// The connect button's own label lives in ConnectSpotify.tsx, with the states
// it swaps between.
const SCOPE_NOTE = 'Read-only access. Bandelion never changes anything on your Spotify account.';

const CONNECTED_HEADING = 'Spotify connected';
/*
 * Names what this button does, not what Bandelion reads overall: the liked-
 * songs import is a separate run (`npm run ingest liked`) and this control does
 * not start it. Saying "and your liked songs" here would promise work this
 * button never performs.
 */
const CONNECTED_BODY = 'Import reads the artists you follow. It resumes if you stop it.';
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
  // Read once on the server so the list is in the HTML rather than fetched on
  // mount. An unreadable database degrades to an empty feed, not a blank page.
  let feed: FeedItem[] = [];
  let feedTotal = 0;
  const today = new Date().toISOString().slice(0, 10);
  // A zeroed status is the honest default: it claims nothing, and the panel
  // renders even when the database cannot be read.
  let roster: ReturnType<typeof rosterStatus> = {
    status: 'idle',
    imported: 0,
    total: null,
    lastError: null,
    complete: false,
  };
  // Undefined until read: absent means the liked import has never run, which
  // the panel says differently from "none found".
  let liked: ReturnType<typeof likedStatus> | undefined;
  try {
    const database = db();
    connected = loadTokens(database, LOCAL_USER_ID, 'spotify') !== null;
    roster = rosterStatus(database, LOCAL_USER_ID);
    /*
     * The whole feed, not the newest 200.
     *
     * The list pages client-side, so every row has to be here for a later page
     * to exist. The cap is a guard against a runaway query rather than a page
     * size: a personal instance measured 599 releases across 1,556 artists, so
     * 5,000 is years of headroom, and the row count is what the header reports
     * if it is ever hit.
     */
    feed = getFeed(database, { type: 'release', limit: 5000 });
    feedTotal = getFeedCounts(database).total;
    liked = likedStatus(database, LOCAL_USER_ID);
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
        {/*
          The mark sits with the wordmark, not above it, and the catalogue
          labels stack to their right on the same row: the masthead is wide
          enough that giving them a line of their own wasted one.

          alt is empty and the image is decorative: the h1 beside it already
          says "Bandelion", so a screen reader announcing the logo would read
          the name twice. `width`/`height` are set so the row does not reflow
          when the image loads.
        */}
        <div style={S.titleRow}>
          <img
            src="/logo.png"
            alt=""
            width={64}
            height={64}
            style={S.logo}
            aria-hidden="true"
          />
          <h1 style={S.title}>{TITLE}</h1>
          {/* Catalogue number over city, both right-aligned, top of the row. */}
          <div style={S.catStack}>
            <span className="cat">BND 0001</span>
            <span className="cat">{cfg.city.toUpperCase()}</span>
          </div>
        </div>
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
            {/* The explanation moves behind the icon: it answers a question
                you ask once, and it was holding a line of the panel forever. */}
            <div style={S.panelHead}>
              <h2>{CONNECTED_HEADING}</h2>
              <InfoNote>{CONNECTED_BODY}</InfoNote>
            </div>
            {/* Both panel actions on one row: importing and disconnecting are
                the only two things this panel does, and stacking them made the
                second look like a consequence of the first. */}
            <RosterImport
              initial={roster}
              liked={liked?.imported ? liked : undefined}
              action={
                <form action="/api/auth/disconnect" method="post">
                  <button type="submit" className="btn btn-danger">
                    {DISCONNECT_CTA}
                  </button>
                </form>
              }
            />
          </>
        ) : (
          <>
            <h2>{CONNECT_HEADING}</h2>
            <p style={S.body}>{CONNECT_BODY}</p>
            <ConnectSpotify expectedOrigin={new URL(cfg.spotify.redirectUri).origin} />
            <p style={S.note}>{SCOPE_NOTE}</p>
          </>
        )}
      </section>

      {/* The feed only makes sense once an account is connected: before that
          there is no roster, so an empty list would be an empty promise. */}
      {connected ? <Feed items={feed} today={today} total={feedTotal} /> : null}
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
  /*
   * An opaque sheet on the striped ground.
   *
   * The stripes are a page background, and every surface carrying type sits on
   * top of them: ink on black measures 1.61:1, so type must never land on the
   * ground itself. The hard border is what makes it read as a sheet laid on
   * the pattern rather than a gap in it.
   */
  page: {
    maxWidth: '960px',
    margin: '0 auto',
    padding: '48px 32px 96px',
    /*
     * 85% white, so the stripes show faintly through the sheet.
     *
     * rgba on the background, NOT `opacity`: opacity fades the element and
     * everything inside it, so the type would drop to 85% too and the measured
     * 12:1 contrast with it. This tints only the surface.
     */
    background: 'rgba(255, 255, 255, 0.9)',
    borderLeft: 'var(--rule-width) solid var(--ink)',
    borderRight: 'var(--rule-width) solid var(--ink)',
    minHeight: '100vh',
  },
  masthead: { paddingBottom: '20px' },
  // Logo and wordmark centred on each other; the catalogue stack pushed right
  // and pinned to the top of the row, where a specimen label belongs.
  titleRow: { display: 'flex', alignItems: 'center', gap: '18px' },
  catStack: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-end',
    gap: '2px',
    marginLeft: 'auto',
    alignSelf: 'flex-start',
  },
  /*
   * The mark, on its own black ground. No border: the artwork is already a
   * black circle, so a rule around it would draw a box around a circle.
   */
  logo: { display: 'block', flexShrink: 0, width: '64px', height: '64px' },
  /*
   * Sized to the mark rather than to the viewport.
   *
   * The global h1 is clamp(2.5rem, 9vw, 5.5rem), which at 960px renders near
   * 86px and towered over a 64px logo. 3.25rem caps the cap-height at roughly
   * the circle's diameter so the two read as one lockup, and the clamp still
   * lets it shrink on a narrow screen.
   */
  title: { fontSize: 'clamp(2rem, 6vw, 3.25rem)', lineHeight: 0.9 },
  rule: { height: '6px', background: 'var(--ink)', border: 'none', margin: '0' },
  // No ch cap: the tagline is one line at 960px and wraps only if the viewport
  // cannot hold it. A measure limit here broke it in two with room to spare.
  tagline: { margin: '18px 0 0', fontSize: '0.95rem' },
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
  // Even padding so the block reads as one printed panel rather than a column
  // that happens to be yellow.
  panel: { padding: '28px' },
  // The heading and the info icon share a line, icon hard right.
  panelHead: {
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: '16px',
    marginBottom: '20px',
  },
  /*
   * Full width of the panel, wrapping only when it genuinely does not fit.
   * 20px below rather than 24: the heading, the sentence and the buttons are
   * one sequence, and the space between them should be even.
   */
  body: { margin: '16px 0 20px' },
  note: { margin: '20px 0 0', fontSize: '0.8rem' },
  // The two panel actions sit on one row. `wrap` so a narrow viewport stacks
  // them rather than pushing one off the edge.
  actions: { display: 'flex', flexWrap: 'wrap', gap: '12px', alignItems: 'center' },
  // Top margin because this row follows the import button: without it the
  // metadata reads as a caption on the button rather than its own line.
  meta: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '10px',
    margin: '26px 0 22px',
    fontSize: '0.8rem',
  },
  metaKey: { margin: 0, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.12em' },
  metaVal: { margin: 0, overflowWrap: 'anywhere' },
};
