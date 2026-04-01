## 2025-05-22 - Localhost CSRF and DNS Rebinding via Loopback APIs
**Vulnerability:** Malicious websites could use a user's browser to fetch sensitive information (like authentication tokens) from Matrix server APIs running on 'localhost' by making cross-origin requests.
**Learning:** Checking for a loopback IP address (127.0.0.1) is insufficient protection against CSRF and DNS Rebinding because the browser still sends the request from the user's context.
**Prevention:** Require a custom, non-standard header (e.g., 'X-Matrix-Internal: true') for all sensitive loopback-only endpoints. Ensure this header is EXCLUDED from the CORS 'allowHeaders' whitelist to cause browser preflight requests to fail for malicious origins.
