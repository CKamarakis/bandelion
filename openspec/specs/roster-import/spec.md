# roster-import Specification

## Purpose

Imports the owner's followed artists and the artists behind their liked songs
into one artist table, as a resumable job that never deletes anything.

## Requirements

### Requirement: One artist row, with list membership as flags
The system SHALL store each artist once and record which lists it came from as
independent `followed` and `liked` flags. Importing one list MUST NOT clear the
other list's flag.

#### Scenario: An artist on both lists
- **WHEN** an artist is both followed and credited on a liked song
- **THEN** there is one artist row with both flags set

#### Scenario: Repeating an import
- **WHEN** the same import runs twice
- **THEN** no duplicate artist rows or external ids are created

### Requirement: A source's own id beats a name match
The system SHALL identify an artist by its Spotify id when one is present. Two
Spotify artists sharing a name MUST stay separate rows.

#### Scenario: Same name, different Spotify ids
- **WHEN** two followed artists share a name but have different Spotify ids
- **THEN** both are stored as separate artists

### Requirement: Liked-song artists come from track credits
The system SHALL derive liked artists from the performing artists on each saved
track. Every artist on a collaboration SHALL be kept; a compilation or label
album-artist that does not perform the track MUST be dropped; an item missing
an id or name MUST be skipped rather than guessed at.

#### Scenario: Compilation album-artist
- **WHEN** a saved track sits on a compilation whose album-artist is "Various Artists"
- **THEN** that album-artist is not imported

### Requirement: Import is a checkpointed, resumable job
The system SHALL run the import as a background job that checkpoints after
each page is written, resumes from the next unread page, and reports complete
only when the last page was reached. Starting an import while one is running
MUST NOT start a second.

#### Scenario: Interrupted run
- **WHEN** a run stops at the page cap or on a failed page
- **THEN** artists already written are kept, the job is not marked complete, and the next run fetches only the remaining pages

#### Scenario: Starting an import returns immediately
- **WHEN** the owner starts an import from the UI
- **THEN** the request returns without waiting for the import, and progress is read by polling

#### Scenario: Not connected
- **WHEN** an import is started with no connected Spotify account
- **THEN** the request fails with a not-connected error and no job starts

### Requirement: The import never deletes artists
The system SHALL NOT remove an artist or clear a list flag because it is absent
from an import.

#### Scenario: Artist missing from a later import
- **WHEN** an artist present in an earlier import is absent from a later one
- **THEN** the artist and its flags remain

### Requirement: Status reports what the database holds
The system SHALL report import status from rows actually stored, MUST NOT claim
completion before a complete run, and MUST NOT invent a total before Spotify
reports one.

#### Scenario: Before any import
- **WHEN** status is read on a fresh instance
- **THEN** it reports zero artists, not complete, and no total

#### Scenario: Empty library
- **WHEN** the account follows no artists
- **THEN** the run completes successfully with nothing imported
