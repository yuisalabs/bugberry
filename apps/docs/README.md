# BugBerry docs

The documentation site at https://bugberry.yuisalabs.com/docs: [Fumadocs](https://fumadocs.dev) on Next.js, exported as static files with the base path `/docs`.

This folder is a project of its own, with its own `bun.lock`, outside the repo's Bun workspaces. With Next in the root lockfile, `better-auth` would install it into the api image as an optional peer. Run Bun commands from this folder.

## Writing

Pages are MDX files in `content/docs`; each folder's `meta.json` sets the sidebar order. Link to other pages without the `/docs` prefix (`[Storage](/self-host/storage)`): Next adds it. `bun test` checks that every link points to a page, that every page is listed in its `meta.json`, that the environment reference covers every server variable, and that the colours still match `packages/ui/src/theme.css`.

Extension store links live in `src/lib/store-links.ts`; set them there once the listings are live.

## Running

```bash
bun install
bun run dev
```

Open http://localhost:4000/docs.

```bash
bun test
bun run typecheck
bun run build
```

`bun run build` writes the site to `out/`.

## Deploying on the BugBerry VPS

The site runs as its own container next to the app; the app's images never build it, so self-hosted servers don't carry it. Caddy sends `/docs` to it, so no subdomain is needed.

1. Add the service to `compose.vps.yml` (in `/data/apps/bugberry`):

   ```yaml
   docs:
     build:
       context: .
       dockerfile: docker/docs.Dockerfile
     container_name: bugberry-docs
     restart: unless-stopped
     networks: [proxy]
   ```

2. In the Caddy site block for `bugberry.yuisalabs.com`, send `/docs` to it before the handler for the app:

   ```caddyfile
   @docs path /docs /docs/*
   handle @docs {
   	reverse_proxy bugberry-docs:80
   }
   ```

   Every other path keeps going to `bugberry-client`. Reload Caddy.

3. Build and start it:

   ```bash
   git pull && docker compose up -d --build docs
   ```

4. Check that `https://bugberry.yuisalabs.com/docs` opens the introduction, a page reload on a deeper page (for example `/docs/self-host/install`) still works, and searching finds pages.

To update the docs later, run step 3 again.

To try the image locally:

```bash
docker build -f docker/docs.Dockerfile -t bugberry-docs .
docker run --rm -p 4080:80 bugberry-docs
```

Then open http://localhost:4080/docs.
