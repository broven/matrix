# Sentinel Journal

## 2025-05-15 - Localhost CSRF & DNS Rebinding Protection
**Vulnerability:** Sensitive loopback-only endpoints (`/api/auth-info`, `/api/local-ip`) were accessible to any browser-based origin due to permissive global CORS settings (`origin: "*"`) and lack of origin verification.
**Learning:** Even if an endpoint is restricted to loopback IPs, a browser on the same machine can be tricked by a malicious website (Cross-Origin) to fetch data from `localhost`. Simply checking the remote IP is insufficient because the browser's request *comes* from the local machine.
**Prevention:**
1. Require a custom non-standard header (e.g., `X-Matrix-Internal: true`). This forces a CORS preflight (`OPTIONS` request), which browsers will block if the server doesn't explicitly allow the requesting origin.
2. Implement server-side `Origin` header validation against a trusted local allowlist (e.g., `http://localhost:`, `http://127.0.0.1:`) to prevent malicious sites from bypassing security if CORS is misconfigured or if DNS rebinding is attempted.
