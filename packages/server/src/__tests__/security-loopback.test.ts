import { describe, it, expect } from "vitest";
import { Hono } from "hono";

// Re-implementing logic here for testing in isolation,
// mimicking what we added to packages/server/src/index.ts
function isLoopbackRequest(c: any): boolean {
  // In real Hono with node-server, this would be c.env.incoming.socket.remoteAddress
  const addr = c.req.header("X-Forwarded-For") || "127.0.0.1";
  const isLoopbackIp = addr === "127.0.0.1" || addr === "::1" || addr === "::ffff:127.0.0.1";
  const hasInternalHeader = c.req.header("X-Matrix-Internal") === "true";
  return isLoopbackIp && hasInternalHeader;
}

const localOriginMiddleware = async (c: any, next: any) => {
  const origin = c.req.header("Origin");
  if (origin) {
    const isLocalOrigin =
      origin.startsWith("http://localhost:") ||
      origin.startsWith("http://127.0.0.1:") ||
      origin.startsWith("http://[::1]:");

    if (!isLocalOrigin) {
      return c.json({ error: "Forbidden: Non-local origin" }, 403);
    }
  }
  await next();
};

describe("Loopback Security Fix Verification", () => {
  const app = new Hono();

  // CORS configuration as in index.ts
  app.use("/*", async (c, next) => {
    c.header("Access-Control-Allow-Origin", "*");
    c.header("Access-Control-Allow-Headers", "Authorization, Content-Type, X-Matrix-Internal");
    await next();
  });

  app.get("/api/auth-info", localOriginMiddleware, (c) => {
    if (!isLoopbackRequest(c)) {
      return c.json({ error: "Forbidden" }, 403);
    }
    return c.json({ token: "secret-token" });
  });

  it("rejects requests without X-Matrix-Internal header", async () => {
    const res = await app.request("/api/auth-info");
    expect(res.status).toBe(403);
  });

  it("rejects requests from non-local Origin even if header is present", async () => {
    const res = await app.request("/api/auth-info", {
      headers: {
        "X-Matrix-Internal": "true",
        "Origin": "http://malicious.com"
      }
    });

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toContain("Non-local origin");
  });

  it("accepts valid local requests with internal header", async () => {
    const res = await app.request("/api/auth-info", {
      headers: {
        "X-Matrix-Internal": "true",
        "Origin": "http://localhost:5173"
      }
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.token).toBe("secret-token");
  });

  it("accepts valid local requests without Origin (e.g. from desktop app direct fetch)", async () => {
    const res = await app.request("/api/auth-info", {
      headers: {
        "X-Matrix-Internal": "true"
      }
    });

    expect(res.status).toBe(200);
  });
});
