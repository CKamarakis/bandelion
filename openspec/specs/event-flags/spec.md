# event-flags Specification

## Purpose

Lets the owner mark a release as saved, listened and liked, and work through
those marks as two lists: the playlist (saved) and favs (liked).

## Requirements

### Requirement: Three independent flags
The system SHALL keep saved, listened and liked as three independent flags per
release. A write SHALL change only the flags it names; a flag never set MUST
read as off.

#### Scenario: Liking a saved release
- **WHEN** the owner likes a release that is on the playlist
- **THEN** it stays on the playlist and also appears in favs

#### Scenario: Partial write
- **WHEN** a write names only "listened"
- **THEN** saved and liked keep their previous values

### Requirement: Flag writes are validated
The system SHALL reject a flag write whose release id is not a positive integer,
whose body is malformed or names no flag, or whose flag value is not a boolean,
naming the offending flag. A write for a release that does not exist SHALL
return 404 and write nothing.

#### Scenario: String in place of a boolean
- **WHEN** a write sends `"queued": "true"`
- **THEN** it is rejected with a 400 that names `queued`

### Requirement: Feed rows carry their flags
The system SHALL include each release's flags with its feed row, so the UI
needs no separate read.

#### Scenario: Saved release in the feed
- **WHEN** a saved release appears in the feed
- **THEN** its row reports it as saved

### Requirement: A row leaves its list when its flag goes
The system SHALL remove a row from the playlist or favs as soon as the flag
that put it there is cleared, and the list count SHALL follow.

#### Scenario: Un-hearting in favs
- **WHEN** the owner clears the like on a row in favs
- **THEN** the row disappears from favs and the favs count drops by one

### Requirement: Lists can be read by month or by recently added
The system SHALL order a list by release month by default, and SHALL offer
recently added order: rows ordered by when any of their flags last changed,
newest first, without month sections.

#### Scenario: Recently added
- **WHEN** the owner switches the playlist to recently added
- **THEN** the record whose flags changed most recently is first and no month headings are shown

### Requirement: Failed writes revert
The UI SHALL show a flag change immediately and SHALL revert it if the write
fails.

#### Scenario: Server rejects a write
- **WHEN** a flag write fails
- **THEN** the mark returns to its previous state
