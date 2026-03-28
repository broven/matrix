import { describe, it, expect } from "vitest";
import { maskToken } from "../auth/token.js";

describe("Sentinel Security Enhancements", () => {
  it("maskToken should obfuscate tokens correctly", () => {
    expect(maskToken(null)).toBe("none");
    expect(maskToken(undefined)).toBe("none");
    expect(maskToken("")).toBe("none");
    expect(maskToken("12345")).toBe("********");
    expect(maskToken("12345678")).toBe("********");
    expect(maskToken("123456789")).toBe("1234...6789");
    expect(maskToken("longtoken-1234567890")).toBe("long...7890");
  });
});
