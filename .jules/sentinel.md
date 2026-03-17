## 2026-03-17 - [Sensitive Debug Logging to /tmp]
**Vulnerability:** Information exposure through world-readable debug logs in `/tmp`.
**Learning:** Developers sometimes add persistent logging to `/tmp` to debug process communication (like JSON-RPC over stdio), which can unintentionally expose sensitive data (prompts, responses, tokens) to other users on the system.
**Prevention:** Avoid persistent debug logging to shared locations. Use standard logging frameworks with configurable levels and secure destinations, and ensure sensitive data is redacted or masked before logging.
