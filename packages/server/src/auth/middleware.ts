import { createMiddleware } from "hono/factory";
import { validateToken } from "./token.js";

export function authMiddleware(serverToken: string) {
  return createMiddleware(async (c, next) => {
    const header = c.req.header("Authorization");
    if (!header?.startsWith("Bearer ")) {
      return c.json({ error: "Missing or invalid Authorization header" }, 401);
    }
    const token = header.slice(7);
    if (!validateToken(token, serverToken)) {
      return c.json({ error: "Invalid token" }, 401);
    }
    await next();
  });
}
