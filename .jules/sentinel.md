## 2026-04-19 - [Localhost CSRF & DNS Rebinding Protection]
**Vulnerability:** Sensitive loopback-only endpoints (/api/auth-info, /api/local-ip) were accessible to any browser-based cross-origin request if the source IP was 127.0.0.1.
**Learning:** Checking the remote address alone is insufficient to protect sensitive loopback endpoints in a browser environment. DNS rebinding or simple CSRF can allow a malicious site to make requests that appear to come from the local machine.
**Prevention:** Require a custom non-standard header (e.g., `X-Matrix-Internal: true`) to force a CORS preflight. Additionally, validate the `Origin` header against a trusted allowlist of local schemes (localhost, tauri://) to provide defense-in-depth.
