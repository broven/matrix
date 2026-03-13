import { nanoid } from "nanoid";
import { timingSafeEqual } from "node:crypto";

export function generateToken(): string {
  return nanoid(48);
}

export function validateToken(provided: string, expected: string): boolean {
  if (provided.length !== expected.length) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return timingSafeEqual(a, b);
}
