# BugBerry (previously fdebag)

A bug-reporting tool: a Chrome extension that captures a screenshot or video together with the console, network and reproduction steps, plus a dashboard and share links.

Design: `docs/superpowers/specs/2026-10-15-fdebag-design.md`

## Development

Requires Bun 1.4+ and Docker.

```bash
bun install
bun run dev:db
cp apps/api/.env.example apps/api/.env
```

`bun run dev:db` starts Postgres (port 54329) and RustFS as a local S3-compatible storage (port 9000, console on port 9001, login `fdebag` / `fdebag-secret`, buckets `fdebag` and `fdebag-test`). The `fdebag` bucket already has CORS rules for `http://localhost:5173` and `http://localhost:3000` (`deploy/bucket-cors.dev.json`), because the dashboard reads debugger data straight from storage. To use it from the dev server, set `STORAGE_DRIVER=s3`, `S3_ENDPOINT=http://localhost:9000`, `S3_REGION=us-east-1`, `S3_BUCKET=fdebag`, `S3_ACCESS_KEY_ID=fdebag`, and `S3_SECRET_ACCESS_KEY=fdebag-secret` in `apps/api/.env`.

### Dashboard with hot reload

The dashboard (Vite, port 5173) proxies `/api` to the server (port 3000), so the browser only sees one origin. In `apps/api/.env`, set `APP_URL=http://localhost:5173`, then create a Google OAuth client of type "Web application" with the redirect URI `http://localhost:5173/api/auth/callback/google` and set `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`. Also set `ENCRYPTION_KEY` (see [Tracker integrations](#tracker-integrations)).

```bash
cd apps/api && bun run dev
```

```bash
cd apps/client && bun run dev
```

Open http://localhost:5173. `/` is the BugBerry landing page; the dashboard lives at `/app` (old `/r/…`, `/p/…`, and `/settings/…` links are redirected to `/app/…`). To mimic production (nginx + api), use `docker compose` as described in [Deploy](#deploy-vps--docker).

### Chrome extension

The extension uses the dashboard sign-in: there are no tokens. If you are already signed in to the dashboard in the same Chrome, the extension can send reports right away; if not, its popup offers "Sign in", which opens the dashboard's sign-in page. Signing out of the dashboard signs the extension out too.

Build the extension with its default server address (for development, the Vite dashboard that proxies `/api`):

```bash
cd apps/extension && VITE_SERVER_ORIGIN=http://localhost:5173 bun run build
```

Load `apps/extension/.output/chrome-mv3` through `chrome://extensions` → "Load unpacked". Without `VITE_SERVER_ORIGIN`, the extension asks for the server address on its settings page the first time you use it.

The same extension can be used with other BugBerry servers (for example one you host yourself): open that server's dashboard and click "Use the extension with this server" in the sidebar, then confirm on the page the extension opens. You can also go through the extension's settings page → "Change server".

### Screenshots and recordings

Click the BugBerry icon (or press Ctrl+Shift+K, ⌘⇧K on a Mac). **Capture screenshot** takes the visible area, or lets you drag a box with **Select area** (Esc cancels). **Record** records this tab, a screen or a window; the arrow next to each row holds the choices, and the popup remembers them for next time and for the shortcuts (Alt+Shift+C screenshot, Alt+Shift+R record, Alt+Shift+S stop).

A tab recording includes the tab's sound. Turn on **Microphone** to add your voice (Chrome asks for permission once), and **System audio** to add sound from other apps when recording a screen. A screen or window recording takes the console, network and actions from the tab you started it on; started from a page that isn't a web page (a new tab, `chrome://…`), it has none.

Recording starts after a 3-second countdown (Esc cancels; turn it off in the popup). While it runs, a **Recording Bar** sits on the page; drag it by its left edge and it stays there next time, even after the page reloads. It shows the time and how many errors and failed requests were caught so far, and has:

- **Pause**: nothing is recorded meanwhile, not the video and not the console, network or actions, so you can type private data;
- **Microphone** on or off;
- **Draw**: pen, arrow and circle marks that fade after 3 seconds, and numbered **notes** that stay and go into the report with their time in the video;
- **Restart** and **Discard**, each after a confirmation;
- **Stop**, which also works with a click on the BugBerry icon, Ctrl+Shift+K (⌘⇧K), Alt+Shift+S or Chrome's "Stop sharing".

A "REC" badge shows while recording. A recording also stops by itself after 20 minutes of recording time, before it would pass the server's `MAX_UPLOAD_MB` (300 by default), or when the recorded tab is closed. Recording continues if the tab navigates to another page; the report then notes that the console, network, and actions from the earlier page are not included.

After a screenshot or a recording, **Review your report** opens over the page (or in a tab of its own on pages extensions can't reach, like a new tab or a PDF). It shows the video or the screenshot with its annotation tools, the errors, failed requests and steps that were caught, and a title suggested from the first failed request or error. **Create report** sends it; **Record again** or **Retake** starts over; closing it keeps the report under "Unsent drafts" in the popup's menu.

In the dashboard, click an event's time (or a note's, in the Info tab) to jump the video to that moment; notes and pauses are marked on the video's timeline. While the video plays, the nearest event before the playback position is highlighted and the list scrolls along.

### Tests

Requires `bun run dev:db`:

```bash
bun run test
```

Playwright smoke test (build the E2E-only dashboard and extension first):

```bash
bun run build:client && cd apps/extension && bun run build:e2e && npx playwright test
```

## Sign-in methods

The BugBerry sign-in page shows only the methods that are configured. All are optional, but at least one must be enabled. Access rules are the same for every method: the email must be verified, and if `ALLOWED_EMAIL_DOMAINS` is set, only those domains can sign in. Without it, anyone can sign up. The same person with the same verified email always lands in the same account, whichever method they use.

- **Google:** OAuth client "Web application", redirect URI `<APP_URL>/api/auth/callback/google`, set `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`.
- **GitHub:** GitHub → Settings → Developer settings → OAuth Apps, callback URL `<APP_URL>/api/auth/callback/github`, set `GITHUB_CLIENT_ID`/`GITHUB_CLIENT_SECRET`. BugBerry requests `read:user user:email` and uses a verified email whose domain is allowed (so a work email added as a secondary email on GitHub still works).
- **GitLab (gitlab.com or self-hosted):** User/Admin → Applications, redirect URI `<APP_URL>/api/auth/callback/gitlab`, scopes `openid email profile read_user`. Set `GITLAB_CLIENT_ID`/`GITLAB_CLIENT_SECRET`, and `GITLAB_URL` (e.g. `https://gitlab.kantor.com`) for self-hosted GitLab.
- **Email + code:** `EMAIL_DRIVER=resend` (set `RESEND_API_KEY`) or `EMAIL_DRIVER=smtp` (set `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_SECURE`), plus `EMAIL_FROM`. The 6-digit code is valid for 10 minutes, with at most 5 attempts and at most 5 codes per address per 10 minutes, and in production it is also limited per IP. Emails outside the allowed domains never receive a code. Without `EMAIL_DRIVER`, the code is printed to the server log during development; in production, email + code is turned off.

**Offboarding:** the "verified" status of an email on GitHub and GitLab does not go away when someone's work mailbox is disabled. A person who once verified their work email on their personal GitHub/GitLab account can still sign in through that button. When someone leaves, delete or demote their account in BugBerry; do not just disable their work email.

## Workspaces and report access

Every report, project, and integration belongs to one **workspace** (a team). Someone who signs up without an invitation automatically gets a workspace of their own and becomes its admin. Joining someone else's workspace always takes an **invitation**: an admin opens **Members** in the sidebar, types an email address, and BugBerry sends an invitation link (valid for 7 days, and only usable by the invited address). One person can be in several workspaces; switch with the picker at the top of the sidebar, or with the **Workspace** option in the extension's editor.

Every report has one of three access levels:

- **Workspace** (default): only members of that workspace.
- **Internal**: anyone signed in with the same email domain as the reporter (for example everyone at `@ptmaju.com`), workspace member or not, through the share link. Not available for free email providers such as Gmail.
- **Public**: anyone with the share link, no sign-in needed.

Only the reporter or a workspace admin can change the access level.

A reporter can tick **Include my city** in the extension's editor. Chrome then asks once for location permission. The extension sends coordinates rounded to about 1 km, and the server turns them into a city name ("Jakarta, Indonesia") with a bundled city list, keeping only that name. The city is shown to workspace members only, never on share links or in tracker issues. City data: [GeoNames](https://www.geonames.org) (CC BY 4.0), built into `apps/api/geo/cities.tsv` by `apps/api/scripts/build-cities.ts`.

## Tracker integrations

Admins can connect each project to GitHub Issues or ActiveCollab under **Projects** in the sidebar → **Integrations**. A report can then be sent from its page, or automatically when a new report that has a project finishes uploading. A report without a project is not sent to a tracker; add it to a project first from its page. Moving a report to a project does not send it automatically, so send it with the "Send to …" button.

- **GitHub:** create a *fine-grained personal access token* with access to the target repo and the **Issues: Read and write** permission.
- **ActiveCollab (self-hosted):** use the API token of an account that can create tasks in the target project. The project ID and task list ID are visible in the ActiveCollab URL.

Tokens are stored encrypted with `ENCRYPTION_KEY` (32 random bytes, base64):

```bash
openssl rand -base64 32
```

If `ENCRYPTION_KEY` is changed, the old tokens can no longer be read: save the token again in each integration.

## Deploy (VPS + Docker)

You need a server with Docker Compose v2, a domain pointing at the server, and a Google OAuth client.

Compose runs two application containers: `client` (nginx: the dashboard, with `/api` forwarded to the api) is the only one that opens a port, `BUGBERRY_PORT` (default 3000, localhost only); `api` (the Bun server) is reachable only from the compose network. The browser, OAuth callbacks, and the extension still see a single origin.

### 1. Configuration

```bash
git clone <repo> fdebag && cd fdebag
cp .env.docker.example .env
```

Fill in `.env`:

- `APP_URL`: the dashboard's public address, for example `https://bugberry.kantor.com`.
- `POSTGRES_PASSWORD`, `BETTER_AUTH_SECRET`, `ENCRYPTION_KEY`: each the output of `openssl rand -base64 32`. Keep `ENCRYPTION_KEY` safe; without it the stored tracker tokens cannot be read. Postgres only reads `POSTGRES_PASSWORD` when the `pgdata` volume is first created, so do not change it afterwards.
- `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`: a Google OAuth client of type "Web application" with the redirect URI `<APP_URL>/api/auth/callback/google`.
- `ALLOWED_EMAIL_DOMAINS` (optional): leave it empty so anyone can sign up. For a company server, set it to the company domain (for example `kantor.com`) so only that domain can sign in. New employees still need an invitation to the company workspace; without one they get an empty workspace of their own.
- `EXTENSION_ID`: see [The extension for your team](#4-the-extension-for-your-team).

### 2. Storage

- **Local (default):** `STORAGE_DRIVER=local`. Files are kept in the `uploads` Docker volume.
- **Cloudflare R2 / AWS S3 / MinIO:** `STORAGE_DRIVER=s3` and fill in the `S3_*` variables. For R2: `S3_ENDPOINT=https://<account_id>.r2.cloudflarestorage.com`, `S3_REGION=auto`. For older MinIO that does not support virtual-hosted style, leave `S3_VIRTUAL_HOSTED_STYLE=false`.
- **S3 on the same server:** `docker compose --profile s3 up -d` runs RustFS (S3-compatible) and creates the `S3_BUCKET` bucket. Browsers fetch media straight from storage, so `S3_ENDPOINT` must be a public https address: with the `caddy` profile, set `BUGBERRY_S3_DOMAIN` (for example `s3.bugberry.kantor.com`) and `S3_ENDPOINT=https://s3.bugberry.kantor.com`. Also set your own `S3_ACCESS_KEY_ID` and `S3_SECRET_ACCESS_KEY`; RustFS uses them as its admin credentials.

An S3/R2/MinIO bucket needs a CORS rule so the dashboard can read the console/network data and upload profile photos and workspace logos (GET, HEAD and PUT). Replace the origin in `deploy/bucket-cors.json` with your `APP_URL`, then apply it with the AWS CLI (through Docker, using the `S3_*` values from `.env`):

```bash
set -a; . ./.env; set +a
docker run --rm -v "$PWD/deploy:/deploy:ro" \
  -e AWS_ACCESS_KEY_ID="$S3_ACCESS_KEY_ID" -e AWS_SECRET_ACCESS_KEY="$S3_SECRET_ACCESS_KEY" -e AWS_DEFAULT_REGION="${S3_REGION:-auto}" \
  amazon/aws-cli s3api put-bucket-cors --endpoint-url "$S3_ENDPOINT" --bucket "$S3_BUCKET" \
  --cors-configuration file:///deploy/bucket-cors.json
```

In the Cloudflare R2 dashboard (Settings → CORS policy), fill in the `CORSRules` array from that file. The extension does not need CORS: extension pages have their own host permissions.

### 3. Run

With automatic HTTPS from Caddy (ports 80 and 443 must be open; set `BUGBERRY_DOMAIN` and `TRUST_PROXY=true`). Caddy forwards to the `client` container:

```bash
docker compose --profile caddy up -d --build
```

Behind your own reverse proxy, just run `docker compose up -d --build` and point the proxy at `127.0.0.1:<BUGBERRY_PORT>` (default 3000). That port is deliberately open to localhost only; set `BUGBERRY_BIND=0.0.0.0` if you really want to expose it directly. Set `TRUST_PROXY=true` only when Caddy or your own reverse proxy is in front; the nginx in the `client` container is already accounted for automatically, so rate limits still use the real visitor IP. The server runs database migrations on start.

Check the installation through its front door: the public address when `TRUST_PROXY=true` (Caddy or your own proxy), or `http://localhost:<BUGBERRY_PORT>` when there is no proxy in front. With `TRUST_PROXY=true`, the localhost port bypasses that proxy, so the "forged X-Forwarded-For" check there will fail even though nothing is wrong. That check also uses up the share-link allowance of 60 views per minute for your IP for one minute.

```bash
bash docker/smoke-test.sh https://bugberry.kantor.com
```

API tokens for automation (scripts, bot accounts). The extension does not use tokens; the dashboard also no longer creates or shows them:

```bash
docker compose exec api bun apps/api/scripts/create-token.ts --email bot@kantor.com --name "Bot"
```

### 4. The extension for your team

You need Bun on the computer that builds the extension. From the repo root, run `bun install`, then create the extension key once, so the extension ID is the same on every laptop:

```bash
cd apps/extension
bun run key
```

This creates `apps/extension/bugberry-extension.pem` (ignored by git; an older `fdebag-extension.pem` there is used instead when it is the only one) and prints `VITE_EXTENSION_KEY` and `EXTENSION_ID`. Keep a copy of the `.pem` file somewhere safe; running `bun run key` again with that file prints the same values. Set `EXTENSION_ID` in the server's `.env` (used for CORS).

Then create `apps/extension/.env.production` (neither value is secret, so it can be committed):

```
VITE_SERVER_ORIGIN=https://bugberry.kantor.com
VITE_EXTENSION_KEY=<value from bun run key>
```

and build the zip from the `apps/extension` folder (the same on Windows, macOS, and Linux):

```bash
bun run zip
```

Share `apps/extension/.output/bugberryextension-<version>-chrome.zip`. Each team member extracts it, opens `chrome://extensions`, turns on Developer mode, then uses "Load unpacked" on the extracted folder. The extension already uses the server address from `VITE_SERVER_ORIGIN`; anyone already signed in to the dashboard can send reports right away.

This version of the extension needs an updated server (reports without a project, and thumbnails). Update the server first, then share the new extension zip. Older extensions can still send to the new server.

For the Chrome Web Store (unlisted/private), build the zip without `VITE_EXTENSION_KEY` (temporarily remove that line from `.env.production`): the Web Store assigns its own ID and may reject a manifest that contains `key`. Set `EXTENSION_ID` to the ID from the Web Store.

### External Postgres

Compose always uses its own Postgres: `DATABASE_URL` in `docker-compose.yml` overrides the value from `.env`. For a managed database, change `DATABASE_URL` in `docker-compose.yml` (without the password), set `POSTGRES_PASSWORD` to that database's password, then remove the `postgres` service along with its `depends_on`.

### Upgrades and backups

```bash
git pull && docker compose up -d --build --remove-orphans
docker image prune -f
```

**Upgrading to workspaces:** existing data is moved into one workspace named after the most common email domain (for example `kantor.com`), and the existing admins become admins of that workspace. Reports that used to be "internal" become the **Workspace** level; public reports stay public. `ADMIN_EMAILS` is no longer used (the server only prints a warning); admins are set per workspace on the Members page. New employees no longer automatically see every report: invite them from the Members page.

**Upgrading to the token-free extension:** this update revokes all existing API tokens, because the dashboard can no longer show or revoke them. Replace the extension zip on the team's laptops at the same time as the server update; old extensions will be rejected (401). Create new tokens for automation with `create-token.ts` as above.

`--remove-orphans` removes the `fdebag` container from the older single-container version (which still holds port 3000); volumes and data are not touched.

New migrations run automatically when the container starts. `docker stop` gives in-flight requests 60 seconds to finish. Data lives in the volumes `fdebag-prod_pgdata` (database) and `fdebag-prod_uploads` (files, for local storage). Back up both:

```bash
docker compose exec -T postgres pg_dump -U fdebag fdebag > fdebag-$(date +%F).sql
docker run --rm -v fdebag-prod_uploads:/data:ro -v "$PWD":/backup alpine tar czf /backup/uploads-$(date +%F).tar.gz -C /data .
```

Restore to a new installation (the database is still empty, before any reports exist):

```bash
docker compose exec -T postgres psql -U fdebag -d fdebag < fdebag-<date>.sql
docker run --rm -v fdebag-prod_uploads:/data -v "$PWD":/backup alpine tar xzf /backup/uploads-<date>.tar.gz -C /data
```
