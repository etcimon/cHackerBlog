import { useEffect, useState } from "react";

/**
 * Hook to get the COMMENTS_ENABLED setting from the server.
 * Since this is a client-side hook, we need to fetch it from an API endpoint
 * or pass it as a prop. For now, we'll default to true and add an API endpoint
 * later if needed.
 */
export function useCommentsEnabled(): boolean {
  // For now, default to true. In a real implementation, this would
  // fetch from an API endpoint that reads env.COMMENTS_ENABLED
  const [enabled, setEnabled] = useState(true);

  useEffect(() => {
    // Could fetch from /api/settings or similar in the future
    setEnabled(true);
  }, []);

  return enabled;
}
