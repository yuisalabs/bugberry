# syntax=docker/dockerfile:1
# BugBerry dashboard: the Vite build served by nginx, which also proxies /api to the api service.
# Build from the repo root: docker build -f docker/client.Dockerfile .
ARG BUN_VERSION=1.4.1

FROM oven/bun:${BUN_VERSION}-slim AS manifests
WORKDIR /app
COPY package.json bun.lock ./
COPY apps/api/package.json apps/api/
COPY apps/client/package.json apps/client/
COPY apps/extension/package.json apps/extension/
COPY packages/shared/package.json packages/shared/
COPY packages/capture/package.json packages/capture/
COPY packages/debugger-view/package.json packages/debugger-view/
COPY packages/player/package.json packages/player/
COPY packages/ui/package.json packages/ui/

# Scripts are skipped: the extension's `wxt prepare` is not needed here. apps/api is copied because the
# client imports `type App` from it; type imports are erased, so none of it reaches the bundle.
FROM manifests AS build
RUN bun install --frozen-lockfile --ignore-scripts
COPY tsconfig.base.json ./
COPY packages packages
COPY apps/api apps/api
COPY apps/client apps/client
RUN bun run --cwd apps/client build

FROM nginx:1.30-alpine
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY docker/security-headers.conf /etc/nginx/snippets/security-headers.conf
COPY --from=build /app/apps/client/dist /usr/share/nginx/html
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1/ || exit 1
