/**
 * Filtering and sorting for the feed.
 *
 * Separate from `Feed.tsx` because that file is a client component and cannot
 * be imported by a Node test. These are the decisions worth testing — which
 * row belongs in which category, and where a partial date sorts — so they live
 * where a test can reach them.
 */

export type CategoryId = 'all' | 'album' | 'single' | 'live' | 'other';
export type StatusId = 'all' | 'coming' | 'released';
export type SourceId = 'all' | 'followed' | 'liked';
export type SortId = 'desc' | 'asc';

/** The shape these predicates actually need. Keeps the tests honest about it. */
interface Filterable {
  releaseType?: string;
  isUpcoming?: boolean;
  eventDate?: string | null;
  followed?: boolean;
  liked?: boolean;
}

/**
 * What kind of record this is — not whether it is out yet.
 *
 * Compilations count as albums: they are album-length records rather than a
 * kind of their own, and at four rows out of 225 a separate category would be
 * one nobody filters by.
 */
export function inCategory(item: Filterable, category: CategoryId): boolean {
  switch (category) {
    case 'album':
      return item.releaseType === 'album' || item.releaseType === 'compilation';
    case 'single':
      return item.releaseType === 'single' || item.releaseType === 'ep';
    case 'live':
      // A released concert recording — a record you can play, not a ticket.
      // Gigs are a different event type and do not appear here.
      return item.releaseType === 'live';
    case 'other':
      // Remixes, soundtracks, demos, DJ mixes. Vague on purpose: the contents
      // genuinely are assorted, and 20 of 25 are remixes.
      return item.releaseType === 'other';
    default:
      return true;
  }
}

/**
 * Whether it is out yet.
 *
 * Independent of category by design. "Coming" was a category alongside Albums
 * once, which made "albums that are not out yet" unreachable — two different
 * questions sharing one control.
 */
export function inStatus(item: Filterable, status: StatusId): boolean {
  if (status === 'coming') return Boolean(item.isUpcoming);
  if (status === 'released') return !item.isUpcoming;
  return true;
}

/**
 * Which list the artist came from.
 *
 * Both flags can be true at once — 477 of 1,408 liked artists are also
 * followed — so these are membership tests, not a partition. "Followed" means
 * *is followed*, whether or not it is also liked; filtering to one list never
 * hides a row from the other.
 *
 * Independent of category and status for the same reason those are independent
 * of each other: "unreleased albums by artists I only liked" is a question
 * someone can ask, and folding any two of these into one control makes it
 * unaskable.
 */
export function inSource(item: Filterable, source: SourceId): boolean {
  if (source === 'followed') return Boolean(item.followed);
  if (source === 'liked') return Boolean(item.liked);
  return true;
}

/**
 * Split a sorted list into month groups, preserving order.
 *
 * Grouping rather than a per-row comparison because three things now need the
 * same answer: the collapsible sections, the month filter's options, and
 * pagination, which pages whole months rather than slicing one in half. Doing
 * it three times from three places is how they drift apart.
 *
 * `key` is supplied so this file does not import the formatter: the caller
 * decides what a month is called, this decides where the boundaries are.
 */
export function groupByMonth<T>(
  items: T[],
  key: (item: T) => string | null,
): { month: string | null; items: T[] }[] {
  const groups: { month: string | null; items: T[] }[] = [];

  for (const item of items) {
    const month = key(item);
    const last = groups[groups.length - 1];
    // Compare against the previous group only, never a lookup: a month that
    // recurs after a gap is a second section, which is what the sort produced
    // and what the reader sees.
    if (last && last.month === month) last.items.push(item);
    else groups.push({ month, items: [item] });
  }

  return groups;
}

/**
 * Sort by date, with partial dates ordered sensibly.
 *
 * String comparison, because ISO dates sort correctly as text and a partial
 * date lands at the start of its period ('2027' before '2027-03-14') — the
 * honest position for a record we only know the year of.
 *
 * `Date.parse` would give the same order here: JS parses '2027' to 1 January
 * 2027, which coincides with where the string sorts. Checked rather than
 * assumed, after a mutation swapping the two failed to break any test. Strings
 * are still preferred: no parsing, no timezone, and nothing that could quietly
 * turn a year into a day if the input shape ever widens.
 *
 * An undated row sorts last in either direction, because it has no place on
 * the timeline at all and pretending otherwise would rank it.
 */
export function byDate(sort: SortId) {
  return (a: Filterable, b: Filterable): number => {
    if (!a.eventDate && !b.eventDate) return 0;
    if (!a.eventDate) return 1;
    if (!b.eventDate) return -1;
    const cmp = a.eventDate.localeCompare(b.eventDate);
    return sort === 'asc' ? cmp : -cmp;
  };
}
