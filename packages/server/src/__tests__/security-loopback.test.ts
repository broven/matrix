import { describe, it, expect } from "bun:test";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { createMiddleware } from "hono/factory";

// Mocking the simplified server logic for testing
function isLoopbackRequest(c: any): boolean {
  const addr: string | undefined = c.env?.incoming?.socket?.remoteAddress;
  if (!addr) return false;
  const isLoopbackIp = addr === "127.0.0.1" || addr === "::1" || addr === "::ffff:127.0.0.1";
  if (!isLoopbackIp) return false;

  const internalHeader = c.req.header("X-Matrix-Internal");
  return internalHeader === "true";
}

const loopbackOnly = createMiddleware(async (c, next) => {
  if (!isLoopbackRequest(c)) {
    return c.json({ error: "Forbidden" }, 403);
  }

  const origin = c.req.header("Origin");
  if (origin) {
    const isLocalOrigin = origin.startsWith("http://localhost:") || origin.startsWith("http://127.0.0.1:");
    if (!isLocalOrigin) {
      return c.json({ error: "Forbidden" }, 403);
    }
  }

  await next();
});

const serverToken = "test-token";

const app = new Hono();
app.use("/*", cors({
  origin: (origin) => origin || "*",
  allowHeaders: ["Authorization", "Content-Type", "X-Matrix-Internal"],
}));

app.get("/api/auth-info", loopbackOnly, (c) => {
  return c.json({ token: serverToken });
});

describe("Loopback Security Fix", () => {
  it("allows access from loopback with internal header and local origin", async () => {
    const res = await app.request("/api/auth-info", {
      headers: {
        "X-Matrix-Internal": "true",
        "Origin": "http://localhost:3000"
      }
    }, {
      incoming: {
        socket: {
          remoteAddress: "127.0.0.1"
        }
      }
    } as any);

    expect(res.status).toBe(200);
    const body = await res.json() as { token: string };
    expect(body.token).toBe(serverToken);
  });

  it("blocks access with external Origin even with internal header", async () => {
    const res = await app.request("/api/auth-info", {
      headers: {
        "X-Matrix-Internal": "true",
        "Origin": "http://malicious.com"
      }
    }, {
      incoming: {
        socket: {
          remoteAddress: "127.0.0.1"
        }
      }
    } as any);

    expect(res.status).toBe(403);
  });

  it("blocks access without internal header", async () => {
    const res = await app.request("/api/auth-info", {
      headers: {
        "Origin": "http://localhost:3000"
      }
    }, {
      incoming: {
        socket: {
          remoteAddress: "127.0.0.1"
        }
      }
    } as any);

    expect(res.status).toBe(403);
  });

  it("blocks access from non-loopback IP", async () => {
    const res = await app.request("/api/auth-info", {
      headers: {
        "X-Matrix-Internal": "true",
      }
    }, {
      incoming: {
        socket: {
          remoteAddress: "1.2.3.4"
        }
      }
    } as any);

    expect(res.status).toBe(403);
  });
});
