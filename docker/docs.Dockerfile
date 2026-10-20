# syntax=docker/dockerfile:1
# BugBerry docs: the static Fumadocs export (apps/docs) served by nginx under /docs. Only the BugBerry VPS runs it;
# Caddy there sends /docs to this container (apps/docs/README.md). Build from the repo root:
# docker build -f docker/docs.Dockerfile .
# apps/docs is a project of its own with its own bun.lock, outside the root workspaces: with Next in the root
# lockfile, better-auth would pull it into the api image as an optional peer.
ARG BUN_VERSION=1.4.1

FROM oven/bun:${BUN_VERSION}-slim AS build
WORKDIR /app/apps/docs
COPY apps/docs/package.json apps/docs/bun.lock apps/docs/bunfig.toml ./
RUN bun install --frozen-lockfile
COPY apps/docs ./
RUN bun run build

FROM nginx:1.30-alpine
COPY docker/docs-nginx.conf /etc/nginx/conf.d/default.conf
COPY docker/security-headers.conf /etc/nginx/snippets/security-headers.conf
COPY --from=build /app/apps/docs/out /usr/share/nginx/html/docs
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1/docs/ || exit 1
