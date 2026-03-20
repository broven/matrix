## 2025-05-22 - [Security Headers for Localhost APIs]
**Vulnerability:** A malicious website in the browser could attempt to access local-only APIs (like `127.0.0.1:19880/api/auth-info`) using a simple GET request.
**Learning:** Restricting an endpoint to loopback is not enough; browsers can still send requests to localhost from other origins.
**Prevention:** Requiring a custom header like `X-Matrix-Internal: true` triggers a CORS preflight in modern browsers, effectively blocking cross-origin access even for GET requests.

## 2025-05-22 - [Masking Tokens in Logs]
**Vulnerability:** Exposing full authentication tokens in server logs can lead to accidental credential leakage.
**Learning:** Tokens should be obfuscated when logged, showing only enough characters to allow for verification without compromising the entire secret.
**Prevention:** Implement a `maskToken` utility to show only the first and last four characters of any sensitive token when logging to the console.
