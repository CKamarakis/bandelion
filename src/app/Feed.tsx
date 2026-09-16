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
import {
  byDate,
  inCategory,
  inStatus,
  type CategoryId,
  type SortId,
  type StatusId,
} from './feed-filters.ts';

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
const UPCOMING_LABEL = 'Coming';
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

const STATUS_LEGEND = 'Show';
const SORT_LEGEND = 'Sort';

/**
 * What kind of record, not whether it is out yet.
 *
 * "Coming" was a category here and is now a status below, because the two
 * questions are independent: wanting only albums and wanting only unreleased
 * things are different filters, and folding them into one row made "albums
 * that are not out yet" unreachable.
 *
 * Compilations count as albums. They are album-length records rather than a
 * kind of their own, and at four rows out of 225 a separate home would have
 * been a category nobody filters by.
 *
 * "Live recordings" means a released concert recording — a record you can play,
 * not a ticket. Bandelion has no gigs yet; when it does they are a different
 * event type entirely, not a category here.
 */
const CATEGORIES = [
  { id: 'all', label: 'All' },
  { id: 'album', label: 'Albums' },
  { id: 'single', label: 'Singles & EPs' },
  { id: 'live', label: 'Live recordings' },
  { id: 'other', label: 'Other' },
] as const;

/** Whether it is out yet. Independent of category — see inStatus. */
const STATUSES = [
  { id: 'all', label: 'All' },
  { id: 'coming', label: 'Coming' },
  { id: 'released', label: 'Released' },
] as const;

/** Newest first by default: what changed recently is what you came to see. */
const SORTS = [
  { id: 'desc', label: 'Newest first' },
  { id: 'asc', label: 'Oldest first' },
] as const;


/** One control group. Every group looks and behaves the same — consistency of
 *  gesture beats economy of controls. */
function Controls<T extends string>({
  legend,
  options,
  value,
  onChange,
}: {
  legend: string;
  options: readonly { id: T; label: string }[];
  value: T;
  onChange: (id: T) => void;
}) {
  return (
    <div style={S.controlRow}>
      <span className="cat" style={S.legend}>
        {legend}
      </span>
      <div style={S.filters} role="group" aria-label={legend}>
        {options.map((o) => {
          const active = o.id === value;
          return (
            <button
              key={o.id}
              type="button"
              onClick={() => onChange(o.id)}
              aria-pressed={active}
              style={{ ...S.filter, ...(active ? S.filterActive : null) }}
            >
              {o.label}
            </button>
          );
        })}
      </div>
    </div>
  );
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
  const [category, setCategory] = useState<CategoryId>('all');
  const [status, setStatus] = useState<StatusId>('all');
  const [sort, setSort] = useState<SortId>('desc');

  const shown = useMemo(
    () =>
      // filter() already returns a new array, so sorting it in place is safe —
      // but only because of that. Sorting `items` directly would mutate a prop.
      items
        .filter((i) => inCategory(i, category) && inStatus(i, status))
        .sort(byDate(sort)),
    [items, category, status, sort],
  );

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
          {items.length < total && category === 'all' && status === 'all'
            ? TRUNCATED(total, items.length)
            : COUNT_LABEL(shown.length, items.length)}
        </span>
      </div>

      {/* Category first, because it is the coarsest cut; then status and sort,
          which apply within whatever category is showing. */}
      <div style={S.categoryRow} role="group" aria-label="Release type">
        {CATEGORIES.map((c) => {
          const active = c.id === category;
          return (
            <button
              key={c.id}
              type="button"
              onClick={() => setCategory(c.id)}
              aria-pressed={active}
              style={{ ...S.filter, ...(active ? S.filterActive : null) }}
            >
              {c.label}
            </button>
          );
        })}
      </div>

      <div style={S.controls}>
        <Controls legend={STATUS_LEGEND} options={STATUSES} value={status} onChange={setStatus} />
        <Controls legend={SORT_LEGEND} options={SORTS} value={sort} onChange={setSort} />
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

  // The category row reads as the primary cut, so it keeps the full-width
  // treatment and the gap below it.
  categoryRow: { display: 'flex', flexWrap: 'wrap', gap: '0.4rem', marginBottom: '0.6rem' },
  // Status and sort sit together on one line at width, stacking when narrow.
  controls: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '0.6rem 1.4rem',
    marginBottom: '1rem',
    paddingBottom: '0.8rem',
    borderBottom: 'var(--rule-width) solid var(--rule)',
  },
  controlRow: { display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' },
  legend: { fontSize: '0.6rem', opacity: 0.65 },
  filters: { display: 'flex', flexWrap: 'wrap', gap: '0.4rem' },
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
