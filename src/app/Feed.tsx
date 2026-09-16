/**
 * The feed: releases as a dated list.
 *
 * Client component because the filter is interactive, but it renders from data
 * the server already read — no fetch on mount, so there is no empty flash and
 * the list is present in the HTML.
 *
 * The design is the Factory idea from CLAUDE.md: the data *is* the ornament.
 * Dates, catalogue numbers and type labels set in monospace at real scale,
 * hard rules between rows, no decoration added on top. Upcoming records get
 * the dandelion block because they are the thing you came for; released ones
 * sit on white.
 */

'use client';

import { useMemo, useState } from 'react';
import type { FeedItem } from '../db/index.ts';
import {
  catalogueNumber,
  formatEventDate,
  relativeDays,
  releaseTypeLabel,
} from './feed-format.ts';

/*
 * Copy, hoisted so every user-facing string is reviewable in one place against
 * the eight rules.
 *
 * Rule 8 governs the empty states. "No releases yet" would claim we looked and
 * found nothing; before a sweep has run we have not looked at all, and the two
 * must read differently.
 */
const HEADING = 'Releases';
const EMPTY_NOT_RUN = 'No releases imported yet.';
const EMPTY_NOT_RUN_HINT = 'Run npm run ingest releases to check your artists.';
const EMPTY_FILTERED = 'Nothing matches this filter.';
const UPCOMING_LABEL = 'Announced';
const RELEASED_LABEL = 'Out now';
const COUNT_LABEL = (shown: number, total: number) =>
  shown === total ? `${total} release${total === 1 ? '' : 's'}` : `${shown} of ${total}`;
/*
 * Said only when the list is genuinely truncated, and it names the reason.
 * The header previously read "200 releases" against a database holding 225,
 * because it counted the rows fetched rather than the rows that exist — the
 * screen asserting a total it had not actually measured.
 */
const TRUNCATED = (total: number, loaded: number) =>
  `${total} releases · showing the newest ${loaded}`;

/** Filters name what they show. A filter nobody can read is decoration. */
const FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'upcoming', label: 'Announced' },
  { id: 'album', label: 'Albums' },
  { id: 'single', label: 'Singles & EPs' },
  { id: 'other', label: 'Live & other' },
] as const;

type FilterId = (typeof FILTERS)[number]['id'];

function matches(item: FeedItem, filter: FilterId): boolean {
  switch (filter) {
    case 'upcoming':
      return item.isUpcoming;
    case 'album':
      return item.releaseType === 'album';
    case 'single':
      return item.releaseType === 'single' || item.releaseType === 'ep';
    case 'other':
      return ['live', 'compilation', 'other'].includes(item.releaseType);
    default:
      return true;
  }
}

export function Feed({
  items,
  today,
  total,
}: {
  items: FeedItem[];
  today: string;
  /** Rows in the database, which may exceed the rows fetched. */
  total: number;
}) {
  const [filter, setFilter] = useState<FilterId>('all');

  const shown = useMemo(() => items.filter((i) => matches(i, filter)), [items, filter]);

  // Never run vs ran and found nothing are different facts and read
  // differently. Only the first can be fixed by running the job.
  if (items.length === 0) {
    return (
      <section style={S.section}>
        <h2>{HEADING}</h2>
        <p style={S.empty}>{EMPTY_NOT_RUN}</p>
        <p style={S.emptyHint}>{EMPTY_NOT_RUN_HINT}</p>
      </section>
    );
  }

  return (
    <section style={S.section}>
      <div style={S.headRow}>
        <h2>{HEADING}</h2>
        <span className="cat" style={S.count}>
          {items.length < total && filter === 'all'
            ? TRUNCATED(total, items.length)
            : COUNT_LABEL(shown.length, items.length)}
        </span>
      </div>

      <div style={S.filters} role="group" aria-label="Filter releases">
        {FILTERS.map((f) => {
          const active = f.id === filter;
          return (
            <button
              key={f.id}
              type="button"
              onClick={() => setFilter(f.id)}
              aria-pressed={active}
              style={{ ...S.filter, ...(active ? S.filterActive : null) }}
            >
              {f.label}
            </button>
          );
        })}
      </div>

      {shown.length === 0 ? (
        <p style={S.empty}>{EMPTY_FILTERED}</p>
      ) : (
        <ol style={S.list}>
          {shown.map((item) => (
            <FeedRow key={item.eventId} item={item} today={today} />
          ))}
        </ol>
      )}
    </section>
  );
}

function FeedRow({ item, today }: { item: FeedItem; today: string }) {
  const when = formatEventDate(item.eventDate, item.datePrecision);
  const soon = item.isUpcoming ? relativeDays(item.eventDate, item.datePrecision, today) : null;

  return (
    <li
      className={`feed-row${item.isUpcoming ? ' block-yellow' : ''}`}
    >
      <div className="feed-date">
        <span style={S.date}>{when}</span>
        {/* State is label plus position, never colour alone. */}
        <span className="cat" style={S.state}>
          {item.isUpcoming ? UPCOMING_LABEL : RELEASED_LABEL}
        </span>
        {soon ? (
          <span className="cat" style={S.soon}>
            {soon}
          </span>
        ) : null}
      </div>

      <div className="feed-main">
        <span style={S.artist}>{item.artist}</span>
        <span style={S.title}>{item.title}</span>
      </div>

      <div className="feed-meta">
        <span className="cat" style={S.type}>
          {releaseTypeLabel(item.releaseType)}
        </span>
        <span className="cat" style={S.catalogue}>
          {catalogueNumber(item.eventId)}
        </span>
      </div>
    </li>
  );
}

/*
 * Inline styles to match the rest of the app, which has no CSS modules. Zero
 * border-radius throughout and hard rules rather than shadows — the design
 * rules in CLAUDE.md are not negotiable per-component.
 */
const S: Record<string, React.CSSProperties> = {
  section: { marginTop: '2rem' },
  headRow: {
    display: 'flex',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: '1rem',
    marginBottom: '0.75rem',
  },
  count: { color: 'var(--ink)', opacity: 0.7 },

  filters: { display: 'flex', flexWrap: 'wrap', gap: '0.4rem', marginBottom: '1rem' },
  filter: {
    font: 'inherit',
    fontSize: '0.7rem',
    fontWeight: 700,
    letterSpacing: '0.14em',
    textTransform: 'uppercase',
    padding: '0.4rem 0.7rem',
    border: 'var(--rule-width) solid var(--rule)',
    background: 'var(--white)',
    color: 'var(--ink)',
    cursor: 'pointer',
  },
  filterActive: { background: 'var(--ink)', color: 'var(--white)' },

  list: { listStyle: 'none', margin: 0, padding: 0, borderTop: 'var(--rule-width) solid var(--rule)' },

  // Date and metadata share a line: both are short, and pairing them keeps the
  // row to two lines rather than four.
  date: { fontWeight: 700, fontVariantNumeric: 'tabular-nums' },
  state: { fontSize: '0.6rem', opacity: 0.75 },
  soon: { fontSize: '0.6rem', fontWeight: 700 },

  rowMain: { display: 'flex', flexDirection: 'column', gap: '0.1rem', minWidth: 0 },
  artist: { fontWeight: 800, letterSpacing: '-0.01em' },
  title: { opacity: 0.85, overflowWrap: 'anywhere' },

  type: { fontSize: '0.6rem' },
  catalogue: { fontSize: '0.6rem', opacity: 0.6, fontVariantNumeric: 'tabular-nums' },

  empty: { margin: '0.5rem 0 0' },
  emptyHint: { margin: '0.25rem 0 0', opacity: 0.7, fontSize: '0.85rem' },
};
