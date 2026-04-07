## 2025-05-15 - Localhost CSRF on Sensitive Endpoints
**Vulnerability:** Sensitive loopback-only endpoints (like `/api/auth-info` which returns the server token) were vulnerable to Cross-Site Request Forgery (CSRF). A malicious website running in the same browser could make requests to `http://127.0.0.1:8080/api/auth-info` and, because it's a loopback request, the server would return the sensitive token.
**Learning:** Relying solely on IP-based (loopback) authentication is insufficient for protecting local servers from browser-based attacks. Browsers do not block cross-origin requests to `localhost` by default unless specific headers or preflight checks are triggered.
**Prevention:** Always use "Defense in Depth" for local-only endpoints:
1. Require a custom non-standard header (e.g., `X-Matrix-Internal: true`) which forces a CORS preflight.
2. Validate the `Origin` header (if present) to ensure it matches a trusted local source (`localhost` or `127.0.0.1`).
3. Ensure the server's CORS policy explicitly whitelists only the necessary custom headers.
