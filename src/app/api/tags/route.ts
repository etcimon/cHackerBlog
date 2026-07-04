/**
 * Tags endpoint -> list of all tags for the top-of-feed filter bar.
 */
import { handler, ok, AppError } from "@/lib/errors";
import { listAllTags, deleteTag } from "@/lib/articles";

export const runtime = "nodejs";

export const GET = handler(async () => {
  const tags = await listAllTags();
  return ok(tags);
});

export const DELETE = handler(async (req: Request) => {
  const { searchParams } = new URL(req.url);
  const slug = searchParams.get("slug");
  
  if (!slug) {
    throw new AppError("Tag slug is required", 400, "BAD_REQUEST");
  }
  
  await deleteTag(slug);
  return ok({ success: true });
});
