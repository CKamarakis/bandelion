# artist-links Specification

## Purpose

Makes an artist's name open that artist in the Spotify desktop app when it is
installed, falling back to the web player, without breaking ordinary link
behaviour.

## Requirements

### Requirement: Link target is configurable and defaults to the app
The system SHALL read the link target from configuration, accepting `app` or
`web` case-insensitively and ignoring surrounding space. An unset, empty or
unknown value SHALL mean `app`.

#### Scenario: Unknown value
- **WHEN** the link target is set to an unrecognised value
- **THEN** links behave as `app`

### Requirement: The href is always the web URL
The system SHALL set every artist link's href to the `https` Spotify web URL in
both modes, so hover, copy-link and middle-click use a link that always works.

#### Scenario: Copying a link in app mode
- **WHEN** the owner copies an artist link's address in app mode
- **THEN** the copied value is the web URL, not a `spotify:` URI

### Requirement: App mode tries the app and falls back to the web
In app mode, a plain left click SHALL navigate to the `spotify:artist:<id>` URI
and, if the page has not lost focus within 600ms, SHALL open the web player in
a new tab. Modified clicks (ctrl, cmd, shift, alt, middle) MUST be left to the
browser. The UI MUST NOT claim to detect whether the app is installed.

#### Scenario: App not installed
- **WHEN** nothing takes the `spotify:` URI within 600ms
- **THEN** the web player opens in a new tab

#### Scenario: Ctrl-click
- **WHEN** the owner ctrl-clicks an artist link
- **THEN** the browser handles it as an ordinary link and no app launch is attempted

### Requirement: Web mode is a plain link
In web mode the system SHALL render an ordinary link to the web URL, opening in
a new tab, with no script attached.

#### Scenario: Web mode click
- **WHEN** the link target is `web` and the owner clicks an artist
- **THEN** the web player opens in a new tab
