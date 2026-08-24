import { Container, getContainer } from "@cloudflare/containers";
// Container extends the DurableObject exported by this module, which is distinct from the
// ambient global of the same name. The constructor below has to reference this one.
import type { DurableObject } from "cloudflare:workers";

interface Env {
  COBALT_CONTAINER: DurableObjectNamespace<CobaltContainer>;
  // Public URL of this Worker. Passed into the container as API_URL so cobalt
  // builds tunnel links that point back through this Worker. Set in wrangler.jsonc.
  COBALT_PUBLIC_URL?: string;
  // Optional shared secret. When set, callers must send the same
  // `Authorization: Api-Key <key>` header that speak-server already sends.
  // Set with: wrangler secret put COBALT_API_KEY
  COBALT_API_KEY?: string;
}

/**
 * Runs the cobalt API (Express server on port 9000) as a Cloudflare Container.
 * The container itself is never exposed to the internet directly — all traffic
 * is routed through the Worker `fetch` handler below.
 */
export class CobaltContainer extends Container<Env> {
  // cobalt's Express server listens on 9000 (see the Dockerfile `EXPOSE 9000`).
  defaultPort = 9000;

  // Keep a warm instance for 15 minutes of inactivity, then scale to zero.
  sleepAfter = "15m";

  // Mirrors the base class signature (`ctx: DurableObject['ctx']`) rather than naming
  // DurableObjectState directly, which became generic in @cloudflare/workers-types v5.
  constructor(ctx: DurableObject["ctx"], env: Env) {
    super(ctx, env);
    // Environment handed to the cobalt process at boot.
    this.envVars = {
      API_PORT: "9000",
      // Must equal the PUBLIC Worker URL so returned tunnel URLs are reachable.
      API_URL: env.COBALT_PUBLIC_URL ?? "",

      // cobalt's defaults (20/min api, 40/min tunnel) assume a public instance where many
      // strangers arrive on many IPs. Here every request reaches the container from a single
      // source, so the per-IP limiter degrades into one global bucket shared by all of Speak.
      // At two calls per import (resolve, then the re-resolve in prepareMedia) that capped the
      // whole product at ~10 imports/min; observed peak is 76 calls/min, and rate_exceeded was
      // 71% of every error cobalt returned. The Worker's Api-Key gate below is the real door,
      // so these ceilings only need to bound a runaway retry loop — a high but finite number
      // keeps a bug from hammering the source platforms and getting our egress IP banned.
      RATELIMIT_MAX: "300",
      TUNNEL_RATELIMIT_MAX: "120",
    };
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // `/tunnel` is exempt from the key gate. Those links are signed capability URLs that
    // cobalt mints itself: it HMACs (id, exp, iv, secret) with a server-side key, encrypts
    // the stream record under that secret, and expires the whole thing in ~90s. verifyStream
    // re-checks the HMAC and the expiry on every hit, so the link authenticates itself and
    // cannot be forged. Gating it here was making every `status: tunnel` result impossible to
    // download, because the URL is handed to ffprobe and the S3 upload Lambda and neither of
    // them can send the shared key. Restricted to the methods cobalt actually serves.
    const path = new URL(request.url).pathname.replace(/\/+$/, "");
    const isTunnelRead =
      path === "/tunnel" && (request.method === "GET" || request.method === "HEAD");

    // Auth gate. Mirrors the header speak-server already sends:
    //   Authorization: Api-Key <COBALT_API_KEY>
    if (env.COBALT_API_KEY && !isTunnelRead) {
      const auth = request.headers.get("authorization");
      if (auth !== `Api-Key ${env.COBALT_API_KEY}`) {
        return Response.json(
          { status: "error", error: { code: "error.api.auth.key.invalid" } },
          { status: 401 },
        );
      }
    }

    // Forward every path/method/body to the cobalt container, including
    // POST `/` (resolve) and GET `/tunnel` (media streaming).
    const container = getContainer(env.COBALT_CONTAINER);
    return container.fetch(request);
  },
} satisfies ExportedHandler<Env>;
