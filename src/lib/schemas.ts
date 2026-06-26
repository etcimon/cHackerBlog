/**
 * Shared zod schemas — the single source of truth for data structures used by
 * both react-hook-form (client validation) and the API route handlers (server
 * validation). Keeping them here prevents client/server drift.
 */
import { z } from "zod";

export const localeSchema = z.string().min(2).max(10).default("en");

/** First-run setup + global settings form. */
export const siteSettingsSchema = z.object({
  title: z.string().min(1, "Title is required").max(120),
  description: z.string().max(500).default(""),
  faviconUrl: z.string().url().optional().or(z.literal("")),
  coverUrl: z.string().url().optional().or(z.literal("")),
  authorName: z.string().max(120).default(""),
  authorThumbUrl: z.string().url().optional().or(z.literal("")),
  headHtml: z.string().max(20_000).default(""),
  xHandle: z.string().max(120).optional().or(z.literal("")),
  linkedinUrl: z.string().url().optional().or(z.literal("")),
  socialAutopost: z.boolean().default(false),
});
export type SiteSettingsInput = z.infer<typeof siteSettingsSchema>;

/** Article create/update from the WYSIWYG editor. */
export const articleInputSchema = z.object({
  title: z.string().min(1, "Title is required").max(200),
  content: z.string().default(""),
  coverUrl: z.string().url().optional().or(z.literal("")),
  locale: localeSchema,
  published: z.boolean().default(true),
  tags: z.array(z.string().min(1).max(40)).max(20).default([]),
});
export type ArticleInput = z.infer<typeof articleInputSchema>;

/** Feed query parameters (validated from the URL search params). */
export const feedQuerySchema = z.object({
  cursor: z.string().optional(),
  tag: z.string().optional(),
  locale: z.string().optional(),
  take: z.coerce.number().int().positive().max(50).optional(),
});
export type FeedQuery = z.infer<typeof feedQuerySchema>;

/** Reader comment submission. */
export const commentInputSchema = z.object({
  articleId: z.string().min(1),
  authorName: z.string().min(1).max(80).default("anonymous"),
  email: z.string().email().optional().or(z.literal("")),
  body: z.string().min(1, "Comment cannot be empty").max(4000),
  ageConfirmed: z.boolean().refine((val) => val === true, "You must confirm you are 14+ years old"),
});
export type CommentInput = z.infer<typeof commentInputSchema>;

/** Admin login (password-only). */
export const loginSchema = z.object({
  password: z.string().min(1, "Password is required"),
});
export type LoginInput = z.infer<typeof loginSchema>;
