import { createMiddleware } from "hono/factory";
import type { Context } from "hono";
import { logger } from "../logger.js";

const log = logger.child({ target: "security" });

/**
 * Checks if a request is coming from a loopback address and has the internal header.
 */
export function isLoopbackRequest(c: Context): boolean {
  // @ts-ignore - access to node-specific socket info in Hono/Bun
  const addr: string | undefined = c.env?.incoming?.socket?.remoteAddress;
  if (!addr) return false;

  const isLoopbackIp = addr === "127.0.0.1" || addr === "::1" || addr === "::ffff:127.0.0.1";
  const hasInternalHeader = c.req.header("X-Matrix-Internal") === "true";

  return isLoopbackIp && hasInternalHeader;
}

/**
 * Middleware to protect loopback-only endpoints from CSRF via non-local Origins.
 * If an Origin header is present, it must be a trusted local source.
 */
export const localOriginMiddleware = createMiddleware(async (c, next) => {
  const origin = c.req.header("Origin");
  if (origin) {
    const isLocal =
      origin === "http://localhost" ||
      origin.startsWith("http://localhost:") ||
      origin === "http://127.0.0.1" ||
      origin.startsWith("http://127.0.0.1:") ||
      origin === "http://[::1]" ||
      origin.startsWith("http://[::1]:") ||
      origin.startsWith("tauri://");

    if (!isLocal) {
      log.warn({ origin, path: c.req.path }, "rejected non-local origin for loopback endpoint");
      return c.json({ error: "Forbidden: Invalid Origin for loopback request" }, 403);
    }
  }
  await next();
});
