## 2025-05-15 - Localhost CSRF protection for loopback endpoints
**Vulnerability:** Sensitive loopback endpoints (`/api/auth-info`, `/api/local-ip`) were vulnerable to Localhost CSRF. A malicious website visited by a user could make cross-origin requests to the local Matrix server and steal the authentication token because the server only validated the remote IP address.
**Learning:** Checking the remote IP address (`127.0.0.1`) is insufficient for security when the server is accessible via a browser. Browsers allow cross-origin requests to localhost, and unless protected, these requests carry the authority of the local user.
**Prevention:** Implement a defense-in-depth approach for local endpoints:
1. Require a non-standard custom header (e.g., `X-Matrix-Internal: true`) to force a CORS preflight.
2. Validate the `Origin` header against a whitelist of trusted local origins (e.g., `localhost`, `127.0.0.1`) even for loopback requests.
