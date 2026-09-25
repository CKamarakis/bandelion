/**
 * Review: the names MusicBrainz could read more than one way.
 *
 * The resolve job auto-accepts nothing from a name search, so every ambiguous
 * name lands here rather than being guessed at. That is the right default and
 * it is also why this page has to exist: without it the queue only grows, and
 * an artist with no MBID produces no releases, silently.
 */

import { loadConfig } from '../../config.ts';
import { getReviewCount, getReviewQueue, type ReviewRow } from '../../db/index.ts';
import { LOCAL_USER_ID, db } from '../../auth/session.ts';
import { Masthead } from '../Masthead.tsx';
import { ReviewList } from '../ReviewList.tsx';

export const dynamic = 'force-dynamic';

const HEADING = 'Review';

/**
 * How many rows the page renders at once.
 *
 * Not a preference. At the full 264 the page was 624KB of HTML carrying about
 * a thousand links, and a real browser took minutes to lay it out — the
 * screenshot harness hung on it while every other route took seconds. The
 * server answered in 34ms throughout, so this is a rendering limit rather than
 * a query one.
 *
 * 40 is also the better gesture: a queue is worked through a batch at a time,
 * and the next batch arrives when this one is decided. The count above the
 * list names the whole queue, so the page never implies 40 is all there is.
 */
const PAGE_SIZE = 40;

export default async function ReviewPage() {
  const cfg = loadConfig();

  let rows: ReviewRow[] = [];
  let total = 0;
  try {
    const database = db();
    rows = getReviewQueue(database, LOCAL_USER_ID, PAGE_SIZE);
    // The whole queue, not the slice: the count must name what is waiting.
    total = getReviewCount(database);
  } catch (err) {
    // The page renders even with no database yet, like the feed does.
    console.error('[review] could not read the queue:', err);
  }

  return (
    <main style={S.page}>
      <Masthead city={cfg.city} here="/review" reviewCount={total} />
      <hr style={S.rule} />

      <section style={S.section}>
        <h2 style={S.heading}>{HEADING}</h2>
        <ReviewList rows={rows} total={total} linkTarget={cfg.spotifyLinkTarget} />
      </section>
    </main>
  );
}

/* The same sheet as the other list pages. */
const S: Record<string, React.CSSProperties> = {
  page: {
    maxWidth: '960px',
    margin: '0 auto',
    padding: '48px 32px 96px',
    background: 'rgba(255, 255, 255, 0.9)',
    borderLeft: 'var(--rule-width) solid var(--ink)',
    borderRight: 'var(--rule-width) solid var(--ink)',
    minHeight: '100vh',
  },
  rule: { height: '6px', background: 'var(--ink)', border: 'none', margin: '0' },
  section: { marginTop: '2rem' },
  heading: { margin: '0' },
};
