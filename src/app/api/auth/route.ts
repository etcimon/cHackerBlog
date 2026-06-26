/**
 * Admin auth endpoints.
 *   GET    -> { admin: boolean }     (session status, drives the admin UI)
 *   POST   -> login with { password } (rate limited per IP)
 *   DELETE -> logout
 */
import { handler, ok, Errors } from "@/lib/errors";
import { loginSchema } from "@/lib/schemas";
import { checkPassword, createSession, destroySession, isAdmin } from "@/lib/auth";
import { getClientIp, rateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";

export const GET = handler(async () => {
  return ok({ admin: isAdmin() });
});

export const POST = handler(async (req: Request) => {
  const ip = getClientIp(req.headers);
  const rl = await rateLimit(ip, "login", { max: 10, windowSeconds: 300 });
  if (!rl.allowed) throw Errors.rateLimited("Too many login attempts");

  const body = await req.json().catch(() => ({}));
  const { password } = loginSchema.parse(body);

  if (!(await checkPassword(password))) {
    throw Errors.unauthorized("Invalid password");
  }
  createSession();
  return ok({ admin: true });
});

export const DELETE = handler(async () => {
  destroySession();
  return ok({ admin: false });
});
