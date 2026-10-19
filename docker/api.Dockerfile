# syntax=docker/dockerfile:1
# BugBerry API. Build from the repo root: docker build -f docker/api.Dockerfile .
ARG BUN_VERSION=1.4.1

FROM oven/bun:${BUN_VERSION}-slim AS base
WORKDIR /app

# Every workspace manifest, so --frozen-lockfile accepts the workspace set; dependency layers stay
# cached until a package.json or the lockfile changes.
FROM base AS manifests
COPY package.json bun.lock ./
COPY apps/api/package.json apps/api/
COPY apps/client/package.json apps/client/
COPY apps/extension/package.json apps/extension/
COPY packages/shared/package.json packages/shared/
COPY packages/capture/package.json packages/capture/
COPY packages/player/package.json packages/player/
COPY packages/ui/package.json packages/ui/

# Runs the server from source with production dependencies; migrations ship next to it. The dashboard
# lives in the client image (nginx), not here.
FROM manifests AS runtime
ENV NODE_ENV=production
RUN bun install --frozen-lockfile --production --ignore-scripts --filter @bugberry/api
COPY packages/shared packages/shared
COPY apps/api/drizzle apps/api/drizzle
COPY apps/api/geo apps/api/geo
COPY apps/api/scripts apps/api/scripts
COPY apps/api/src apps/api/src
RUN mkdir -p /data/uploads && chown -R bun:bun /data
USER bun
ENV PORT=3000 LOCAL_STORAGE_DIR=/data/uploads
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["bun", "-e", "fetch(`http://127.0.0.1:${process.env.PORT ?? 3000}/api/health`).then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
CMD ["bun", "apps/api/src/index.ts"]
