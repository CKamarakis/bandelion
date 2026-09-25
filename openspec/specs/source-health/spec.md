# source-health Specification

## Purpose

Keeps one failing third-party source from breaking the rest: adapters report
failures as data, and each source's health is recorded for the UI to show.

## Requirements

### Requirement: Adapters never throw out of a fetch
Every source adapter SHALL catch transport errors, HTTP errors and unexpected
response shapes, and SHALL return what it collected with an incomplete flag and
a reason rather than throw. Results from pages fetched before a failure SHALL be
kept.

#### Scenario: Network error
- **WHEN** a request throws a network error
- **THEN** the adapter returns no items, reports incomplete, and preserves the error message

#### Scenario: Failure on a later page
- **WHEN** page two fails after page one succeeded
- **THEN** page one's items are returned and the result is not complete

### Requirement: Nothing is distinguished from unknown
An adapter SHALL report a genuinely empty result as complete and SHALL report a
failed, capped or unrecognised result as incomplete, so an outage is never read
as "nothing new".

#### Scenario: Empty library
- **WHEN** a source genuinely returns no items
- **THEN** the result is complete with no items

#### Scenario: Unrecognised shape
- **WHEN** a response does not have the expected shape
- **THEN** the result is incomplete and the error names the endpoint

#### Scenario: Rate limited
- **WHEN** a source answers 429
- **THEN** the result reports a rate limit and surfaces the retry-after value

### Requirement: Source health is recorded per source
The system SHALL record each source's health: one failure makes it degraded,
three consecutive failures make it failing, and a success returns it to healthy,
resets the count, clears the last error and records when it succeeded. The last
error SHALL be kept, truncated, for the UI.

#### Scenario: Third consecutive failure
- **WHEN** a source fails three times in a row
- **THEN** its health is failing and the failure count is three

#### Scenario: Recovery
- **WHEN** a failing source succeeds
- **THEN** its health is healthy with no error and a zero count

### Requirement: Unconfigured sources are disabled
Every source adapter SHALL report itself not enabled when any credential it
needs is missing from configuration.

#### Scenario: Missing client secret
- **WHEN** the Spotify client secret is not configured
- **THEN** the Spotify adapter reports itself disabled
