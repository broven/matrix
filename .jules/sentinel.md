## 2025-05-15 - Masking sensitive tokens in logs
**Vulnerability:** Exposed sensitive authentication tokens in server console logs.
**Learning:** Printing full authentication tokens to the console (including connection URIs) is a common pattern for local development but poses a security risk if logs are captured or viewed by unauthorized parties.
**Prevention:** Use the `maskToken` utility in `packages/server/src/auth/token.ts` to obfuscate tokens for safe logging, keeping only the first and last 4 characters.
