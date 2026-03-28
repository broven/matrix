## 2025-05-15 - [CORS vulnerability with sensitive loopback headers]
**Vulnerability:** Malicious websites could use CORS preflight requests to bypass security checks on sensitive loopback-only endpoints.
**Learning:** Even when a server is on loopback, browser-based attacks like CORS can still target it. If endpoints rely on specific custom headers for security (like `X-Matrix-Internal`), the CORS configuration must explicitly forbid these headers in preflight requests (`Access-Control-Allow-Headers`).
**Prevention:** Always use an explicit `allowHeaders` whitelist in CORS configuration that excludes any security-critical headers used for loopback or internal authentication.
