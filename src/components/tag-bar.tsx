"use client";

/**
 * Top-of-feed tag filter bar. Selecting a tag drives the feed query (the active
 * tag is lifted to the Feed component). "All" clears the filter.
 */
import type { TagItem } from "@/lib/types";

interface Props {
  tags: TagItem[];
  active: string | null;
  onSelect: (slug: string | null) => void;
}

export function TagBar({ tags, active, onSelect }: Props) {
  return (
    <nav className="sticky top-0 z-40 -mx-4 mb-4 border-b border-border bg-bg/90 px-4 py-3 backdrop-blur">
      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={() => onSelect(null)}
          className={`rounded-full border px-3 py-1 text-sm transition-colors ${
            active === null
              ? "border-accent bg-accent text-bg"
              : "border-border text-muted hover:text-fg"
          }`}
        >
          All
        </button>
        {tags.map((t) => (
          <button
            key={t.slug}
            onClick={() => onSelect(t.slug)}
            className={`rounded-full border px-3 py-1 text-sm transition-colors ${
              active === t.slug
                ? "border-accent bg-accent text-bg"
                : "border-border text-muted hover:text-fg"
            }`}
          >
            #{t.name}
          </button>
        ))}
      </div>
    </nav>
  );
}
