# release-sweep Specification

## Purpose

Turns each resolved artist's MusicBrainz release-groups within a configurable
window into release events, recording only what the source actually knows.

## Requirements

### Requirement: Releases come from MusicBrainz release-groups by MBID
The system SHALL fetch releases by browsing each resolved artist's
release-groups, one request per artist, and SHALL NOT fetch releases for an
artist without an MBID.

#### Scenario: Unresolved artist
- **WHEN** the sweep reaches an artist with no MBID
- **THEN** no request is made for it and the job still completes

### Requirement: Only the configured window is written
The system SHALL write releases dated within the window (by default four months
back and two months forward) and SHALL mark releases dated in the future as
upcoming.

#### Scenario: Old release
- **WHEN** a release-group is dated before the window
- **THEN** it is not written

#### Scenario: Future release
- **WHEN** a release-group is dated after today
- **THEN** it is written and marked upcoming

### Requirement: Dates keep the precision the source gave
The system SHALL store a release date as day, month or year precision matching
the source, SHALL admit year-only dates to the window, and MUST NOT widen a
partial date into a day. Fields the source does not record (announcement date,
cover, track count) MUST be null rather than invented.

#### Scenario: Year-only date
- **WHEN** a release-group is dated "2027"
- **THEN** it is stored with year precision and no invented month or day

### Requirement: A second sighting writes nothing
The system SHALL treat the release-group MBID as the identity of a release; a
release already stored MUST be left exactly as it was, including when it was
first seen.

#### Scenario: Re-running the sweep
- **WHEN** the sweep runs again over the same artists
- **THEN** it sees the same releases and writes no new rows

### Requirement: The sweep is resumable and tolerates a busy source
The system SHALL checkpoint by artist, stamp each swept artist as checked,
count a busy artist as transient without aborting, stop at a budget without
reporting complete, and finish the roster on resume.

#### Scenario: Budget reached
- **WHEN** a run stops at its budget
- **THEN** it is not reported complete and the next run finishes the roster with no duplicate events
