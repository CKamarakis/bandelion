# review-queue Specification

## Purpose

Holds the artist names that MusicBrainz could read more than one way as
decisions for the owner, and keeps each decision so it is asked only once.

## Requirements

### Requirement: A queued row carries what is needed to decide it
The system SHALL show each pending row with the name as Spotify gave it, which
list it came from, and every candidate. Each row SHALL link the owner's artist
on Spotify and each candidate on MusicBrainz.

#### Scenario: Reading a row
- **WHEN** the owner opens the review page
- **THEN** each pending artist shows its Spotify name and list, and every candidate with a MusicBrainz link

#### Scenario: Count agrees with the list
- **WHEN** the review page and the navigation count are read together
- **THEN** the count equals the number of pending rows shown

### Requirement: Accepting a candidate resolves the artist and remembers the name
The system SHALL accept a decision naming one candidate's MBID, store it on the
artist, record the name as an alias so it is not asked again, and remove the
row from the queue. The MBID MUST be validated as a UUID and MUST be one of the
row's recorded candidates; any other MBID is rejected with a 400.

#### Scenario: Picking a candidate
- **WHEN** the owner picks a candidate
- **THEN** the artist is resolved, the row leaves the queue and the count drops by one

#### Scenario: Malformed decision
- **WHEN** a decision carries a non-UUID MBID, a non-positive row id, malformed JSON, or both an MBID and a rejection
- **THEN** it is rejected with a 400 and nothing is written

### Requirement: Rejecting keeps the decision
The system SHALL let the owner reject all candidates, leave the artist
unresolved, and mark the row rejected rather than delete it.

#### Scenario: None of these
- **WHEN** the owner rejects a row
- **THEN** the row leaves the queue, the artist stays unresolved, and the row is kept with status rejected

### Requirement: Only a pending row can be decided
The system SHALL answer 404 to a decision for a row that does not exist or was
already decided.

#### Scenario: Deciding twice
- **WHEN** a second decision arrives for a row already confirmed or rejected
- **THEN** it returns 404 and nothing is written
