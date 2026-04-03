import { describe, it, expect } from "vitest";
import { Hono } from "hono";
// @ts-ignore - we will export this and implement the logic in the next step
import { isLoopbackRequest } from "../index.js";

describe("isLoopbackRequest security", () => {
  it("requires both loopback IP and X-Matrix-Internal header", async () => {
    const app = new Hono();
    app.get("/test", (c) => {
      if (isLoopbackRequest(c)) {
        return c.json({ ok: true });
      }
      return c.json({ error: "Forbidden" }, 403);
    });

    // Case 1: Loopback IP, but NO header (Vulnerable state)
    const res1 = await app.request("/test", {}, {
      incoming: { socket: { remoteAddress: "127.0.0.1" } }
    } as any);
    expect(res1.status).toBe(403);

    // Case 2: Loopback IP AND correct header (Secure state)
    const res2 = await app.request("/test", {
      headers: { "X-Matrix-Internal": "true" }
    }, {
      incoming: { socket: { remoteAddress: "127.0.0.1" } }
    } as any);
    expect(res2.status).toBe(200);

    // Case 3: Non-loopback IP, even with header (Still forbidden)
    const res3 = await app.request("/test", {
      headers: { "X-Matrix-Internal": "true" }
    }, {
      incoming: { socket: { remoteAddress: "1.2.3.4" } }
    } as any);
    expect(res3.status).toBe(403);

    // Case 4: Non-loopback IP, no header
    const res4 = await app.request("/test", {}, {
      incoming: { socket: { remoteAddress: "1.2.3.4" } }
    } as any);
    expect(res4.status).toBe(403);
  });
});
