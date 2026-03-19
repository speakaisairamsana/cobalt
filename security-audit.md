# Security Audit Results: Cobalt

**Cobalt** is a media downloader (YouTube, TikTok, Instagram, etc.) with a Node.js/Express API and Svelte frontend.

---

## Verdict: Safe to self-host, with a few hardening steps

The codebase demonstrates solid security practices overall. No critical vulnerabilities that would block deployment.

---

## What's done well

| Area | Details |
|------|---------|
| **Input validation** | Zod schema validation on all API requests; URL whitelisting against known services |
| **No dangerous functions** | No `eval()`, `exec()`, or shell injection vectors; FFmpeg uses `spawn()` with array args |
| **Rate limiting** | 3-tier rate limiting (session, API, tunnel) with HMAC-based IP hashing |
| **Authentication** | JWT (HMAC-SHA256, IP-bound) + API keys + Cloudflare Turnstile support |
| **Docker security** | Runs as non-root `node` user, multi-stage build, production-only deps |
| **No database** | No SQL injection risk — uses external APIs + optional Redis |
| **Stream signing** | Cryptographic HMAC signatures on all stream/tunnel URLs with expiry |
| **Request size limit** | 1024 byte JSON body limit prevents payload DoS |
| **Secret masking** | Env vars containing "secret"/"apikey" masked in logs |
| **Path traversal** | No user input in file paths; filenames sanitized with character replacement |

---

## Items to address before production

### Medium priority

1. **SSRF via redirects** — `maxRedirections: 16` is high. An open redirect on a whitelisted service could chain to internal resources. Consider lowering to 5.

2. **CORS defaults to wildcard** — Set `CORS_WILDCARD=0` and `CORS_URL` to your frontend domain.

3. **No TLS at app level** — The app listens on plain HTTP (port 9000). You **must** put it behind a reverse proxy (nginx/Caddy) with TLS termination.

4. **No security headers** — Add HSTS, CSP, X-Frame-Options, X-Content-Type-Options at your reverse proxy.

5. **Cookies stored in plaintext** — `cookies.json` (for service auth) is unencrypted on disk. Restrict file permissions (`chmod 600`).

6. **Remote API key fetch** — If using `API_KEY_URL` with an HTTP endpoint, there's no timeout or certificate pinning on the fetch.

### Low priority

7. **JWT uses partial IP hash** (first 32 bits for IPv4) — acceptable for most deployments.

8. **No access logging** — Add request logging at the reverse proxy for audit trails.

9. **Empty catch blocks** in some error handlers silently swallow errors.

---

## Recommended deployment checklist

- [ ] Use a reverse proxy (nginx/Caddy) with TLS
- [ ] Set `CORS_WILDCARD=0` and `CORS_URL=https://your-domain.com`
- [ ] Set a strong `JWT_SECRET` (16+ chars, use the built-in generator)
- [ ] Set `API_AUTH_REQUIRED=1` if you want private access
- [ ] Configure API keys if restricting access
- [ ] Set `RATELIMIT_MAX` appropriately for your usage
- [ ] `chmod 600 cookies.json` if using service cookies
- [ ] Run behind a firewall — only expose ports 80/443
- [ ] Keep Docker image updated (watchtower or manual pulls)
- [ ] Run `npm audit` periodically on dependencies

---

**Bottom line:** The codebase is well-engineered with security in mind. It's safe to self-host as long as you put it behind a TLS-terminating reverse proxy and configure the auth/CORS settings for your use case.
