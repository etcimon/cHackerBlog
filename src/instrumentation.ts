/**
 * Next.js server startup hook. `register()` runs once when the server boots.
 * Only on the Node.js runtime (not edge) do we register the Telegram webhook for
 * the live-chat subsystem; errors are swallowed so a webhook failure never
 * blocks server startup (the feature no-ops when Telegram env is unset).
 */
export function register(): void {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    (async () => {
      try {
        const m = await import("@/lib/chat/telegram");
        await m.ensureTelegramWebhook();
      } catch {
        // no-op: webhook registration is best-effort and should not block startup
      }
    })();
  }
}
