import { expect, test, describe } from "bun:test";
import { isLoopbackRequest, localOriginMiddleware } from "../index.js";

describe("isLoopbackRequest", () => {
  test("identifies 127.0.0.1 as loopback only if internal header is present", () => {
    const c_with_header = {
      env: { incoming: { socket: { remoteAddress: "127.0.0.1" } } },
      req: { header: (n: string) => n === "X-Matrix-Internal" ? "true" : undefined }
    };
    expect(isLoopbackRequest(c_with_header)).toBe(true);

    const c_without_header = {
      env: { incoming: { socket: { remoteAddress: "127.0.0.1" } } },
      req: { header: () => undefined }
    };
    expect(isLoopbackRequest(c_without_header)).toBe(false);
  });

  test("identifies ::1 as loopback only if internal header is present", () => {
    const c = {
      env: { incoming: { socket: { remoteAddress: "::1" } } },
      req: { header: (n: string) => n === "X-Matrix-Internal" ? "true" : undefined }
    };
    expect(isLoopbackRequest(c)).toBe(true);
  });

  test("identifies ::ffff:127.0.0.1 as loopback only if internal header is present", () => {
    const c = {
      env: { incoming: { socket: { remoteAddress: "::ffff:127.0.0.1" } } },
      req: { header: (n: string) => n === "X-Matrix-Internal" ? "true" : undefined }
    };
    expect(isLoopbackRequest(c)).toBe(true);
  });

  test("identifies 192.168.1.1 as NOT loopback even with header", () => {
    const c = {
      env: { incoming: { socket: { remoteAddress: "192.168.1.1" } } },
      req: { header: (n: string) => n === "X-Matrix-Internal" ? "true" : undefined }
    };
    expect(isLoopbackRequest(c)).toBe(false);
  });
});

describe("localOriginMiddleware", () => {
  test("allows trusted origins", async () => {
    const trusted = ["http://localhost:5173", "http://127.0.0.1:8080", "http://[::1]:3000", "tauri://localhost"];
    for (const origin of trusted) {
      let nextCalled = false;
      const c = {
        req: {
          header: (n: string) => n === "Origin" ? origin : undefined,
          path: "/api/auth-info"
        },
        json: () => { throw new Error("Should not return error for trusted origin"); }
      };
      await localOriginMiddleware(c, async () => { nextCalled = true; });
      expect(nextCalled).toBe(true);
    }
  });

  test("blocks untrusted origins", async () => {
    const untrusted = ["http://malicious.com", "https://evil.org", "http://localhost.evil.com"];
    for (const origin of untrusted) {
      let nextCalled = false;
      let responseStatus = 0;
      const c = {
        req: {
          header: (n: string) => n === "Origin" ? origin : undefined,
          path: "/api/auth-info"
        },
        json: (data: any, status: number) => {
          responseStatus = status;
          return { data, status };
        }
      };
      await localOriginMiddleware(c, async () => { nextCalled = true; });
      expect(nextCalled).toBe(false);
      expect(responseStatus).toBe(403);
    }
  });

  test("allows requests without Origin header", async () => {
    let nextCalled = false;
    const c = {
      req: {
        header: () => undefined,
        path: "/api/auth-info"
      }
    };
    await localOriginMiddleware(c, async () => { nextCalled = true; });
    expect(nextCalled).toBe(true);
  });
});
