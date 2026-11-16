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

If the api keeps restarting, open its logs. "Enable at least one sign-in method" means none is set.

## Data

The database is in the volume `bugberry-pgdata`, uploads in `bugberry-uploads`. Redeploying keeps both. Don't change
`ENCRYPTION_KEY` after the first deploy: integration tokens saved with it can't be read with another.

## Pin a Version, Upgrade

The images are pinned to a release (`0.14.1`). To upgrade, change the three `image:` tags and redeploy.

## For the Owner: the Pull Request to Dokploy

- Copy this folder to `blueprints/bugberry/` in `Dokploy/templates`, with an SVG logo saved as
  `blueprints/bugberry/bugberry.svg` (BugBerry has only WebP logos today).
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
