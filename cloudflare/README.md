# Deploying cobalt on Cloudflare Containers

This folder deploys the **cobalt API** to [Cloudflare Containers](https://developers.cloudflare.com/containers/).
Cobalt cannot run on plain Workers — it needs a real Node runtime, the native
`ffmpeg-static` binary, and long-lived media streaming (tunnels). Containers run
the existing `Dockerfile` (at the repo root) on Cloudflare's network, fronted by
a thin Worker that handles routing and auth.

```
speak-server ──POST /──► Worker (auth gate) ──► Container (cobalt :9000)
  COBALT_API_URL                                 built from ../Dockerfile
```

## Deploy options

- **GitHub Actions (recommended, no local Docker)** — `.github/workflows/deploy-cobalt-cloudflare.yml`
  builds the image and deploys on every push to `feat/cloudflare-containers-deploy`. See
  [GitHub Actions deploy](#github-actions-deploy-recommended) below. Cloudflare's
  native "Workers Builds" Git integration does **not** reliably build container
  images, which is why we use Actions (the runner has Docker).
- **Local** — run `wrangler deploy` yourself; needs Docker running locally. See
  [Manual / local deploy](#manual--local-deploy).

## GitHub Actions deploy (recommended)

The workflow runs `wrangler deploy` on an `ubuntu-latest` runner (Docker is
preinstalled), which builds `../Dockerfile`, pushes the image to Cloudflare's
registry, and deploys the Worker + container.

**One-time setup:**

1. Create a Cloudflare API token: dashboard → **My Profile → API Tokens →
   Create Token → "Edit Cloudflare Workers"** template. If the container image
   push fails on permissions, edit the token and add **Account → Containers → Edit**
   (and **Account → Workers Scripts → Edit**).
2. Find your **Account ID**: dashboard → Workers & Pages → right sidebar.
3. Add both as GitHub repo secrets (repo → **Settings → Secrets and variables →
   Actions → New repository secret**):
   - `CLOUDFLARE_API_TOKEN`
   - `CLOUDFLARE_ACCOUNT_ID`
4. (Optional auth gate) After the first deploy, set the API key as a Worker
   secret so the endpoint isn't open — see [Configure](#configure).
5. Push to the branch (or run the workflow manually from the **Actions** tab).
   The first container build takes a few minutes.

After the first successful deploy, grab the `*.workers.dev` URL from the run
logs (or the dashboard), set `COBALT_PUBLIC_URL` in `wrangler.jsonc`, and push
again so cobalt's tunnel links resolve. Then wire speak-server
([Point speak-server at it](#point-speak-server-at-it)).

## Manual / local deploy

### Prerequisites

- A Cloudflare account with **Containers** enabled (Workers Paid plan).
- [Docker](https://www.docker.com/) running locally — Wrangler uses it to build the image.
- Node 20+.

## One-time setup

```bash
cd cloudflare
npm install          # installs wrangler + @cloudflare/containers
npx wrangler login
```

If `npm install` resolves an old `@cloudflare/containers`, force latest:

```bash
npm install -D @cloudflare/containers@latest wrangler@latest
```

## Configure

1. **Auth key** (optional but recommended — keeps the endpoint private). Use the
   same value as `COBALT_API_KEY` in speak-server:

   ```bash
   npx wrangler secret put COBALT_API_KEY
   ```

   The Worker then requires `Authorization: Api-Key <key>` — exactly the header
   speak-server already sends. No speak-server code change needed.

2. **Public URL** — cobalt builds tunnel links from `API_URL`, so it must equal
   this Worker's public URL. Deploy once to learn the URL, set it in
   `wrangler.jsonc` → `vars.COBALT_PUBLIC_URL` (keep the trailing slash), then
   deploy again.

## Deploy

```bash
npx wrangler deploy
```

Wrangler builds the image from `../Dockerfile`, pushes it to Cloudflare's
registry, and provisions the container. First build takes a few minutes.

## Point speak-server at it

In speak-server's environment:

```bash
COBALT_API_URL=https://speak-cobalt.<your-subdomain>.workers.dev/
COBALT_API_KEY=<same value you set above>   # only if you set the secret
```

That's the only change — `src/@speak-integrations/helper/cobalt/index.ts` works unchanged.

## Operate

```bash
npx wrangler tail        # live logs
```

- **Instance size**: `instance_type` in `wrangler.jsonc` (`dev` / `basic` / `standard`).
  `standard` ≈ 4 GiB / 0.5 vCPU. Drop to `basic` (1 GiB) to cut cost.
- **Scaling**: `max_instances` caps concurrent containers. Idle instances sleep
  after 15m (`sleepAfter` in `src/index.ts`) and scale to zero.

## Cost note

In `tunnel` mode, downloaded media streams **through** the container — that's
billable bandwidth + container-seconds. Where the source allows it, cobalt's
`redirect` responses avoid proxying bytes. For heavy media throughput, compare
against the existing ECS/Fargate setup before fully cutting over.
