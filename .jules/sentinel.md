## 2026-03-18 - [Restricting Loopback Endpoints]
**Vulnerability:** Information disclosure of sensitive tokens via loopback endpoints (`/api/auth-info`).
**Learning:** Even if an endpoint is restricted to loopback (127.0.0.1), it can be accessed by a browser running on the same machine. If the server has a permissive CORS policy or if the attacker uses a simple GET request, a malicious website can potentially fetch sensitive data from the local server.
**Prevention:**
1. Define sensitive internal endpoints before applying global CORS middleware.
2. Require a custom header (e.g., `X-Matrix-Internal`) that browsers cannot set in cross-origin requests without a preflight (and even then, only if CORS allows it).
3. Use `timingSafeEqual` for token comparisons to prevent timing attacks.
4. Mask sensitive tokens in console logs.
