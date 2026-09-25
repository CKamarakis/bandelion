# identity-resolution Specification

## Purpose

Gives each imported artist a MusicBrainz identity (MBID), preferring an exact
join over any name match, so that releases can be fetched for the right act.

## Requirements

### Requirement: Exact join first
The system SHALL first resolve an artist by asking MusicBrainz which artist
carries the artist's Spotify URL, and SHALL accept that answer without review.

#### Scenario: Spotify URL relation exists
- **WHEN** MusicBrainz has an artist linked to the Spotify URL
- **THEN** that MBID is stored on the artist

### Requirement: Name search yields candidates, and triage decides only what it can prove
When the exact join finds nothing, the system SHALL search by name and accept a
candidate only when exactly one survives every triage rule: same word count,
exact name after normalisation (case, accents and punctuation ignored), and
exact spelling where several acts share the name. Collaboration credits and
non-musical entity types SHALL be removed before the rules apply. Anything else
SHALL go to the review queue with its candidates.

#### Scenario: Several acts share a spelling
- **WHEN** five identically spelled bands are candidates
- **THEN** no MBID is stored and the artist is queued for review

#### Scenario: Exact spelling breaks a tie
- **WHEN** candidates differ only in spelling and one matches exactly
- **THEN** the exact spelling is accepted, even if another scored higher

#### Scenario: A top-scored name in another script
- **WHEN** the highest-scored candidate's name is in a different script
- **THEN** triage does not decide and the artist is queued

### Requirement: Two artists never share an MBID
The system MUST NOT assign the same MBID to two artists.

#### Scenario: Two same-named acts in the roster
- **WHEN** the roster holds two artists whose names MusicBrainz answers with the same candidate list
- **THEN** they remain two artists with distinct MBIDs or with one left unresolved

### Requirement: Artist links are stored with the identity
The system SHALL store the MusicBrainz URL relations of the kinds it keeps
alongside the MBID, SHALL NOT store the Spotify link back, and SHALL write a
repeated link only once. Links are best-effort and MUST NOT be presented as a
complete profile.

#### Scenario: Links recorded
- **WHEN** an artist resolves
- **THEN** its kept links are stored once each and the Spotify link is not among them

### Requirement: Resolution is resumable and tolerates a busy source
The system SHALL checkpoint by artist, retry transport faults (5xx, dropped
sockets), count an artist that still fails as transient, continue with the
rest, and retry skipped artists before reporting complete. A run that stops
early MUST NOT report complete. An aborted request MUST propagate rather than
be retried.

#### Scenario: One busy lookup
- **WHEN** one artist's lookup keeps returning 503
- **THEN** it is retried, then counted as transient, and every other artist still resolves

#### Scenario: An unresolvable artist
- **WHEN** an artist cannot be resolved in a run
- **THEN** it is attempted at most twice and the job terminates

#### Scenario: Source down
- **WHEN** MusicBrainz is unreachable for the whole run
- **THEN** nothing resolves, the run finishes, and the failure is recorded
