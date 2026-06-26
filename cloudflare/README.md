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

## Prerequisites

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
