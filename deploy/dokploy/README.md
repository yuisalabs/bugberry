# BugBerry on Dokploy

`docker-compose.yml` and `template.toml` here run BugBerry on a Dokploy server from the published images: the api,
MCP for AI agents, the dashboard and Postgres. `meta.json` is the entry Dokploy's template list needs.

## Deploy

Until BugBerry is in Dokploy's template list, create the service by hand:

1. In Dokploy: a project → **Create Service** → **Compose**, and paste `docker-compose.yml` as its compose file.
2. **Environment**: paste the `[config.env]` lines of `template.toml` as `KEY=value` lines, and fill in
   `POSTGRES_PASSWORD` and `BETTER_AUTH_SECRET` (`openssl rand -base64 32` each) and `ENCRYPTION_KEY`
   (`openssl rand -base64 32`, exactly this shape). Set `APP_URL` to `https://` and the domain of step 3.
3. **Domains**: add one on service `client`, port 80, with HTTPS.
4. Fill in one sign-in method. Email codes over SMTP are the simplest: `EMAIL_FROM` (such as
   `BugBerry <no-reply@example.com>`), `SMTP_HOST`, `SMTP_USER`, `SMTP_PASSWORD`. Google, GitHub, GitLab and OIDC are
   optional; the redirect address for each is `<APP_URL>/api/auth/callback/<name>`.
5. **Deploy.** The api runs the database migrations on its first start.

Once the template is listed, **Templates** → BugBerry does steps 1 to 3 itself: it generates the domain, the
passwords and `ENCRYPTION_KEY` (`${base64:32}` is base64 of 32 bytes), and leaves the sign-in fields to fill in.

If the api keeps restarting, open its logs: it names the missing setting, such as `EMAIL_FROM is required` when
`EMAIL_DRIVER` is `smtp` and the SMTP fields are empty, or "Enable at least one sign-in method" when none is on.
To sign in only with Google, GitHub, GitLab or OIDC, set `EMAIL_DRIVER` to empty.

**HTTPS.** `APP_URL` must start with the scheme the domain is served on. Dokploy's generated `traefik.me` domains are
plain http: for Google sign-in and the extension, use a domain of your own with HTTPS turned on, and keep `APP_URL`
at `https://` and that domain.

**Isolated deployments.** The services are called `api`, `client` and `postgres`. Turn on **Isolated Deployment**
for this compose service, so the dashboard never reaches another stack's `api` on Dokploy's shared network.

## Data

The database is in the volume `bugberry-pgdata`, uploads in `bugberry-uploads`. Redeploying keeps both. S3, R2 or MinIO instead of the volume: `STORAGE_DRIVER=s3` and the `S3_*` values. Don't change
`ENCRYPTION_KEY` after the first deploy: integration tokens saved with it can't be read with another.

## Pin a Version, Upgrade

The images are pinned to a release (`0.14.1`). To upgrade, change the three `image:` tags and redeploy.

## For the Owner: the Pull Request to Dokploy

- Copy this folder to `blueprints/bugberry/` in `Dokploy/templates`; `bugberry.svg` is its logo (it wraps the
  192 px WebP icon; swap in a drawn vector if one is made).
- Run `node build-scripts/generate-meta.js --check` there.
- Title: `feat: add BugBerry template`
- Description:

  > BugBerry records bug reports in the browser: a screenshot or video with the console, network requests and the
  > steps, for the team's dashboard, trackers and AI agents (MCP). The template runs the api, the MCP server, the
  > dashboard (nginx) and Postgres from the images on GHCR. It generates the domain, the database password, the auth
  > secret and the encryption key (`${base64:32}`, 32 bytes as the server requires). One sign-in method has to be
  > filled in; the SMTP fields are listed first.
- The pull request's preview gives a Base64 import string; paste it into a Dokploy instance (Compose service →
  Advanced → Import) to try the listed version before it merges.
