import { describe, it, expect } from "bun:test";
import { isLoopbackRequest } from "../index.js";

describe("isLoopbackRequest", () => {
  it("returns true for loopback address and X-Matrix-Internal header", () => {
    const c = {
      env: { incoming: { socket: { remoteAddress: "127.0.0.1" } } },
      req: { header: (name: string) => (name === "X-Matrix-Internal" ? "true" : null) },
    };
    expect(isLoopbackRequest(c)).toBe(true);
  });

  it("returns false for loopback address without X-Matrix-Internal header", () => {
    const c = {
      env: { incoming: { socket: { remoteAddress: "127.0.0.1" } } },
      req: { header: () => null },
    };
    expect(isLoopbackRequest(c)).toBe(false);
  });

  it("returns false for non-loopback address with X-Matrix-Internal header", () => {
    const c = {
      env: { incoming: { socket: { remoteAddress: "192.168.1.1" } } },
      req: { header: (name: string) => (name === "X-Matrix-Internal" ? "true" : null) },
    };
    expect(isLoopbackRequest(c)).toBe(false);
  });

  it("returns false if remoteAddress is missing", () => {
    const c = {
      env: { incoming: { socket: {} } },
      req: { header: (name: string) => (name === "X-Matrix-Internal" ? "true" : null) },
    };
    expect(isLoopbackRequest(c)).toBe(false);
  });

  it("handles IPv6 loopback addresses", () => {
    const c1 = {
      env: { incoming: { socket: { remoteAddress: "::1" } } },
      req: { header: (name: string) => (name === "X-Matrix-Internal" ? "true" : null) },
    };
    expect(isLoopbackRequest(c1)).toBe(true);

    const c2 = {
      env: { incoming: { socket: { remoteAddress: "::ffff:127.0.0.1" } } },
      req: { header: (name: string) => (name === "X-Matrix-Internal" ? "true" : null) },
    };
    expect(isLoopbackRequest(c2)).toBe(true);
  });
});
