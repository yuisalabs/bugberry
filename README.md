<p align="center">
  <img alt="BugBerry" src="./apps/client/public/assets/bugberry_logo_small.webp" height="64" />
</p>

<p align="center">
  <strong>Bug reports engineers actually want to read.</strong>
</p>

<p align="center">
  A browser extension and a server that turn a bug into a screenshot or video with the console,<br />
  network requests, and reproduction steps already attached, shared with one link.
</p>

<p align="center">
  <a href="https://bugberry.yuisalabs.com">Website</a> ·
  <a href="https://bugberry.yuisalabs.com/docs">Documentation</a> ·
  <a href="https://bugberry.yuisalabs.com/login">Cloud App</a>
</p>

<p align="center">
  <img alt="License: AGPL-3.0" src="https://img.shields.io/badge/license-AGPL--3.0-blue?style=for-the-badge" />
  <img alt="Bun 1.4+" src="https://img.shields.io/badge/Bun-1.4%2B-black?style=for-the-badge&logo=bun" />
</p>

## Why BugBerry

"It doesn't work" is where most bug reports start, and the back-and-forth that follows costs more than the fix. BugBerry captures what developers would ask for, at the moment the bug happens.

- Screenshot or record a tab, a window, or the screen, with your voice if you like
- Console logs, network requests, and the steps that led there, attached automatically
- Passwords, tokens, and cookies in captured requests are redacted, and anything can be blurred in a screenshot
- Share a report with your workspace, your company's email domain, or anyone with the link
- Send reports to GitHub Issues or ActiveCollab, or let AI agents work on them through MCP
- Self-host it for free, or use the hosted app

## What's in a report

| Area | What BugBerry includes |
| --- | --- |
| Capture | Screenshots (visible area or a selection) and recordings with sound, pauses, drawings, and notes |
| Reproduction | Clicks, key presses, and navigation as steps on the video's timeline |
| Technical context | Console messages, network requests, performance, and the files and lines that failed |
| Device | Browser, operating system, screen and window size, and the page |
| Sharing | Workspace-only, company-wide, or public share links per report |
| Collaboration | Workspaces, invitations, comments with mentions, status, priority, and assignee |
| Integrations | GitHub Issues and ActiveCollab, sent by hand or automatically |
| AI agents | An MCP server for Claude, Cursor, VS Code, ChatGPT, and others |
| Deployment | One Docker Compose project, with optional Caddy for HTTPS and RustFS for storage |

## Quick Start

### Self-hosted

You need a server with Docker Compose v2, a domain, and a sign-in method (Google, GitHub, GitLab, or email codes).

```bash
git clone https://github.com/yuisalabs/bugberry.git
cd bugberry
cp .env.docker.example .env
# fill in APP_URL, the secrets, and a sign-in method
docker compose --profile caddy up -d --build
```

- [Quick start](https://bugberry.yuisalabs.com/docs/quick-start)
- [Install, step by step](https://bugberry.yuisalabs.com/docs/self-host/install)
- [Environment variables](https://bugberry.yuisalabs.com/docs/self-host/environment)
- [Troubleshooting](https://bugberry.yuisalabs.com/docs/self-host/troubleshooting)

### Local development

```bash
bun install
bun run dev:db
cp apps/api/.env.example apps/api/.env
```

Fill in `apps/api/.env`, then start the API and the dashboard in two terminals:

```bash
cd apps/api && bun run dev
```

```bash
cd apps/client && bun run dev
```

- API: `http://localhost:3000`
- Dashboard: `http://localhost:5173`
- Docs: `http://localhost:4000/docs` (from `apps/docs`)

See [CONTRIBUTING.md](./CONTRIBUTING.md) for the full workflow, the extension, and the tests.

## Browser extension

BugBerry is coming to the Chrome Web Store and Firefox Add-ons; the same extension connects to any BugBerry server. Until then, or when your company needs its own build, see [The extension for your team](https://bugberry.yuisalabs.com/docs/self-host/extension).

## AI agents (MCP)

Every BugBerry server runs an MCP server at `/api/mcp`. Paste a report link or a number like `BB-123` into Claude Code, Cursor, VS Code, or ChatGPT, and the agent can read the console, network, and failing code, comment, and update the report, with exactly the access its person has. See [AI agents](https://bugberry.yuisalabs.com/docs/guide/ai-agents).

## Monorepo Overview

BugBerry is a Bun monorepo.

| Path | Purpose |
| --- | --- |
| `apps/api` | Bun + Elysia API: sign-in, reports, uploads, tracker integrations, and the MCP server |
| `apps/client` | Vite + React app: the landing page, the dashboard, and share pages |
| `apps/extension` | WXT browser extension for Chrome, Opera, and Firefox |
| `apps/docs` | Fumadocs site served at `/docs` (a project of its own, outside the workspaces) |
| `packages/capture` | Console, network, and action capture that runs in the inspected page |
| `packages/debugger-view` | Turns captured events into the console, network, actions, and info views |
| `packages/player` | The video player used by the dashboard and the extension |
| `packages/shared` | Types and constants shared by the API, the dashboard, and the extension |
| `packages/ui` | The shared React components and theme |

## Contributing

Issues, pull requests, and feedback are welcome. Start with the [contributing guide](./CONTRIBUTING.md).

## License

Copyright (C) 2026 Yuisalabs. Licensed under the [GNU Affero General Public License v3.0 only](./LICENSE) (`AGPL-3.0-only`).

City names come from [GeoNames](https://www.geonames.org) (CC BY 4.0), built into `apps/api/geo/cities.tsv` by `apps/api/scripts/build-cities.ts`.
