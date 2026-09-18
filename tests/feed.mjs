/**
 * The feed: its query and its formatting.
 *
 * The rule under test is the one the whole project turns on — **never show more
 * precision than the source gave us**. A card reading "31 Dec 2027" because
 * MusicBrainz said "2027" is the same bug as "Tickets on sale Friday" when we
 * failed to parse a status.
 */

const { openDatabase, upsertArtist, insertReleaseEvent, getFeed, getFeedCounts } = await import(
  '../src/db/index.ts'
);
const { formatEventDate, relativeDays, releaseTypeLabel, catalogueNumber } = await import(
  '../src/app/feed-format.ts'
);

let failed = 0;
const check = (ok, msg, detail) => {
  if (ok) console.log(`pass  ${msg}`);
  else {
    console.error(`FAIL  ${msg}${detail ? `\n      ${detail}` : ''}`);
    failed++;
  }
};

console.log('\n# dates are shown exactly as precisely as we know them');

check(formatEventDate('2027-03-14', 'day') === '14 Mar 2027', 'a full date shows the day');
check(formatEventDate('2027-03', 'month') === 'Mar 2027', 'a month-precision date shows no day');
check(formatEventDate('2027', 'year') === '2027', 'a year-precision date shows only the year');
check(formatEventDate(null, 'day') === 'No date', 'a missing date says so rather than guessing');

// The bug this file exists to prevent, stated as a test.
for (const [date, precision] of [
  ['2027', 'year'],
  ['2027-03', 'month'],
]) {
  const out = formatEventDate(date, precision);
  check(
    !/\d{1,2} \w{3} \d{4}/.test(out),
    `a ${precision}-precision date never renders as a full day (${out})`,
  );
}

// Leading zeros are a real upstream shape and must not survive to the screen.
check(formatEventDate('2027-03-04', 'day') === '4 Mar 2027', 'a single-digit day drops its zero');

console.log('\n# relative time is only offered when it is honest');

const TODAY = '2026-09-15';
check(relativeDays('2026-09-15', 'day', TODAY) === 'Today', 'today reads as Today');
check(relativeDays('2026-09-16', 'day', TODAY) === 'Tomorrow', 'tomorrow reads as Tomorrow');
check(relativeDays('2026-09-18', 'day', TODAY) === 'In 3 days', 'a few days out counts days');
check(relativeDays('2026-10-16', 'day', TODAY) === 'In 4 weeks', 'a month out counts weeks');

/*
 * The important half: a month- or year-precision date spans weeks or a year,
 * so counting days from it would invent a day we never had.
 */
check(relativeDays('2027', 'year', TODAY) === null, 'a year-only date gets no countdown');
check(relativeDays('2026-10', 'month', TODAY) === null, 'a month-only date gets no countdown');
check(relativeDays(null, 'day', TODAY) === null, 'a missing date gets no countdown');
check(relativeDays('2026-09-01', 'day', TODAY) === null, 'a past date gets no countdown');
check(relativeDays('2028-01-01', 'day', TODAY) === null, 'a distant date gets no vague countdown');

console.log('\n# labels');

check(releaseTypeLabel('album') === 'Album', 'album');
check(releaseTypeLabel('ep') === 'EP', 'ep keeps its capitals');
check(releaseTypeLabel('live') === 'Live', 'live');
check(releaseTypeLabel('other') === 'Other', 'other');
check(releaseTypeLabel('nonsense') === 'Other', 'an unknown type falls back rather than crashing');
{
  // Month bands. The rule that matters: never invent a month the data does
  // not have, which is the same rule formatEventDate follows.
  const { monthGroup } = await import('../src/app/feed-format.ts');

  check(monthGroup('2026-09-18', 'day') === 'September 2026', 'a full date groups by month');
  check(monthGroup('2026-09', 'month') === 'September 2026', 'a month-precision date groups the same');
  check(monthGroup('2026', 'year') === '2026', 'a year-only date groups by year, not a guessed month');
  check(monthGroup(null, 'day') === null, 'an undated row groups under nothing');
  check(
    monthGroup('2026-09-18', 'year') === '2026',
    'precision wins over the string: a year-precision row never claims a month',
  );
  check(monthGroup('2026-12-31', 'day') === 'December 2026', 'December does not fall off the end');
  check(monthGroup('2026-01-01', 'day') === 'January 2026', 'January is not off by one');

  // A year-only group reads fine in the list, where it sits in date order, and
  // as a broken entry in a dropdown beside "November 2026".
  const { monthFilterLabel } = await import('../src/app/feed-format.ts');
  check(
    monthFilterLabel('2026') === '2026, month unknown',
    'a year-only group says why it has no month in the filter',
  );
  check(
    monthFilterLabel('November 2026') === 'November 2026',
    'a real month is unchanged in the filter',
  );
}

check(catalogueNumber(42) === 'BND 0042', 'the catalogue number is padded');
check(catalogueNumber(12345) === 'BND 12345', 'a long id is not truncated');

console.log('\n# the feed query');

function seed() {
  const db = openDatabase(':memory:');
  const artist = (name) => upsertArtist(db, { name, nameNormalized: name.toLowerCase() });

  const a = artist('Boy Harsher');
  const b = artist('Bonobo');
  const c = artist('Haken');

  insertReleaseEvent(db, {
    artistId: a, title: 'GET MEAN', eventDate: '2026-09-18', datePrecision: 'day',
    sourceEventId: 'rg-upcoming', sourceUrl: null, releaseType: 'album',
    isUpcoming: true, payload: null,
  });
  insertReleaseEvent(db, {
    artistId: b, title: 'Distance in Static', eventDate: '2026-09-11', datePrecision: 'day',
    sourceEventId: 'rg-past', sourceUrl: null, releaseType: 'album',
    isUpcoming: false, payload: null,
  });
  insertReleaseEvent(db, {
    artistId: c, title: 'Someday', eventDate: '2027', datePrecision: 'year',
    sourceEventId: 'rg-year', sourceUrl: null, releaseType: 'album',
    isUpcoming: true, payload: null,
  });
  return db;
}

{
  const db = seed();
  const feed = getFeed(db, { type: 'release' });

  check(feed.length === 3, `every release is returned (${feed.length})`);
  check(feed[0].isUpcoming === true, 'upcoming releases sort above released ones');
  check(
    feed[feed.length - 1].isUpcoming === false,
    'released items come last',
  );

  // Upcoming ascends (soonest first); released descends (newest first).
  const upcoming = feed.filter((f) => f.isUpcoming).map((f) => f.eventDate);
  check(
    upcoming[0] === '2026-09-18' && upcoming[1] === '2027',
    'upcoming runs soonest-first',
    upcoming.join(' '),
  );

  const yearRow = feed.find((f) => f.eventDate === '2027');
  check(yearRow.datePrecision === 'year', 'precision survives the query');
  check(
    formatEventDate(yearRow.eventDate, yearRow.datePrecision) === '2027',
    'a year-only row renders as a year end to end',
  );

  const counts = getFeedCounts(db);
  check(counts.total === 3, 'counts report the total');
  check(counts.upcoming === 2, 'counts report upcoming separately');
  check(counts.artists === 3, 'counts report distinct artists');
}

{
  const db = openDatabase(':memory:');
  const feed = getFeed(db, { type: 'release' });
  check(feed.length === 0, 'an empty database returns an empty feed rather than throwing');
  check(getFeedCounts(db).total === 0, 'counts on an empty database are zero');
}

console.log('\n# the count reports what exists, not what was fetched');

{
  /*
   * Found by screenshot: the header read "200 releases" against a database
   * holding 225, because it counted the rows the query returned rather than
   * the rows that exist. The limit is a page size; the count must not inherit
   * it, or the screen states a total it never measured.
   */
  const db = openDatabase(':memory:');
  const artistId = upsertArtist(db, { name: 'Prolific', nameNormalized: 'prolific' });
  for (let i = 0; i < 12; i++) {
    insertReleaseEvent(db, {
      artistId, title: `Record ${i}`, eventDate: `2026-0${(i % 9) + 1}-01`,
      datePrecision: 'day', sourceEventId: `rg-${i}`, sourceUrl: null,
      releaseType: 'album', isUpcoming: false, payload: null,
    });
  }

  const limited = getFeed(db, { type: 'release', limit: 5 });
  check(limited.length === 5, 'the limit caps the rows fetched');
  check(
    getFeedCounts(db).total === 12,
    'the count still reports every row in the database',
    `counted ${getFeedCounts(db).total}`,
  );
  check(
    getFeedCounts(db).total !== limited.length,
    'the count is not the page size — the two must be able to disagree',
  );
}

console.log('\n# category and status are independent');

{
  /*
   * "Coming" used to be a category alongside Albums, which made "albums that
   * are not out yet" unreachable — the two questions are independent and now
   * have their own controls. These assert the filter predicates directly,
   * since the component itself needs a browser.
   */
  const { inCategory, inStatus, byDate } = await import('../src/app/feed-filters.ts');

  const row = (releaseType, isUpcoming, eventDate = '2026-01-01') => ({
    releaseType,
    isUpcoming,
    eventDate,
  });

  check(inCategory(row('album'), 'album'), 'an album is in Albums');
  check(
    inCategory(row('compilation'), 'album'),
    'a compilation counts as an album — it is an album-length record',
  );
  check(inCategory(row('ep'), 'single'), 'an EP sits with singles');
  check(inCategory(row('single'), 'single'), 'a single sits with singles');
  check(inCategory(row('live'), 'live'), 'a live recording has its own category');
  check(!inCategory(row('live'), 'other'), 'a live recording is no longer lumped into Other');
  check(inCategory(row('other'), 'other'), 'remixes and the rest land in Other');
  check(inCategory(row('album'), 'all'), 'All admits everything');

  check(inStatus(row('album', true), 'coming'), 'an unreleased record is Coming');
  check(!inStatus(row('album', false), 'coming'), 'a released record is not Coming');
  check(inStatus(row('album', false), 'released'), 'a released record is Released');
  check(inStatus(row('album', true), 'all'), 'All admits both statuses');

  // The combination that was impossible before.
  const unreleasedAlbum = row('album', true);
  check(
    inCategory(unreleasedAlbum, 'album') && inStatus(unreleasedAlbum, 'coming'),
    'an album that is not out yet matches both Albums and Coming',
  );

  // --- Which list the artist came from -------------------------------------
  // Followed and liked overlap rather than partition, so these are membership
  // tests. The bug worth guarding: an artist on both lists disappearing from
  // one of them, or being counted twice in All.

  const { inSource } = await import('../src/app/feed-filters.ts');
  const from = (followed, liked) => ({ followed, liked });

  check(inSource(from(true, false), 'followed'), 'a followed artist is in Followed');
  check(!inSource(from(true, false), 'liked'), 'a followed-only artist is not in Liked');
  check(inSource(from(false, true), 'liked'), 'a liked artist is in Liked');
  check(!inSource(from(false, true), 'followed'), 'a liked-only artist is not in Followed');

  const both = from(true, true);
  check(inSource(both, 'followed'), 'an artist on both lists shows under Followed');
  check(inSource(both, 'liked'), 'an artist on both lists shows under Liked too');
  check(inSource(both, 'all'), 'an artist on both lists shows under All');

  // 477 of 1,408 real artists are on both lists. If All were a union of two
  // filtered passes rather than one predicate, each would appear twice.
  const roster = [from(true, false), from(false, true), both];
  const all = roster.filter((r) => inSource(r, 'all'));
  check(all.length === 3, 'All returns each artist exactly once', `got ${all.length}`);

  check(
    !inSource(from(false, false), 'followed') && !inSource(from(false, false), 'liked'),
    'an artist on no list matches neither named filter',
  );
  check(inSource(from(false, false), 'all'), 'All still admits an artist on no list');

  // Independent of the other two controls, like category and status are of
  // each other: "unreleased albums by artists I only liked" must be askable.
  const likedUnreleasedAlbum = { ...row('album', true), followed: false, liked: true };
  check(
    inCategory(likedUnreleasedAlbum, 'album') &&
      inStatus(likedUnreleasedAlbum, 'coming') &&
      inSource(likedUnreleasedAlbum, 'liked'),
    'all three filters combine on one row',
  );

  /*
   * Which empty state the screen should show.
   *
   * Narrowing to a list that has no releases yet is answered by running the
   * release sweep; a filter combination matching nothing is answered by
   * changing the filter. Telling someone "nothing matches" when their liked
   * artists have simply never been swept sends them to the wrong fix.
   *
   * This asserts the CONDITION, not the rendered copy: with real data every
   * filter combination currently returns rows, so the empty branch could not
   * be reached in a browser to screenshot it.
   */
  const sourceOnly = (category, status, source) =>
    source !== 'all' && category === 'all' && status === 'all';

  check(sourceOnly('all', 'all', 'liked'), 'narrowing only the list picks the list-empty message');
  check(
    !sourceOnly('album', 'all', 'liked'),
    'adding a category makes it a filter-combination message instead',
  );
  check(
    !sourceOnly('all', 'coming', 'liked'),
    'adding a status makes it a filter-combination message instead',
  );
  check(!sourceOnly('all', 'all', 'all'), 'no narrowing at all is not a list-empty case');

  // --- Month grouping, which the sections and pagination both read ----------

  const { groupByMonth } = await import('../src/app/feed-filters.ts');
  const m = (month) => ({ month });
  const key = (x) => x.month;

  {
    const groups = groupByMonth(
      [m('Nov'), m('Nov'), m('Oct'), m('Sep'), m('Sep'), m('Sep')],
      key,
    );
    check(groups.length === 3, 'consecutive months collapse into one group each', `${groups.length}`);
    check(
      groups.map((g) => `${g.month}:${g.items.length}`).join(' ') === 'Nov:2 Oct:1 Sep:3',
      'each group keeps its own rows in order',
      groups.map((g) => `${g.month}:${g.items.length}`).join(' '),
    );
  }

  check(groupByMonth([], key).length === 0, 'an empty list produces no groups');

  {
    // Order is preserved, never sorted: the caller already sorted, and
    // re-ordering here would silently override the sort control.
    const groups = groupByMonth([m('Jan'), m('Dec'), m('Jan')], key);
    check(
      groups.length === 3,
      'a month that recurs after a gap is a second section, not a merge',
      `${groups.length}`,
    );
  }

  {
    const groups = groupByMonth([m(null), m(null), m('Sep')], key);
    check(groups.length === 2, 'undated rows group together');
    check(groups[0].month === null, 'the undated group keeps a null month');
  }

  // --- Paging whole months --------------------------------------------------
  // Mirrors the packing in Feed.tsx: months are never split across a page.

  const paginate = (groups, size) => {
    const out = [];
    let current = [];
    let count = 0;
    for (const g of groups) {
      current.push(g);
      count += g.items.length;
      if (count >= size) {
        out.push(current);
        current = [];
        count = 0;
      }
    }
    if (current.length > 0) out.push(current);
    return out;
  };

  const rows = (n) => Array.from({ length: n }, () => ({}));

  {
    const pages = paginate(
      [{ month: 'A', items: rows(60) }, { month: 'B', items: rows(50) }, { month: 'C', items: rows(40) }],
      100,
    );
    check(pages.length === 2, 'a page breaks once it reaches the size', `${pages.length}`);
    check(
      pages[0].reduce((n, g) => n + g.items.length, 0) === 110,
      'the first page fills past the size rather than stopping short',
      `${pages[0].reduce((n, g) => n + g.items.length, 0)} rows`,
    );
  }

  {
    /*
     * The bug this replaced: breaking before the overflow gave a 30-row first
     * page (6 + 24) because the next month held 88. Overshooting a full page
     * beats shipping a third of one.
     */
    const pages = paginate(
      [{ month: 'Nov', items: rows(6) }, { month: 'Oct', items: rows(24) }, { month: 'Sep', items: rows(88) }],
      100,
    );
    check(
      pages[0].reduce((n, g) => n + g.items.length, 0) === 118,
      'a short first page absorbs the next month rather than breaking early',
      `${pages[0].reduce((n, g) => n + g.items.length, 0)} rows`,
    );
    check(pages.length === 1, 'and everything fits in one page here', `${pages.length}`);
  }

  {
    // A month bigger than a page is never cut in half.
    const pages = paginate([{ month: 'Big', items: rows(250) }], 100);
    check(pages.length === 1, 'a month larger than a page is its own page, not split');
    check(pages[0][0].items.length === 250, 'and keeps all of its rows');
  }

  check(paginate([], 100).length === 0, 'no groups means no pages');
}

console.log('\n# sorting by date');

{
  const { byDate } = await import('../src/app/feed-filters.ts');
  const mk = (eventDate) => ({ eventDate });

  const dates = ['2026-03-01', '2026-01-01', '2026-02-01'].map(mk);
  const desc = [...dates].sort(byDate('desc')).map((d) => d.eventDate);
  const asc = [...dates].sort(byDate('asc')).map((d) => d.eventDate);

  check(desc[0] === '2026-03-01', 'newest first puts the latest date on top');
  check(asc[0] === '2026-01-01', 'oldest first reverses it');

  /*
   * A partial date sorts against the start of its period: '2027' before
   * '2027-03-14'. That is the honest position for a record we only know the
   * year of, and it falls out of ISO strings comparing correctly as text.
   */
  const partial = ['2027-03-14', '2027'].map(mk);
  const partialAsc = [...partial].sort(byDate('asc')).map((d) => d.eventDate);
  check(
    partialAsc[0] === '2027',
    'a year-only date sorts at the start of its year, not the end',
    partialAsc.join(' '),
  );

  // An undated row has no place on the timeline, so it sits last either way
  // rather than pretending to be very old or very new.
  const withNull = ['2026-01-01', null, '2026-05-01'].map(mk);
  check(
    [...withNull].sort(byDate('desc')).at(-1).eventDate === null,
    'an undated row sorts last when newest-first',
  );
  check(
    [...withNull].sort(byDate('asc')).at(-1).eventDate === null,
    'an undated row sorts last when oldest-first too',
  );
}

console.log(failed ? `\n${failed} check(s) failed` : '\nall feed checks passed');
// The exit call is the last statement in this file — see decision 031.
process.exit(failed ? 1 : 0);
