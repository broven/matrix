import { describe, expect, it } from "vitest";
import { buildConnectionUri } from "../connect-info.js";

describe("connect-info", () => {
  it("builds a matrix connection URI", () => {
    const uri = buildConnectionUri("http://127.0.0.1:8080", "secret");

    expect(uri).toBe("matrix://connect?serverUrl=http%3A%2F%2F127.0.0.1%3A8080&token=secret");
  });
});
