import { describe, it, expect } from "vitest";
import { MatrixClient } from "../client.js";

describe("MatrixClient", () => {
  it("constructs with config", () => {
    const client = new MatrixClient({
      serverUrl: "http://localhost:8080",
      token: "test",
    });
    expect(client).toBeDefined();
  });

  it("defaults transport to auto", () => {
    const client = new MatrixClient({
      serverUrl: "http://localhost:8080",
      token: "test",
    });
    expect(client.transportMode).toBe("auto");
  });

  it("stores serverUrl", () => {
    const client = new MatrixClient({
      serverUrl: "http://localhost:8080",
      token: "test",
    });
    expect(client.serverUrl).toBe("http://localhost:8080");
  });

  it("accepts custom transport mode", () => {
    const client = new MatrixClient({
      serverUrl: "http://localhost:8080",
      token: "test",
      transport: "sse",
    });
    expect(client.transportMode).toBe("sse");
  });
});
