# Contributing to BugBerry

Thanks for helping. This guide covers running BugBerry locally, testing it, and sending a change. For running BugBerry on a server, see the [self-host docs](https://bugberry.yuisalabs.com/docs/self-host).

## Requirements

- [Bun](https://bun.sh) 1.4 or newer
- Docker, for Postgres and the local S3 storage
- Chrome, for the extension

## Setup

```bash
bun install
bun run dev:db
cp apps/api/.env.example apps/api/.env
```

`bun run dev:db` starts Postgres on port 54329 and RustFS, a local S3-compatible storage, on port 9000 (console on port 9001, login `fdebag` / `fdebag-secret`, buckets `fdebag` and `fdebag-test`). The `fdebag` bucket already has CORS rules for `http://localhost:5173` and `http://localhost:3000` (`deploy/bucket-cors.dev.json`), because the dashboard reads captured data straight from storage.

To use that storage from the dev server, set these in `apps/api/.env`:

```bash
STORAGE_DRIVER=s3
S3_ENDPOINT=http://localhost:9000
S3_REGION=us-east-1
S3_BUCKET=fdebag
S3_ACCESS_KEY_ID=fdebag
S3_SECRET_ACCESS_KEY=fdebag-secret
```

Without them, files go to `./data/uploads`.

## The API and the dashboard

The dashboard (Vite, port 5173) proxies `/api` to the API (port 3000), so the browser only sees one origin. In `apps/api/.env`:

- set `APP_URL=http://localhost:5173`;
- set `BETTER_AUTH_SECRET` to at least 32 random characters, and `ENCRYPTION_KEY` to the output of `openssl rand -base64 32`;
- for Google sign-in, create an OAuth client of type "Web application" with the redirect URI `http://localhost:5173/api/auth/callback/google`, and set `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`. Without it, sign in with an email: during development, the 6-digit code is printed to the API's log.

Then, in two terminals:

```bash
cd apps/api && bun run dev
```

```bash
cd apps/client && bun run dev
```

Open http://localhost:5173. `/` is the landing page; the dashboard lives at `/app`.

## The extension

Build it with the dev dashboard as its server:

```bash
cd apps/extension && VITE_SERVER_ORIGIN=http://localhost:5173 bun run build
```

Load `apps/extension/.output/chrome-mv3` through `chrome://extensions` → **Load unpacked**. If you're signed in to the dashboard in the same Chrome, the extension can send reports right away. Without `VITE_SERVER_ORIGIN`, it asks for the server address the first time.

For Firefox, `bun run build:firefox`, then open `about:debugging#/runtime/this-firefox` and use **Load Temporary Add-on** on `.output/firefox-mv3/manifest.json` (it's gone when Firefox closes).

## The docs

`apps/docs` is a project of its own, outside the Bun workspaces, with its own `bun.lock`. See [apps/docs/README.md](apps/docs/README.md).

```bash
cd apps/docs
bun install
bun run dev
```

Open http://localhost:4000/docs.

## Tests

The API tests need `bun run dev:db`:

```bash
bun run test
bun run typecheck
```

The Playwright smoke test needs the E2E builds of the dashboard and the extension:

```bash
bun run build:client && cd apps/extension && bun run build:e2e && npx playwright test
```

## Sending a change

1. Create a branch from `main`.
2. Write a test that fails without your change, then make it pass.
3. Run `bun run test` and `bun run typecheck`.
4. Commit with a message that says what changed and why, in the style of the history (`feat(client): …`, `fix(api): …`, `docs: …`).
5. Open a pull request.

Found a security problem? Please don't open a public issue; contact the maintainers privately through GitHub's security advisories instead.

## Releasing the extension (maintainers)

The steps below publish the extension under the BugBerry project's IDs. Self-hosters don't need them.

- **Chrome Web Store:** build the zip without `VITE_EXTENSION_KEY` (the Web Store assigns its own ID and may reject a manifest that contains `key`), with `bun run zip` in `apps/extension`.
- **Firefox Add-ons:** Mozilla signs each version once, so raise `version` in `apps/extension/package.json` first. Get API keys under Developer Hub → Manage API Keys on [addons.mozilla.org](https://addons.mozilla.org), export them in your shell as `WEB_EXT_API_KEY` (the JWT issuer) and `WEB_EXT_API_SECRET` (the JWT secret), never in a committed file, then run `bun run sign:firefox` in `apps/extension`. The Firefox extension ID, `yuisalabs@gmail.com`, must never change.
- **Source code for reviewers:** `bun run zip:sources` makes `apps/extension/.output/bugberry-<version>-review-sources.zip` from the last commit, with build steps in `BUILD.md`, and never includes the `.pem` key or `.env` files. `sign:firefox` uploads it for Mozilla; use the same zip for Opera's moderators. Commit before running it.

## License

By contributing, you agree that your contributions are licensed under the [GNU AGPL v3](LICENSE) (`AGPL-3.0-only`).
