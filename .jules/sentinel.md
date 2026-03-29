## 2025-05-15 - Localhost CSRF & DNS Rebinding Protection
**Vulnerability:** Malicious websites can use a user's browser to make requests to services running on `localhost` (Localhost CSRF) or use DNS Rebinding to bypass the Same-Origin Policy.
**Learning:** Simply checking the remote IP for `127.0.0.1` is insufficient protection because browsers can be coerced into making these requests.
**Prevention:** Require a custom, non-standard header (e.g., `X-Matrix-Internal: true`) for sensitive loopback endpoints. Ensure this header is NOT in the CORS `allowHeaders` whitelist to guarantee that browser preflight requests (OPTIONS) fail for cross-origin attempts.
