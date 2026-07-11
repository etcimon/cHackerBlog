/**
 * Next.js server startup hook. `register()` runs once when the server boots.
 * Only on the Node.js runtime (not edge) do we register the Telegram webhook for
 * the live-chat subsystem; errors are swallowed so a webhook failure never
 * blocks server startup (the feature no-ops when Telegram env is unset).
 */
export function register(): void {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    import("@/lib/chat/telegram")
      .then((m) => m.ensureTelegramWebhook())
      .catch(() => {});
  }
}
