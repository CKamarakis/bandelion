'use client';

/**
 * The import control on the connect screen.
 *
 * A client component because the import is long-running: it starts a job and
 * polls for progress. The request itself returns immediately (constraint 4), so
 * this is the thing that reports what is happening.
 *
 * Copy note: every count here is read from the database, and the total is only
 * shown when Spotify actually gave us one. A progress bar with an invented
 * denominator is precisely the dishonesty rule 8 forbids.
 */

import { useEffect, useState } from 'react';

const IMPORT_CTA = 'Import artists';
const IMPORT_AGAIN_CTA = 'Check for new artists';
const IMPORTING = 'Importing';
const RESUME_CTA = 'Resume import';

/*
 * Failure copy names the source and what to do. It never says the roster is
 * empty, because a failed import tells us nothing about how many artists you
 * follow.
 */
const FAILED_LABEL = 'Import stopped';
const FAILED_HINT = 'Run it again to pick up where it stopped.';

interface Status {
  status: string;
  imported: number;
  total: number | null;
  lastError: string | null;
  complete: boolean;
}

const FOLLOWED_LABEL = 'Followed';
const LIKED_LABEL = 'Liked songs';

export function RosterImport({
  initial,
  action,
  liked,
}: {
  initial: Status;
  /** Rendered beside the import button, so the panel's actions share a row. */
  action?: React.ReactNode;
  /**
   * Liked-song artist counts, when that import has run. Absent rather than
   * zeroed: "0 imported" claims we looked and found none, which is a different
   * fact from never having run `npm run ingest liked`.
   */
  liked?: { imported: number; alsoFollowed: number; tracksRead: number; total: number | null };
}) {
  const [state, setState] = useState<Status>(initial);
  const [busy, setBusy] = useState(false);

  const running = state.status === 'running' || busy;

  // Poll only while something is running. A page sitting idle should not make
  // a request every two seconds forever.
  useEffect(() => {
    if (!running) return;
    const id = setInterval(async () => {
      try {
        const res = await fetch('/api/roster');
        if (res.ok) {
          const next = (await res.json()) as Status;
          setState(next);
          if (next.status !== 'running') setBusy(false);
        }
      } catch {
        // A failed poll is not a failed import. Leave the last known state and
        // try again on the next tick.
      }
    }, 2000);
    return () => clearInterval(id);
  }, [running]);

  async function start() {
    setBusy(true);
    try {
      const res = await fetch('/api/roster', { method: 'POST' });
      if (res.ok) setState((await res.json()) as Status);
      else setBusy(false);
    } catch {
      setBusy(false);
    }
  }

  const cta = state.complete ? IMPORT_AGAIN_CTA : state.imported > 0 ? RESUME_CTA : IMPORT_CTA;

  return (
    <div>

      {state.lastError && !running ? (
        <p style={S.error}>
          <span style={S.errorLabel}>{FAILED_LABEL}</span>
          {` ${state.lastError} ${FAILED_HINT}`}
        </p>
      ) : null}

      {/* `action` is whatever else belongs on this row, passed in by the page
          so the panel owns its layout and this component owns its button. */}
      <div style={S.actions}>
        <button type="button" className="btn btn-spotify" onClick={start} disabled={running}>
          {running ? `${IMPORTING}…` : cta}
        </button>
        {action}
      </div>

      {/*
        Counts under the buttons, not above them: the panel's job is the two
        actions, and the numbers are what those actions produced.

        Both lists, because showing only one next to a button labelled "check
        for new artists" implies that button is the only way artists arrive.
        Never a total we were not given: `total` is null until Spotify says.
      */}
      <dl style={S.meta}>
        <dt style={S.key}>{FOLLOWED_LABEL}</dt>
        <dd style={S.val}>
          {state.total === null
            ? `${state.imported} imported`
            : `${state.imported} of ${state.total} imported`}
        </dd>
        {liked ? (
          <>
            <dt style={S.key}>{LIKED_LABEL}</dt>
            <dd style={S.val}>
              {/*
                Artists from tracks, not "x of y artists": Spotify reports how
                many saved TRACKS exist and never how many distinct artists are
                on them, so "1408 of 2081" would put artists over songs and
                read as a third of the import still missing.
              */}
              {liked.total === null
                ? `${liked.imported} artists`
                : `${liked.imported} artists from ${liked.tracksRead} of ${liked.total} songs`}
            </dd>
          </>
        ) : null}
      </dl>
    </div>
  );
}

const S: Record<string, React.CSSProperties> = {
  meta: { display: 'flex', flexWrap: 'wrap', gap: '10px', margin: '0 0 18px', fontSize: '0.8rem' },
  key: { margin: 0, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.12em' },
  val: { margin: 0 },
  error: {
    margin: '0 0 18px',
    padding: '10px 12px',
    borderLeft: '6px solid var(--violet)',
    background: 'var(--white)',
    fontSize: '0.8rem',
    maxWidth: '52ch',
  },
  errorLabel: { fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em' },
  actions: { display: 'flex', flexWrap: 'wrap', gap: '12px', alignItems: 'center' },
};
