## 2025-05-14 - Localhost CSRF / Token Theft
**Vulnerability:** Malicious websites could make cross-origin requests to 'localhost:8080/api/auth-info' to steal the server's authentication token, because the server only checked the remote IP address and had a permissive CORS policy.
**Learning:** Checking 'remoteAddress' is insufficient to protect local-only endpoints in a browser-accessible server. Cross-origin requests from the same machine also appear to come from '127.0.0.1'.
**Prevention:** Use a custom non-standard header (e.g., 'X-Matrix-Internal') to force a CORS preflight, and implement a server-side check to validate that the 'Origin' header belongs to a trusted local source.
