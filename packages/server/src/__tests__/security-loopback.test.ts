import { describe, it, expect, beforeEach } from "vitest";
import { Hono } from "hono";
import { cors } from "hono/cors";

// Mirror of the logic in packages/server/src/index.ts
function isLoopbackRequest(c: any): boolean {
  const addr: string | undefined = c.req.header("X-Mock-Remote-Addr");
  if (!addr) return false;

  const isLocal = addr === "127.0.0.1" || addr === "::1" || addr === "::ffff:127.0.0.1";
  if (!isLocal) return false;

  // Additional check to prevent Localhost CSRF
  // 1. Must include X-Matrix-Internal header (forces CORS preflight)
  if (c.req.header("X-Matrix-Internal") !== "true") return false;

  // 2. If Origin is present, it must be a trusted local origin
  const origin = c.req.header("Origin");
  if (origin) {
    const isTrustedOrigin =
      origin.startsWith("http://localhost:") ||
      origin.startsWith("http://127.0.0.1:") ||
      origin.startsWith("http://[::1]:");
    if (!isTrustedOrigin) return false;
  }

  return true;
}

describe("Loopback Security", () => {
  let app: Hono;
  const serverToken = "test-token";

  beforeEach(() => {
    app = new Hono();
    // Replicating server's CORS config
    app.use("/*", cors({
      origin: (origin) => origin || "*",
      allowHeaders: ["Content-Type", "Authorization", "X-Matrix-Internal"],
    }));

    app.get("/api/auth-info", (c) => {
      if (!isLoopbackRequest(c)) {
        return c.json({ error: "Forbidden" }, 403);
      }
      return c.json({ token: serverToken });
    });
  });

  it("rejects cross-origin access to auth-info from local requests without custom header", async () => {
    const res = await app.request("/api/auth-info", {
      headers: {
        "Origin": "http://malicious.com",
        "X-Mock-Remote-Addr": "127.0.0.1"
      }
    });

    expect(res.status).toBe(403);
  });

  it("rejects cross-origin access to auth-info from local requests with malicious origin even if custom header is present", async () => {
    const res = await app.request("/api/auth-info", {
      headers: {
        "Origin": "http://malicious.com",
        "X-Matrix-Internal": "true",
        "X-Mock-Remote-Addr": "127.0.0.1"
      }
    });

    expect(res.status).toBe(403);
  });

  it("allows access to auth-info from trusted local origin with custom header", async () => {
    const res = await app.request("/api/auth-info", {
      headers: {
        "Origin": "http://localhost:3000",
        "X-Matrix-Internal": "true",
        "X-Mock-Remote-Addr": "127.0.0.1"
      }
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.token).toBe(serverToken);
  });

  it("allows access to auth-info from local requests without Origin but with custom header (e.g. non-browser clients)", async () => {
    const res = await app.request("/api/auth-info", {
      headers: {
        "X-Matrix-Internal": "true",
        "X-Mock-Remote-Addr": "127.0.0.1"
      }
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.token).toBe(serverToken);
  });
});
