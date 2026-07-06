/**
 * Legal articles status endpoint.
 *   GET -> returns the status of all legal articles (terms-conditions, privacy-policy)
 *          so the footer can decide which links to show.
 */
import { handler, ok } from "@/lib/errors";
import { getLegalStatus } from "@/lib/articles";

export const runtime = "nodejs";

export const GET = handler(async () => {
  const status = await getLegalStatus();
  return ok(status);
});
