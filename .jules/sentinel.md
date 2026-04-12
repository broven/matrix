## 2024-05-22 - Localhost CSRF / DNS Rebinding on Sensitive Endpoints
**Vulnerability:** Endpoints that are only protected by a loopback IP check (127.0.0.1) can be accessed by malicious websites via the user's browser. This allows an attacker to steal sensitive information like authentication tokens (via `/api/auth-info`) or network details.
**Learning:** Browser security models allow any website to make requests to `localhost`. While CORS usually prevents reading the response, it doesn't prevent the request itself (CSRF), and DNS rebinding can even bypass the Origin check if only the IP is validated.
**Prevention:**
1. Require a custom non-standard header (e.g., `X-Matrix-Internal: true`) for all sensitive loopback-only endpoints. This forces a CORS preflight and prevents simple CSRF.
2. Explicitly validate the `Origin` header against a whitelist of local origins (`localhost`, `127.0.0.1`) if it's present.
3. Combine these with the existing remote address IP check for defense in depth.
