/**
 * Shared client/server data shapes that are safe to import from client
 * components (no server-only dependencies).
 */
export interface FeedItem {
  id: string;
  slug: string;
  title: string;
  coverUrl: string | null;
  locale: string;
  publishedAt: string;
  tags: string[];
  preview: string;
  content?: string;
  pinned: boolean;
  pinnedAt: string | null;
  published: boolean;
  commentCount: number;
}

export interface FeedPage {
  items: FeedItem[];
  nextCursor: string | null;
}

export interface PublicSettings {
  setupComplete: boolean;
  title: string;
  description: string;
  faviconUrl: string | null;
  coverUrl: string | null;
  authorName: string;
  authorThumbUrl: string | null;
  headHtml: string;
  xHandle: string | null;
  linkedinUrl: string | null;
  socialAutopost: boolean;
}

export interface TagItem {
  name: string;
  slug: string;
}

/**
 * Truncate HTML content to a specified character count while preserving HTML structure.
 * Strips HTML tags and returns plain text for preview.
 */
export function truncateContent(html: string, maxChars: number): string {
  // Strip HTML tags
  const plainText = html.replace(/<[^>]*>/g, '');
  // Truncate to max characters
  if (plainText.length <= maxChars) return plainText;
  return plainText.substring(0, maxChars).trim() + '...';
}
