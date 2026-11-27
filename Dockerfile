# Bandelion: `docker compose up` is the artifact. See docker-compose.yml.
#
# Node 24 because it is the version `npm run verify` passes on, and node:sqlite
# needs no flag there. No build toolchain: SQLite is node:sqlite, not a native
# module (decision 012), so the slim image is enough.
FROM node:24-slim

# Self-hosted means nobody else's analytics.
ENV NEXT_TELEMETRY_DISABLED=1

# Everything runs as the unprivileged `node` user, including the build, so the
# .next output and the data directory are owned by the user that writes them.
WORKDIR /app
RUN chown node:node /app
USER node

# Dependencies first, so a source change does not reinstall them. Dev
# dependencies stay: the build needs TypeScript, and whether `next start` does
# too is unverified (design, open question).
COPY --chown=node:node package.json package-lock.json ./
RUN npm ci

# The whole source, not only the build output: ingest and seed run src/ and
# tests/ directly under --experimental-strip-types.
COPY --chown=node:node . .
RUN npm run build

# Created here so a fresh named volume mounted on it inherits node's ownership.
RUN mkdir -p /app/data

ENV NODE_ENV=production
EXPOSE 3000

# All interfaces inside the container, or the published port reaches nothing.
# Compose publishes it on the host's loopback only.
CMD ["node_modules/.bin/next", "start", "-H", "0.0.0.0", "-p", "3000"]
