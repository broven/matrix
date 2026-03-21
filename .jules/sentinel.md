## 2025-05-14 - [Auth Token Masking and Internal Header Requirement]
**Vulnerability:** Auth tokens were logged in plaintext to the console, and sensitive loopback endpoints were accessible by any local process (including browsers via CSRF-like attacks if the server is on loopback).
**Learning:** Masking tokens in logs requires checking all log sites, including URIs that embed the token. Loopback security can be improved by requiring a custom header that browsers cannot send cross-origin without a preflight, providing defense in depth even when the server is on 127.0.0.1.
**Prevention:** Always mask sensitive tokens before logging. Use custom headers for internal/sensitive APIs to prevent cross-origin browser access.
