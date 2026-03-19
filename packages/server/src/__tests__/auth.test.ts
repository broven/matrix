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

  describe("maskToken", () => {
    it("masks a long token", () => {
      const token = "1234567890abcdefghijklmnopqrstuvwxyz";
      expect(maskToken(token)).toBe("1234...wxyz");
    });

    it("masks a short token", () => {
      const token = "12345678";
      expect(maskToken(token)).toBe("****");
    });

    it("masks an empty token", () => {
      expect(maskToken("")).toBe("****");
    });
  });
});
