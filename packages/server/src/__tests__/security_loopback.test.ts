import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { isLoopbackRequest } from "../index.js";

describe("Security: Loopback Endpoints Fix", () => {
  const app = new Hono();
  const serverToken = "secret-token";

  // Updated secure CORS configuration in packages/server/src/index.ts
  app.use(
    "/*",
    cors({
      origin: (origin) => origin || "*",
      allowHeaders: ["Content-Type", "Authorization"],
    }),
  );

  app.get("/api/auth-info", (c) => {
    if (!isLoopbackRequest(c)) {
      return c.json({ error: "Forbidden" }, 403);
    }
    return c.json({ token: serverToken });
  });

  it("fix: rejects loopback access WITHOUT X-Matrix-Internal header", async () => {
    const res = await app.request("/api/auth-info", {}, {
      incoming: {
        socket: {
          remoteAddress: "127.0.0.1"
        }
      }
    } as any);

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe("Forbidden");
  });

  it("fix: allows loopback access WITH X-Matrix-Internal: true header", async () => {
    const res = await app.request("/api/auth-info", {
      headers: {
        "X-Matrix-Internal": "true"
      }
    }, {
      incoming: {
        socket: {
          remoteAddress: "127.0.0.1"
        }
      }
    } as any);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.token).toBe(serverToken);
  });

  it("fix: CORS does NOT whitelist X-Matrix-Internal header", async () => {
    // A CORS preflight (OPTIONS) would show what headers are allowed
    const res = await app.request("/api/auth-info", {
      method: "OPTIONS",
      headers: {
        "Origin": "https://evil.com",
        "Access-Control-Request-Method": "GET",
        "Access-Control-Request-Headers": "X-Matrix-Internal"
      }
    });

    expect(res.status).toBe(204);
    const allowedHeaders = res.headers.get("Access-Control-Allow-Headers");
    if (allowedHeaders) {
      expect(allowedHeaders.split(",").map(h => h.trim())).not.toContain("X-Matrix-Internal");
    }
  });
});
