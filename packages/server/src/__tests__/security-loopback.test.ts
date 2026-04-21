import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { isLoopbackRequest, localOriginMiddleware } from "../auth/security.js";

describe("Security Loopback Protection", () => {
  const app = new Hono();
  const serverToken = "secret-token";

  app.use(
    "/*",
    cors({
      origin: (origin) => origin || "*",
      allowHeaders: ["Authorization", "Content-Type", "X-Matrix-Internal"],
    }),
  );

  app.get("/api/auth-info", localOriginMiddleware, (c) => {
    if (!isLoopbackRequest(c)) {
      return c.json({ error: "Forbidden" }, 403);
    }
    return c.json({ token: serverToken });
  });

  it("blocks requests without X-Matrix-Internal header", async () => {
    const req = new Request("http://localhost/api/auth-info");
    const res = await app.fetch(req, {
      incoming: { socket: { remoteAddress: "127.0.0.1" } } as any
    });
    expect(res.status).toBe(403);
  });

  it("allows loopback requests with X-Matrix-Internal header", async () => {
    const req = new Request("http://localhost/api/auth-info", {
      headers: { "X-Matrix-Internal": "true" }
    });
    const res = await app.fetch(req, {
      incoming: { socket: { remoteAddress: "127.0.0.1" } } as any
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { token: string };
    expect(body.token).toBe(serverToken);
  });

  it("blocks requests with malicious Origin header even if X-Matrix-Internal is present", async () => {
    const req = new Request("http://localhost/api/auth-info", {
      headers: {
        "Origin": "http://evil.com",
        "X-Matrix-Internal": "true"
      }
    });
    const res = await app.fetch(req, {
      incoming: { socket: { remoteAddress: "127.0.0.1" } } as any
    });
    expect(res.status).toBe(403);
    const body = await res.json() as { error: string };
    expect(body.error).toContain("Invalid Origin");
  });

  it("allows requests from localhost Origin with X-Matrix-Internal header", async () => {
    const req = new Request("http://localhost/api/auth-info", {
      headers: {
        "Origin": "http://localhost:5173",
        "X-Matrix-Internal": "true"
      }
    });
    const res = await app.fetch(req, {
      incoming: { socket: { remoteAddress: "127.0.0.1" } } as any
    });
    expect(res.status).toBe(200);
  });

  it("allows requests from tauri Origin with X-Matrix-Internal header", async () => {
    const req = new Request("http://localhost/api/auth-info", {
      headers: {
        "Origin": "tauri://localhost",
        "X-Matrix-Internal": "true"
      }
    });
    const res = await app.fetch(req, {
      incoming: { socket: { remoteAddress: "127.0.0.1" } } as any
    });
    expect(res.status).toBe(200);
  });
});
