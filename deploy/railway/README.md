# BugBerry on Railway: the Template Recipe

Railway templates are built in Railway's dashboard, not from a file. This is the recipe for the owner to click the
template together once, publish it, and put its button in the docs. Railway can't run a compose file, and two
services can't share one volume there, so the template has three services instead of four: the api serves MCP too
(`SERVER_ROLE=all`).

## Services

### Postgres

Railway's own Postgres (Add → Database → PostgreSQL). Nothing to change.

### api

| Setting | Value |
| --- | --- |
| Source | Docker image `ghcr.io/yuisalabs/bugberry-api:0.14.1` |
| Volume | mounted at `/data/uploads` |
| Public networking | none (the client is the way in) |
| Health check path | `/api/health` |

| Variable | Value |
| --- | --- |
| `SERVER_ROLE` | `all` |
| `PORT` | `3000` |
| `HOST` | `::` (the private network is IPv6; this answers IPv4 too, so the health check still works) |
| `PROXY_HOPS` | `1` |
| `TRUST_PROXY` | `true` |
| `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` |
| `APP_URL` | `https://${{client.RAILWAY_PUBLIC_DOMAIN}}` |
| `STORAGE_DRIVER` | `local` |
| `LOCAL_STORAGE_DIR` | `/data/uploads` |
| `BETTER_AUTH_SECRET` | `${{secret(64)}}` |
| `ENCRYPTION_KEY` | required template variable, description: "Base64 of 32 random bytes: run `openssl rand -base64 32`" |
| `EMAIL_DRIVER` | `smtp` (template variable; empty to sign in only with Google, GitHub, GitLab or OIDC) |
| `EMAIL_FROM`, `SMTP_HOST`, `SMTP_USER`, `SMTP_PASSWORD` | template variables, needed while `EMAIL_DRIVER` is `smtp` |
| `SMTP_PORT` | `587` |
| `SMTP_SECURE` | `false` |
| `GOOGLE_CLIENT_ID`/`_SECRET`, `GITHUB_…`, `GITLAB_…`, `OIDC_ISSUER`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET`, `ALLOWED_EMAIL_DOMAINS`, `EXTENSION_ID` | optional template variables, empty |

`ENCRYPTION_KEY` is asked for because Railway's `secret()` makes a string of characters, not base64 of exactly 32
bytes, and the server refuses any other shape.

### client

| Setting | Value |
| --- | --- |
| Source | Docker image `ghcr.io/yuisalabs/bugberry-client:0.14.1` |
| Public networking | a Railway domain, target port 80 |
| Health check path | `/` |

| Variable | Value |
| --- | --- |
| `API_UPSTREAM` | `http://${{api.RAILWAY_PRIVATE_DOMAIN}}:3000` |
| `MCP_UPSTREAM` | `http://${{api.RAILWAY_PRIVATE_DOMAIN}}:3000` |
| `NGINX_RESOLVER` | `[fd12::10] valid=10s ipv6=on` |

A variable left empty gets the Docker Compose default (`http://api:3000`), which Railway can't reach, so set all three.

Railway's private network is IPv6, and its DNS server inside a service is `fd12::10` (community answers from Railway
staff; the official docs don't name it). nginx resolves the api's name per request through it, so a redeployed api's
new address is followed.

## Check It Before Publishing

1. Deploy the project from the recipe and fill in SMTP and `ENCRYPTION_KEY`.
2. `bash docker/smoke-test.sh https://<the client's domain>` from a clone of the repository: every check passes.
3. Sign in with an emailed code; send a screenshot and a video with the extension pointed at that address; both open.
4. Redeploy the api: the reports and their files are still there.

If step 2 shows 502s from `/api`, check that the api has `HOST=::`: without it the client can't reach it over
Railway's IPv6 network.

## Publish

Project settings → **Templates** → create a template from this project, mark the required variables, describe it,
and publish. Railway gives a URL such as `https://railway.com/deploy/<code>`; its button goes into
`apps/docs/content/docs/self-host/one-click.mdx` and the README:

```md
[![Deploy on Railway](https://railway.com/button.svg)](https://railway.com/deploy/<code>)
```

## Upgrade

Change both images' tags to the new release and redeploy the api, then the client. The api runs migrations at start.
