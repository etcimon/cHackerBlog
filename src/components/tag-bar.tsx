"use client";

/**
 * Top-of-feed tag filter bar. Selecting a tag drives the feed query (the active
 * tag is lifted to the Feed component). "All" clears the filter.
 */
import { useState } from "react";
import { X } from "lucide-react";
import type { TagItem } from "@/lib/types";
import { api } from "@/lib/api-client";
import { useToast } from "@/components/toast";

interface Props {
  tags: TagItem[];
  active: string | null;
  onSelect: (slug: string | null) => void;
  isAdmin?: boolean;
}

export function TagBar({ tags, active, onSelect, isAdmin = false }: Props) {
  const toast = useToast();
  const [tagArticleCounts, setTagArticleCounts] = useState<Record<string, number>>({});
  const [deletingTag, setDeletingTag] = useState<string | null>(null);

  const handleDeleteTag = async (slug: string) => {
    if (!isAdmin) return;
    
    setDeletingTag(slug);
    try {
      await api.del(`/api/tags?slug=${slug}`);
      toast.success("Tag deleted");
      // Refresh tags by calling parent callback or reload
      window.location.reload();
    } catch (err) {
      toast.error("Failed to delete tag");
    } finally {
      setDeletingTag(null);
    }
  };

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
          <div
            key={t.slug}
            className={`flex items-center gap-1 rounded-full border px-3 py-1 text-sm transition-colors ${
              active === t.slug
                ? "border-accent bg-accent text-bg"
                : "border-border text-muted hover:text-fg"
            }`}
          >
            <button
              onClick={() => onSelect(t.slug)}
              className="hover:opacity-70"
            >
              #{t.name}
            </button>
            {isAdmin && (
              <button
                onClick={() => handleDeleteTag(t.slug)}
                disabled={deletingTag === t.slug}
                className="hover:opacity-70 disabled:opacity-50"
                title="Delete tag"
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </div>
        ))}
      </div>
    </nav>
  );
}
