import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import { isLoopbackRequest } from "../index.js";
import { createMiddleware } from "hono/factory";

// Mock log for testing
const log = { warn: () => {} };

/**
 * Re-implement the middleware logic here for unit testing since it's not exported
 * and uses a closure-scoped 'log'. In a real scenario, we'd test the app instance.
 */
const localOriginMiddleware = createMiddleware(async (c, next) => {
  const origin = c.req.header("Origin");
  if (origin && !origin.startsWith("http://localhost:") && !origin.startsWith("http://127.0.0.1:")) {
    return c.json({ error: "Forbidden" }, 403);
  }
  await next();
});

describe("Loopback Security", () => {
  describe("isLoopbackRequest", () => {
    const mockContext = (remoteAddress: string | undefined, internalHeader: string | undefined) => ({
      env: { incoming: { socket: { remoteAddress } } },
      req: { header: (name: string) => (name === "X-Matrix-Internal" ? internalHeader : undefined) },
    } as any);

    it("accepts loopback address with internal header", () => {
      expect(isLoopbackRequest(mockContext("127.0.0.1", "true"))).toBe(true);
      expect(isLoopbackRequest(mockContext("::1", "true"))).toBe(true);
      expect(isLoopbackRequest(mockContext("::ffff:127.0.0.1", "true"))).toBe(true);
    });

    it("rejects loopback address without internal header", () => {
      expect(isLoopbackRequest(mockContext("127.0.0.1", undefined))).toBe(false);
      expect(isLoopbackRequest(mockContext("127.0.0.1", "false"))).toBe(false);
    });

    it("rejects non-loopback address even with internal header", () => {
      expect(isLoopbackRequest(mockContext("192.168.1.1", "true"))).toBe(false);
      expect(isLoopbackRequest(mockContext("8.8.8.8", "true"))).toBe(false);
    });

    it("rejects missing remote address", () => {
      expect(isLoopbackRequest(mockContext(undefined, "true"))).toBe(false);
    });
  });

  describe("localOriginMiddleware", () => {
    const app = new Hono();
    app.get("/test", localOriginMiddleware, (c) => c.json({ ok: true }));

    it("allows request with no Origin header", async () => {
      const res = await app.request("/test");
      expect(res.status).toBe(200);
    });

    it("allows request with localhost Origin", async () => {
      const res = await app.request("/test", {
        headers: { Origin: "http://localhost:3000" },
      });
      expect(res.status).toBe(200);
    });

    it("allows request with 127.0.0.1 Origin", async () => {
      const res = await app.request("/test", {
        headers: { Origin: "http://127.0.0.1:5173" },
      });
      expect(res.status).toBe(200);
    });

    it("rejects request from untrusted Origin", async () => {
      const res = await app.request("/test", {
        headers: { Origin: "https://malicious.com" },
      });
      expect(res.status).toBe(403);
      const body = await res.json();
      expect(body.error).toBe("Forbidden");
    });

    it("rejects request from local-looking but untrusted Origin", async () => {
      const res = await app.request("/test", {
        headers: { Origin: "http://localhost.evil.com" },
      });
      expect(res.status).toBe(403);
    });
  });
});
