# release-feed Specification

## Purpose

Shows every stored release in one scannable feed, grouped by month and
filterable, with dates shown only as precisely as they are known.

## Requirements

### Requirement: Upcoming releases sort above released ones
The system SHALL list upcoming releases above released ones, then order by date
in the chosen direction (newest first by default).

#### Scenario: Mixed feed
- **WHEN** the feed holds upcoming and released records
- **THEN** every upcoming record appears before every released one

### Requirement: The feed groups by month, and undated rows go last
The system SHALL group records into month sections, collapse consecutive
records from the same month into one section, and place undated records in one
group at the end.

#### Scenario: Undated record
- **WHEN** a record has no date
- **THEN** it appears in a single undated group after every dated month

### Requirement: Filters answer independent questions
The system SHALL offer filters for kind (all, albums, singles, live, other),
status (all, coming, released), source list (all, followed, liked) and week
(last, this, next, with weeks starting Monday). Compilations SHALL count as
albums and EPs as singles. Each filter MUST combine with the others.

#### Scenario: Albums not out yet
- **WHEN** the owner selects kind "albums" and status "coming"
- **THEN** only upcoming albums and compilations are shown

#### Scenario: A date without a day is in no week
- **WHEN** a week filter is selected and a record is dated only to its month or year
- **THEN** that record is not shown, rather than placed in a guessed week

#### Scenario: Source "all"
- **WHEN** an artist is on both lists and the source filter is "all"
- **THEN** each of its records appears exactly once

### Requirement: Pages break at month boundaries
The system SHALL paginate at 100 records per page without splitting a month,
so a month larger than a page is a page of its own. The page list SHALL always
offer the first, last, current and neighbouring pages, with gaps for skipped
stretches. Turning a page SHALL return the reader to the top of the list.

#### Scenario: Oversized month
- **WHEN** one month holds more than 100 records
- **THEN** that month is one page with all of its records

### Requirement: Dates show the precision that is known
The system SHALL display a date at the precision stored (day, month or year)
and MUST NOT imply a more precise date than the source gave.

#### Scenario: Month-precision record
- **WHEN** a record is known only to its month
- **THEN** the card shows the month with no day, the year being carried by the month section above it

#### Scenario: Year-precision record
- **WHEN** a record is known only to its year
- **THEN** the card shows the year, never a blank

### Requirement: Copy does not assert what the data cannot support
User-facing text SHALL NOT claim completeness or certainty that the stored data
does not support, and SHALL follow the project's copy rules.

#### Scenario: Copy check
- **WHEN** the copy test scans user-facing strings
- **THEN** no string claims completeness the data cannot support

### Requirement: An empty database renders an empty feed
The system SHALL render an empty feed with zero counts, not an error, when no
releases are stored.

#### Scenario: Fresh instance
- **WHEN** the feed is opened before any release sweep
- **THEN** the page renders and every count is zero
