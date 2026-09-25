# Spec Delta

## ADDED Requirements

### Requirement: A failing source never empties the feed
When a source fails for every request of a run, the system SHALL leave every
event already stored untouched, SHALL keep serving the feed from them, SHALL
record the source as degraded or failing, and MUST NOT report the run complete.

#### Scenario: MusicBrainz down for a whole release sweep
- **WHEN** every MusicBrainz request of a release sweep fails
- **THEN** the releases stored before the sweep are all still in the feed, the source's health is degraded or failing, and the sweep is not reported complete

#### Scenario: Cover Art Archive down for a whole cover pass
- **WHEN** every Cover Art Archive request of a cover pass fails
- **THEN** no stored release loses its cover or its place in the feed, and the releases stay unchecked for the next run
