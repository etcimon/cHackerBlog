/**
 * Site footer. Per branding requirement, the single-word product name is
 * "cHackerBlog", shown here and linked to the source repository.
 */
import { Github } from "lucide-react";

export function Footer({ xHandle, linkedinUrl }: { xHandle?: string | null; linkedinUrl?: string | null }) {
  return (
    <footer className="mt-16 border-t border-border py-8 text-center text-sm text-muted">
      <div className="mb-3 flex items-center justify-center gap-4">
        {xHandle && (
          <a
            href={`https://x.com/${xHandle.replace(/^@/, "")}`}
            target="_blank"
            rel="noreferrer"
            className="transition-colors hover:text-accent"
          >
            X / @{xHandle.replace(/^@/, "")}
          </a>
        )}
        {linkedinUrl && (
          <a
            href={linkedinUrl}
            target="_blank"
            rel="noreferrer"
            className="transition-colors hover:text-accent"
          >
            LinkedIn
          </a>
        )}
      </div>
      <p className="flex items-center justify-center gap-1.5">
        Powered by{" "}
        <a
          href="https://github.com/etcimon/chackerblog"
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 font-semibold text-accent transition-opacity hover:opacity-80"
        >
          <Github className="h-4 w-4" />
          cHackerBlog
        </a>
      </p>
    </footer>
  );
}
