/**
 * The review queue: one artist per block, one button per candidate.
 *
 * Client component because every row is a decision that writes and then
 * removes itself. It renders from data the server already read, so the list is
 * in the HTML rather than fetched on mount.
 *
 * ## Why every name here is a link
 *
 * The question this page asks is "which of these acts is the one you follow?",
 * and nothing on the row answers it. Two bands called Steak are a UK stoner
 * band and a German hard-rock band, and the only way to know which one you
 * have is to go and listen. So the Spotify artist links out and so does every
 * MusicBrainz candidate: both sides of the comparison are one click away, and
 * a row you cannot check is a row you would decide by coin toss.
 *
 * The disambiguation text sits next to each candidate for the same reason. It
 * is usually the deciding fact and it costs nothing, being already in the
 * payload MusicBrainz returned.
 *
 * ## Removal follows the decision
 *
 * A decided row leaves at once, like the un-flag rule on the saved lists: a
 * page named after a queue must not show rows that are no longer in it. The
 * count in the heading follows the same state, so the two cannot disagree.
 */

'use client';

import { useState } from 'react';
import type { LinkTarget } from '../config.ts';
import type { ReviewRow } from '../db/index.ts';
import { ArtistLink } from './ArtistLink.tsx';

/*
 * Copy, hoisted. Rule 8 governs every line: this page knows what MusicBrainz
 * returned for a name, and nothing more. It does not know which act is right,
 * which is the entire reason it is asking.
 */
const EMPTY = 'Nothing to review.';
/*
 * Rule 8 again. "Checked" would claim we looked at the world; we looked at one
 * search response. The subtitle names the source and what the buttons do.
 */
const INTRO = 'MusicBrainz found more than one act for these names. Pick the one you follow.';
/*
 * Two counts, because one number cannot say both things honestly. When the
 * page holds the whole queue it says so; when it holds a batch it names the
 * batch AND the queue, so "40" never reads as all that is waiting.
 */
const COUNT = (n: number) => `${n} to decide`;
const COUNT_BATCH = (shown: number, total: number) => `${shown} of ${total} to decide`;
/* Says where the next batch comes from, since nothing on screen would. */
const MORE = 'Decide these and reload for the next batch.';
/* Names what is left, so an empty screen is not read as an empty queue. */
const BATCH_DONE = (left: number) => `Batch done. ${left} left, reload for the next.`;
const NONE_CTA = 'None of these';
const PICK_CTA = 'This one';
const SPOTIFY_LABEL = 'Yours, on Spotify';
const MB_LABEL = 'On MusicBrainz';
/* Named lists, not a bare flag: "Followed" alone does not say followed where. */
const FOLLOWED = 'Followed';
const LIKED = 'Liked songs';
/* Rule 5: states what happened, not what the reader did wrong. */
const WRITE_FAILED = 'That did not save. Try again.';
/*
 * Rule 8: the honest gap. A row whose payload would not parse has nothing to
 * show, and pretending otherwise would be a list of zero options above two
 * buttons.
 */
const NO_CANDIDATES = 'No candidates recorded for this name.';

const mbUrl = (mbid: string) => `https://musicbrainz.org/artist/${mbid}`;

export function ReviewList({
  rows,
  /** The whole queue, which may exceed the rows rendered. */
  total,
  linkTarget,
}: {
  rows: ReviewRow[];
  total: number;
  linkTarget: LinkTarget;
}) {
  /* Decided rows, by queue id. The server list is the source; this is what has
     happened to it since, so a decision does not need a reload to take. */
  const [done, setDone] = useState<Set<number>>(new Set());
  const [pending, setPending] = useState<Set<number>>(new Set());
  const [failed, setFailed] = useState<Set<number>>(new Set());

  const visible = rows.filter((r) => !done.has(r.queueId));

  async function decide(queueId: number, body: { mbid: string } | { reject: true }) {
    setPending((p) => new Set(p).add(queueId));
    setFailed((f) => {
      const next = new Set(f);
      next.delete(queueId);
      return next;
    });

    try {
      const res = await fetch(`/api/review/${queueId}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(String(res.status));
      setDone((d) => new Set(d).add(queueId));
    } catch {
      // The row stays put and says so. Removing it on a failed write would
      // claim a decision the database never took.
      setFailed((f) => new Set(f).add(queueId));
    } finally {
      setPending((p) => {
        const next = new Set(p);
        next.delete(queueId);
        return next;
      });
    }
  }

  if (visible.length === 0) {
    /*
     * Two different facts. An empty queue and a finished batch with more
     * behind it look identical on screen and are not the same thing, and
     * saying "nothing to review" over 200 waiting rows is rule 8 exactly.
     */
    const left = total - done.size;
    return <p style={S.empty}>{left > 0 ? BATCH_DONE(left) : EMPTY}</p>;
  }

  return (
    <div>
      <p style={S.intro}>{INTRO}</p>
      {/*
        `remaining` counts the queue less what has been decided here, so the
        two numbers agree as rows leave rather than the total sitting stale.
      */}
      <p className="cat" style={S.count}>
        {(() => {
          const remaining = Math.max(total - done.size, visible.length);
          return remaining > visible.length
            ? COUNT_BATCH(visible.length, remaining)
            : COUNT(visible.length);
        })()}
      </p>
      {total > rows.length ? <p style={S.more}>{MORE}</p> : null}

      <ol style={S.list}>
        {visible.map((row) => {
          const busy = pending.has(row.queueId);

          return (
            <li key={row.queueId} style={S.row}>
              {/* The name as Spotify gave it, which is what you would
                  recognise, with the lists it came from beside it. */}
              <div style={S.head}>
                <span style={S.rawName}>{row.rawName}</span>
                {/*
                  Boxed, not bare. Set plain and side by side they read as one
                  phrase: "FOLLOWED LIKED SONGS" looked like a single label
                  rather than two facts about which lists this artist is on.
                */}
                <span style={S.lists}>
                  {row.followed ? (
                    <span className="cat" style={S.listTag}>
                      {FOLLOWED}
                    </span>
                  ) : null}
                  {row.liked ? (
                    <span className="cat" style={S.listTag}>
                      {LIKED}
                    </span>
                  ) : null}
                </span>
              </div>

              {row.spotifyId ? (
                <p style={S.yours}>
                  <span className="cat" style={S.sideLabel}>
                    {SPOTIFY_LABEL}
                  </span>
                  <ArtistLink
                    className="review-link"
                    artistId={row.spotifyId}
                    name={row.rawName}
                    linkTarget={linkTarget}
                  />
                </p>
              ) : null}

              {row.candidates.length === 0 ? (
                <p style={S.none}>{NO_CANDIDATES}</p>
              ) : (
                <ul style={S.cands}>
                  {row.candidates.map((c) => (
                    <li key={c.mbid} style={S.cand}>
                      <div style={S.candMain}>
                        <a
                          className="review-link"
                          href={mbUrl(c.mbid)}
                          target="_blank"
                          rel="noreferrer noopener"
                        >
                          {c.name}
                        </a>
                        {/* MusicBrainz's own one-line note. Often the whole
                            answer, and absent as often, so it is only rendered
                            when there is one. */}
                        {c.disambiguation ? (
                          <span style={S.disamb}>{c.disambiguation}</span>
                        ) : null}
                      </div>
                      <div style={S.candSide}>
                        <span className="cat" style={S.sideLabel}>
                          {MB_LABEL}
                        </span>
                        <button
                          type="button"
                          className="btn"
                          disabled={busy}
                          onClick={() => decide(row.queueId, { mbid: c.mbid })}
                        >
                          {PICK_CTA}
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}

              <div style={S.foot}>
                <button
                  type="button"
                  className="btn btn-danger"
                  disabled={busy}
                  onClick={() => decide(row.queueId, { reject: true })}
                >
                  {NONE_CTA}
                </button>
                {failed.has(row.queueId) ? <span style={S.error}>{WRITE_FAILED}</span> : null}
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

const S: Record<string, React.CSSProperties> = {
  intro: { margin: '0.75rem 0 0', fontSize: '0.9rem', maxWidth: '60ch' },
  count: { display: 'block', margin: '1rem 0 0.5rem' },
  empty: { margin: '1rem 0 0', fontSize: '0.9rem' },
  more: { margin: '0 0 0.5rem', fontSize: '0.8rem' },
  list: { listStyle: 'none', margin: '0', padding: '0' },
  /* A hard block per artist, flush against the next. The grid is visible. */
  row: {
    borderTop: 'var(--rule-width) solid var(--ink)',
    padding: '0 0 14px',
    marginTop: '18px',
  },
  /*
   * The question, on flyer stock. Every other screen carries the dandelion
   * block and this one did not, so it read as a wireframe next to them. The
   * band is also what separates one artist from the next down a long page:
   * the row rules alone left 40 blocks that ran together.
   */
  head: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'baseline',
    gap: '12px',
    background: 'var(--dandelion)',
    padding: '8px 10px',
  },
  rawName: { fontWeight: 800, fontSize: '1.25rem', letterSpacing: '-0.01em' },
  lists: { display: 'flex', gap: '6px' },
  /* Boxed so two tags cannot read as one phrase. Ink on dandelion. */
  listTag: { border: '1px solid var(--ink)', padding: '1px 5px' },
  yours: { margin: '8px 0 0', display: 'flex', alignItems: 'baseline', gap: '10px' },
  sideLabel: { opacity: 0.75 },
  cands: { listStyle: 'none', margin: '10px 0 0', padding: '0' },
  cand: {
    display: 'flex',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: '12px',
    padding: '5px 0',
    borderTop: '1px solid var(--ink)',
  },
  candMain: { display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', gap: '10px' },
  candSide: { display: 'flex', alignItems: 'center', gap: '10px' },
  disamb: { fontSize: '0.8rem', opacity: 0.8 },
  none: { margin: '10px 0 0', fontSize: '0.8rem' },
  foot: { display: 'flex', alignItems: 'center', gap: '12px', marginTop: '10px' },
  error: { fontSize: '0.8rem', fontWeight: 700 },
};
