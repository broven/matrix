import { describe, it, expect } from "vitest";
import { generateToken, validateToken, maskToken } from "../auth/token.js";

describe("auth/token", () => {
  it("generates a token string", () => {
    const token = generateToken();
    expect(typeof token).toBe("string");
    expect(token.length).toBeGreaterThan(20);
  });

  it("validates a correct token", () => {
    const token = generateToken();
    expect(validateToken(token, token)).toBe(true);
  });

  it("rejects an incorrect token", () => {
    const token = generateToken();
    expect(validateToken("wrong-token", token)).toBe(false);
  });

  it("masks a token correctly", () => {
    const token = "bJVsDBI67s-ReUps4qu0n8qexbsR4KNzymz7VQlmnLwmZUyh";
    expect(maskToken(token)).toBe("bJVs...ZUyh");
  });

  it("returns **** for short tokens", () => {
    expect(maskToken("short")).toBe("****");
  });
});
