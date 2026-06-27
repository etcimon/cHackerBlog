/**
 * Photo upload endpoint (admin only). Accepts multipart/form-data with a `file`
 * field, validates type/size, writes to UPLOAD_DIR (self-hosted under /public),
 * and returns the public URL for in-place insertion into a new article.
 */
import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { handler, ok, AppError } from "@/lib/errors";
import { requireAdmin } from "@/lib/auth";
import { env } from "@/lib/env";

export const runtime = "nodejs";

const ALLOWED = new Map<string, string>([
  ["image/jpeg", "jpg"],
  ["image/png", "png"],
  ["image/gif", "gif"],
  ["image/webp", "webp"],
  ["image/svg+xml", "svg"],
]);

export const POST = handler(async (req: Request) => {
  requireAdmin();

  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) {
    throw new AppError("No file provided", 400, "NO_FILE");
  }
  const ext = ALLOWED.get(file.type);
  if (!ext) {
    throw new AppError("Unsupported file type", 415, "UNSUPPORTED_TYPE");
  }
  if (file.size > env.UPLOAD_MAX_BYTES) {
    throw new AppError("File too large", 413, "TOO_LARGE");
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const name = `${Date.now()}-${randomBytes(6).toString("hex")}.${ext}`;
  const dir = path.resolve(env.UPLOAD_DIR);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, name), buffer);

  // UPLOAD_DIR lives under /public, so the public URL is /api/uploads/<name>.
  return ok({ url: `/api/uploads/${name}` }, 201);
});
