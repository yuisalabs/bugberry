# BugBerry on Coolify

`docker-compose.yml` here runs BugBerry on a Coolify server from the published images: the api, MCP for AI agents,
the dashboard and Postgres, behind Coolify's own proxy.

## Deploy

1. In Coolify: **New Resource** → **Docker Compose Empty**, and paste `docker-compose.yml`.
2. Give the `client` service a domain (Coolify suggests one from your wildcard domain). That address is BugBerry's
   `APP_URL`; the extension and the sign-in providers use it.
3. Fill in the fields Coolify marks as required. BugBerry needs one way to sign in; email codes over SMTP are the
   simplest:
   - `EMAIL_FROM`: the sender, such as `BugBerry <no-reply@example.com>`;
   - `SMTP_HOST`, `SMTP_USER`, `SMTP_PASSWORD`; `SMTP_PORT` defaults to 587, `SMTP_SECURE` to `false`.
4. Optional: `GOOGLE_CLIENT_ID`/`_SECRET`, `GITHUB_…`, `GITLAB_…`, or `OIDC_ISSUER`, `OIDC_CLIENT_ID`,
   `OIDC_CLIENT_SECRET` for company sign-in. The redirect address for each is `<APP_URL>/api/auth/callback/<name>`.
   `ALLOWED_EMAIL_DOMAINS` limits sign-up to your company's domains.
5. **Deploy.** The four containers turn healthy in about a minute; the api runs the database migrations on its first
   start.

Coolify generates the database password, `BETTER_AUTH_SECRET` and `ENCRYPTION_KEY` once and keeps them across
deploys. Don't change `ENCRYPTION_KEY` afterwards: integration tokens saved with it can't be read with another.

If the api keeps restarting, open its logs: it names the setting it is missing, such as `EMAIL_FROM is required`.

The SMTP fields are required here, so every install can sign in by email. To offer only Google, GitHub, GitLab or
OIDC, clear `EMAIL_DRIVER` and remove the four `${…:?}` SMTP lines from the compose file before deploying.

Coolify without a wildcard domain gives an `http://…sslip.io` address. Google sign-in and the extension need
https: give `client` a domain of your own with a certificate.

## Data

The database is in the volume `bugberry-pgdata`, uploads in `bugberry-uploads`. **Redeploy** and upgrades keep both.
Back them up as [Operations](https://bugberry.yuisalabs.com/docs/self-host/operations) describes; S3 storage instead of
the volume is `STORAGE_DRIVER=s3` with the `S3_*` variables, as in a Docker Compose install
(see [Storage](https://bugberry.yuisalabs.com/docs/self-host/storage)).

## Pin a Version, Upgrade

The images are pinned to a release (`0.14.1`). To upgrade, change the three `image:` tags to the new release and
redeploy. `latest` follows every release.

## For the Owner: the Pull Request to Coolify

Coolify lists services from its own repository. As of November 2026 Coolify has paused outside template contributions,
and it lists only services with at least 1,000 GitHub stars. When both allow it:

- Copy `docker-compose.yml` to `templates/compose/bugberry.yaml` in `coollabsio/coolify`, and `bugberry.svg` to
  `svgs/bugberry.svg`. It wraps the 192 px WebP icon; swap in a drawn vector if one is made.
- Add the docs page Coolify asks for, `content/docs/services/bugberry.mdx`, in its documentation repository.
- Title: `feat(service): add BugBerry`
- Description:

  > BugBerry records bug reports in the browser: a screenshot or video with the console, network requests and the
  > steps, sent to the team's dashboard, trackers and AI agents (MCP). This template runs the api, the MCP server,
  > the dashboard (nginx) and Postgres from the published images on GHCR. Email (SMTP) is required as the sign-in
  > method; Google, GitHub, GitLab and OIDC are optional. Secrets are generated with SERVICE_PASSWORD_* and
  > SERVICE_REALBASE64_32_*. Tested with Docker Compose Empty on Coolify <version>.
