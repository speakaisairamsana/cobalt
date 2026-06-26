import { Container, getContainer } from "@cloudflare/containers";

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

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    // Environment handed to the cobalt process at boot.
    this.envVars = {
      API_PORT: "9000",
      // Must equal the PUBLIC Worker URL so returned tunnel URLs are reachable.
      API_URL: env.COBALT_PUBLIC_URL ?? "",
    };
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // Optional auth gate. Mirrors the header speak-server already sends:
    //   Authorization: Api-Key <COBALT_API_KEY>
    // No change needed in speak-server beyond pointing COBALT_API_URL here.
    if (env.COBALT_API_KEY) {
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
