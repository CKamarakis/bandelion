# Spec Delta

## Purpose

Connects one Spotify account to the instance with read-only scopes, keeps its
tokens encrypted at rest, and lets the owner disconnect without losing the
imported roster.

## ADDED Requirements

### Requirement: Authorization uses PKCE with a CSRF state
The system SHALL start the Spotify authorization-code flow with an S256 PKCE
challenge and a random state, both held in httpOnly SameSite=Lax cookies that
expire within ten minutes. The PKCE verifier MUST NOT appear in any URL.

#### Scenario: Login redirects to Spotify
- **WHEN** the owner starts a login
- **THEN** the response redirects to Spotify's authorize endpoint carrying the configured client id, redirect URI, an S256 challenge and a fresh state
- **AND** the state and verifier are set as httpOnly cookies and the verifier is absent from the redirect URL

#### Scenario: Loopback redirect URIs get no Secure flag
- **WHEN** the configured redirect URI is plain http on a loopback address
- **THEN** the OAuth cookies are set without the Secure flag, so the browser does not silently drop them

#### Scenario: Missing credentials is a setup error
- **WHEN** a login starts and the client id or secret is not configured
- **THEN** the response is a 500 that names the settings to fill in, and no redirect happens

### Requirement: Only read-only scopes are requested
The system SHALL request exactly `user-follow-read`, `user-top-read` and
`user-library-read`, and MUST NOT request any scope that modifies a Spotify
account.

#### Scenario: Scope list is fixed
- **WHEN** the authorize URL is built
- **THEN** it requests exactly those three scopes and forces the consent dialog

### Requirement: The callback exchanges the code once and clears the flow cookies
The system SHALL exchange the authorization code exactly once, sending the
verifier from the cookie, and SHALL clear the state and verifier cookies on
every callback outcome. A state mismatch or a cancelled sign-in MUST NOT store
tokens.

#### Scenario: Successful callback
- **WHEN** Spotify returns a code with a state matching the cookie
- **THEN** the code is exchanged once, the grant and its scope are stored, and the flow cookies are cleared

#### Scenario: Rejected callback
- **WHEN** the state does not match or the user cancelled
- **THEN** no tokens are stored and the flow cookies are cleared

### Requirement: Login works from a popup, with a redirect fallback
The system SHALL support a popup flow in which the callback returns a page that
reports the outcome to its opener and closes itself, and SHALL fall back to a
full-page redirect when the flow was not started as a popup.

#### Scenario: Popup success
- **WHEN** a popup-started flow completes
- **THEN** the callback returns a page that reports success to the opener and closes the window

#### Scenario: Popup failure
- **WHEN** a popup-started flow is cancelled
- **THEN** the page reports not-ok with the reason to the opener, and the state and popup cookies are cleared

### Requirement: Tokens are encrypted at rest
The system SHALL store access and refresh tokens only as AES-256-GCM
ciphertext in a versioned format, using a 32-byte key from configuration. The
database file MUST NOT contain a plaintext token.

#### Scenario: No plaintext in the database file
- **WHEN** a grant is stored
- **THEN** neither token appears in plaintext anywhere in the database file

#### Scenario: Tampered or wrongly keyed ciphertext fails loudly
- **WHEN** a stored token is altered or decrypted with a different key
- **THEN** decryption fails with an error, never a garbage token

#### Scenario: A malformed key is rejected
- **WHEN** the configured key is missing, not hex, or not 64 characters
- **THEN** startup of any token operation fails with a message saying how to generate one

### Requirement: Access tokens refresh before they expire
The system SHALL treat a token as expired within 60 seconds of its expiry, or
when the expiry is missing or unparseable, and SHALL refresh it before use. A
refresh that omits a new refresh token MUST keep the existing one.

#### Scenario: Near-expiry token is refreshed
- **WHEN** a caller needs a token that expires in under a minute
- **THEN** it is refreshed and the new token is stored encrypted

### Requirement: Disconnect removes tokens and keeps the roster
The system SHALL disconnect by deleting stored tokens on a POST request only,
and MUST leave imported artists and their resolutions in place.

#### Scenario: Disconnect
- **WHEN** the owner disconnects
- **THEN** the status reports not connected and the roster is unchanged
