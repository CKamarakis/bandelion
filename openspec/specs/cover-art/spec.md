# cover-art Specification

## Purpose

Adds a sleeve image to each release from the Cover Art Archive, and remembers
which releases have none so they are asked about only once.

## Requirements

### Requirement: Covers are looked up by release-group
The system SHALL look up the front cover for each stored release by its
release-group MBID and store the image URL when one exists.

#### Scenario: Cover exists
- **WHEN** the archive has a front cover for a release
- **THEN** its URL is stored on the release

### Requirement: A release with no cover is checked once
The system SHALL record a release as checked when the archive has no art for
it, and MUST NOT ask about that release again. A release that could not be
reached MUST stay unchecked so the next run retries it.

#### Scenario: No art in the archive
- **WHEN** the archive answers "not found" for a release
- **THEN** the release is marked checked with no cover, and later runs skip it

#### Scenario: Archive unreachable
- **WHEN** the lookup for a release fails in transport
- **THEN** it is counted as transient and left unchecked

### Requirement: The cover pass is resumable
The system SHALL checkpoint by release and MUST NOT report complete for a run
that stopped early.

#### Scenario: Interrupted pass
- **WHEN** the pass stops before the last release
- **THEN** it is not complete and the next run continues from the checkpoint
