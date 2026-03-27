## 2026-03-27 - DNS Rebinding & Localhost CSRF Mitigation
**Vulnerability:** Malicious websites can use a user's browser to make cross-origin requests to services on 'localhost' (e.g., /api/auth-info), potentially stealing authentication tokens if CORS is overly permissive or only IP-based loopback checks are used.
**Learning:** Checking the source IP (`127.0.0.1`) is insufficient. Browsers can bypass this via DNS rebinding (mapping a malicious domain to 127.0.0.1) or CSRF.
**Prevention:**
1. Require a custom non-standard header (e.g., `X-Matrix-Internal: true`) for all sensitive loopback-only endpoints.
2. Explicitly exclude this custom header from the CORS `allowHeaders` whitelist. This ensures that browsers will fail the CORS preflight (OPTIONS) request when a malicious website attempts to add the mandatory header.
