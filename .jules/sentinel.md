## 2025-05-15 - Localhost CSRF / DNS Rebinding Protection
**Vulnerability:** Malicious websites could use a user's browser to make cross-origin requests to sensitive loopback-only endpoints (e.g., `/api/auth-info`, `/api/local-ip`) and steal the server's authentication token.
**Learning:** Standard IP-based loopback checks are insufficient for browser-based attacks because the browser itself is on the loopback network. DNS Rebinding or simple cross-origin requests (if CORS is permissive) can bypass these checks.
**Prevention:** Require a custom non-standard header (e.g., `X-Matrix-Internal: true`) for sensitive loopback endpoints. Ensure this header is EXCLUDED from the CORS `allowHeaders` whitelist so that browsers will block cross-origin requests during the preflight (OPTIONS) phase.
