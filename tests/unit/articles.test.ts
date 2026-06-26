// Load test environment before any imports
import { config } from "dotenv";
config({ path: ".env.test" });

import { connectTags, createArticle, deleteTag, listAllTags } from "@/lib/articles";
import { PrismaClient } from "@prisma/client";

describe("Articles Service - Tags", () => {
  const prisma = new PrismaClient();

  beforeEach(async () => {
    // Clean up test data
    await prisma.comment.deleteMany();
    await prisma.article.deleteMany();
    await prisma.tag.deleteMany();
  });

  afterEach(async () => {
    await prisma.$disconnect();
  });

  it("should create tags with connectTags", async () => {
    const tagConnect = await connectTags(["JavaScript", "TypeScript"]);
    
    expect(tagConnect).toHaveLength(2);
    expect(tagConnect[0]).toHaveProperty("id");
    expect(tagConnect[1]).toHaveProperty("id");
    
    // Verify tags were created in database
    const tags = await prisma.tag.findMany();
    expect(tags).toHaveLength(2);
    expect(tags.map(t => t.name)).toContain("JavaScript");
    expect(tags.map(t => t.name)).toContain("TypeScript");
  });

  it("should handle duplicate tag names by upserting", async () => {
    await connectTags(["TestTag"]);
    await connectTags(["TestTag", "AnotherTag"]);
    
    const tags = await prisma.tag.findMany();
    expect(tags).toHaveLength(2); // Should not create duplicate
  });

  it("should create article with tags", async () => {
    const tagConnect = await connectTags(["TestTag"]);
    
    const article = await createArticle({
      title: "Test Article",
      content: "<p>Test content</p>",
      coverUrl: "",
      locale: "en",
      published: true,
      tags: ["TestTag"],
    });
    
    expect(article).toBeDefined();
    expect(article.tags).toHaveLength(1);
    expect(article.tags[0].name).toBe("TestTag");
  });

  it("should delete tag when not used by articles", async () => {
    const tagConnect = await connectTags(["ToDelete"]);
    // The slug will be "todelete" (slugified version)
    const tagSlug = "todelete";
    
    // Verify tag exists
    const tag = await prisma.tag.findUnique({ where: { slug: tagSlug } });
    expect(tag).not.toBeNull();
    
    await deleteTag(tagSlug);
    
    const tags = await prisma.tag.findMany();
    expect(tags).toHaveLength(0);
  });

  it("should not delete tag when used by articles", async () => {
    const tagConnect = await connectTags(["ProtectedTag"]);
    
    await createArticle({
      title: "Test Article",
      content: "<p>Test content</p>",
      coverUrl: "",
      locale: "en",
      published: true,
      tags: ["ProtectedTag"],
    });
    
    await expect(deleteTag("protected-tag")).rejects.toThrow("Cannot delete tag");
    
    const tags = await prisma.tag.findMany();
    expect(tags).toHaveLength(1);
  });

  it("should list all tags", async () => {
    await connectTags(["Alpha", "Beta", "Gamma"]);
    
    const tags = await listAllTags();
    expect(tags).toHaveLength(3);
    expect(tags[0].name).toBe("Alpha"); // Should be sorted alphabetically
  });
});
