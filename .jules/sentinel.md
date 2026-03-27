# Sentinel Security Journal

## 2025-05-22 - [Loopback Security and Token Handling]
**Vulnerability:** Sensitive loopback-only endpoints (/api/auth-info, /api/local-ip) were accessible to any local process, including browsers via cross-origin requests.
**Learning:** Restricting an endpoint to loopback addresses (127.0.0.1, ::1) is not sufficient to prevent cross-origin browser access. A custom header requirement (e.g., `X-Matrix-Internal: true`) can block these requests because browsers won't include custom headers in cross-origin requests without a successful CORS preflight. However, **never add this custom header to the CORS `allowHeaders` list**, as doing so would allow any website to perform the preflight and then send the sensitive header, bypassing the protection.
**Prevention:** Use a custom header check for loopback endpoints and keep it out of the global CORS configuration. Be cautious when masking tokens in startup logs if those logs are the primary way for users to discover their credentials in headless environments.
