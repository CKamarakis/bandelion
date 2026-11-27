# Spec Delta

## Purpose

Defines what `docker compose up` guarantees for a self-hosted instance: the app
serves on the host, its database survives rebuilds, and ingest runs inside the
same container.

## ADDED Requirements

### Requirement: One command starts the app
The repository SHALL contain a `Dockerfile` and a `docker-compose.yml` such
that `docker compose up` on a machine with Docker and a filled-in `.env` builds
the app and serves it on port 3000 of the host.

#### Scenario: Fresh clone
- **WHEN** someone clones the repo, copies `.env.example` to `.env`, fills it in, and runs `docker compose up`
- **THEN** the home page answers on `http://127.0.0.1:3000` with the app's own markup

### Requirement: The app is reachable only from the host by default
The compose file SHALL publish the app's port on the host's loopback interface
only. The app has no login of its own, so it MUST NOT be reachable from other
machines unless the owner changes that deliberately.

#### Scenario: Another machine on the network
- **WHEN** a second machine on the same network requests port 3000 of the host
- **THEN** the connection is refused

#### Scenario: Spotify redirect on the host
- **WHEN** the owner signs in with the default redirect URI `http://127.0.0.1:3000/api/auth/callback/spotify`
- **THEN** the callback reaches the containerised app and the grant is stored

### Requirement: The database survives a rebuild
The system SHALL keep its SQLite database on a named volume, so that stopping,
rebuilding or recreating the container does not lose the roster, releases,
flags or tokens.

#### Scenario: Rebuild after an update
- **WHEN** the owner runs `docker compose down`, pulls new code, and runs `docker compose up --build`
- **THEN** the feed shows the same releases and the account is still connected

### Requirement: Ingest runs inside the container
Every ingest job SHALL be runnable inside the running container against the
same database the app serves, using the documented npm scripts.

#### Scenario: Importing the roster from the container
- **WHEN** the owner runs `docker compose exec web npm run ingest` while the app is up
- **THEN** the job writes to the database the app reads, and the UI stays usable while it runs

### Requirement: Every push is verified
The repository SHALL run the full build and test suite on every push and pull
request, and SHALL build the container image and check that it serves the
feed. No CI step may call a live third-party API.

#### Scenario: A change breaks a suite
- **WHEN** a pull request makes any suite fail
- **THEN** the CI run for that pull request fails and names the suite

#### Scenario: A change breaks the image
- **WHEN** a pull request leaves the image unable to build or to serve the feed
- **THEN** the CI run fails
