import { describe, it, expect, beforeEach } from "vitest";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { isLoopbackRequest } from "../index.js";
import { getLocalIp } from "../connect-info.js";

describe("Loopback security", () => {
  let app: Hono;
  const serverToken = "test-token";

  beforeEach(() => {
    app = new Hono();

    // Setup CORS as defined in index.ts
    app.use("/*", cors({
      origin: (origin) => origin || "*",
      allowHeaders: ["Authorization", "Content-Type", "X-Matrix-Internal"],
    }));

    // Specialized CORS check for loopback endpoints to prevent DNS rebinding / CSRF
    const localOriginMiddleware = async (c: any, next: any) => {
      const origin = c.req.header("Origin");
      if (origin) {
        const isLocalOrigin = origin.startsWith("http://localhost:") || origin.startsWith("http://127.0.0.1:");
        if (!isLocalOrigin) {
          return c.json({ error: "Forbidden origin" }, 403);
        }
      }
      await next();
    };

    app.use("/api/auth-info", localOriginMiddleware);
    app.use("/api/local-ip", localOriginMiddleware);

    // Mock loopback endpoints as defined in index.ts
    app.get("/api/auth-info", (c) => {
      if (!isLoopbackRequest(c)) {
        return c.json({ error: "Forbidden" }, 403);
      }
      return c.json({ token: serverToken });
    });

    app.get("/api/local-ip", (c) => {
      if (!isLoopbackRequest(c)) {
        return c.json({ error: "Forbidden" }, 403);
      }
      const ip = getLocalIp();
      if (!ip) {
        return c.json({ error: "No LAN address found" }, 404);
      }
      return c.json({ ip });
    });
  });

  const loopbackAddresses = ["127.0.0.1", "::1", "::ffff:127.0.0.1"];

  for (const addr of loopbackAddresses) {
    describe(`Address: ${addr}`, () => {
      it("rejects request without X-Matrix-Internal header", async () => {
        const res = await app.request("/api/auth-info", {}, {
          incoming: {
            socket: {
              remoteAddress: addr
            }
          }
        } as any);
        expect(res.status).toBe(403);
        const body = await res.json();
        expect(body.error).toBe("Forbidden");
      });

      it("rejects request with incorrect X-Matrix-Internal header", async () => {
        const res = await app.request("/api/auth-info", {
          headers: {
            "X-Matrix-Internal": "false"
          }
        }, {
          incoming: {
            socket: {
              remoteAddress: addr
            }
          }
        } as any);
        expect(res.status).toBe(403);
      });

      it("accepts request with correct X-Matrix-Internal header", async () => {
        const res = await app.request("/api/auth-info", {
          headers: {
            "X-Matrix-Internal": "true"
          }
        }, {
          incoming: {
            socket: {
              remoteAddress: addr
            }
          }
        } as any);
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.token).toBe(serverToken);
      });
    });
  }

  it("rejects non-loopback address even with header", async () => {
    const res = await app.request("/api/auth-info", {
      headers: {
        "X-Matrix-Internal": "true"
      }
    }, {
      incoming: {
        socket: {
          remoteAddress: "192.168.1.1"
        }
      }
    } as any);
    expect(res.status).toBe(403);
  });

  it("rejects missing remoteAddress even with header (fail securely)", async () => {
    const res = await app.request("/api/auth-info", {
      headers: {
        "X-Matrix-Internal": "true"
      }
    }, {
      incoming: {
        socket: {}
      }
    } as any);
    expect(res.status).toBe(403);
  });

  describe("CORS security", () => {
    it("allows local origins", async () => {
      const res = await app.request("/api/auth-info", {
        headers: {
          "Origin": "http://localhost:3000",
          "X-Matrix-Internal": "true",
        }
      }, {
        incoming: {
          socket: {
            remoteAddress: "127.0.0.1"
          }
        }
      } as any);
      expect(res.status).toBe(200);
    });

    it("disallows non-local origins", async () => {
      const res = await app.request("/api/auth-info", {
        headers: {
          "Origin": "https://malicious.com",
          "X-Matrix-Internal": "true",
        }
      }, {
        incoming: {
          socket: {
            remoteAddress: "127.0.0.1"
          }
        }
      } as any);
      expect(res.status).toBe(403);
      const body = await res.json();
      expect(body.error).toBe("Forbidden origin");
    });
  });
});
