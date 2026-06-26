/**
 * Tags endpoint -> list of all tags for the top-of-feed filter bar.
 */
import { handler, ok } from "@/lib/errors";
import { listAllTags } from "@/lib/articles";

export const runtime = "nodejs";

export const GET = handler(async () => {
  const tags = await listAllTags();
  return ok(tags.map((t) => ({ name: t.name, slug: t.slug })));
});
