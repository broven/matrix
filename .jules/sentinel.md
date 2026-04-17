## 2025-05-22 - Localhost CSRF and Token Leakage
**Vulnerability:** Sensitive loopback-only endpoints (`/api/auth-info`, `/api/local-ip`) were vulnerable to cross-origin access from malicious websites via the browser due to a wildcard CORS policy and lack of origin validation.
**Learning:** Even endpoints restricted to loopback IPs can be accessed by a browser via CSRF or simple cross-origin requests if CORS is not strictly configured. A wildcard CORS policy (`*`) allows any site to read the response if the user visits it while the server is running.
**Prevention:** Use a two-layered defense for sensitive local endpoints:
1. Require a custom non-standard header (e.g., `X-Matrix-Internal: true`) to force a CORS preflight and block simple requests.
2. Explicitly validate the `Origin` header on the server to ensure it matches a trusted local source (localhost, 127.0.0.1, or the app's custom protocol).
