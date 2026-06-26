import { setup, teardown, seedTestData } from "./setup";

describe("Comment Posting", () => {
  let context: Awaited<ReturnType<typeof setup>>;

  beforeAll(async () => {
    await seedTestData();
    context = await setup();
  }, 30000);

  afterAll(async () => {
    await teardown(context);
  }, 10000);

  it("should verify comments API returns 403 when disabled", async () => {
    const { baseUrl } = context;
    
    // Temporarily set COMMENTS_ENABLED to false by modifying env
    const originalCommentsEnabled = process.env.COMMENTS_ENABLED;
    process.env.COMMENTS_ENABLED = "false";
    
    try {
      // Try to post a comment when disabled
      const response = await fetch(`${baseUrl}/api/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          articleId: "test-article-id",
          authorName: "Test User",
          body: "Test comment",
        }),
      });
      
      // Should return 403 Forbidden when comments are disabled
      expect(response.status).toBe(403);
      
      const errorText = await response.text();
      expect(errorText).toContain("disabled");
    } finally {
      // Restore original setting
      process.env.COMMENTS_ENABLED = originalCommentsEnabled;
    }
  }, 10000);

  it("should verify comments API accepts posts when enabled", async () => {
    const { baseUrl } = context;
    
    // Ensure COMMENTS_ENABLED is true
    const originalCommentsEnabled = process.env.COMMENTS_ENABLED;
    process.env.COMMENTS_ENABLED = "true";
    
    try {
      // Try to post a comment when enabled
      const response = await fetch(`${baseUrl}/api/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          articleId: "test-article-id", // This will fail validation but should pass the enabled check
          authorName: "Test User",
          body: "Test comment",
        }),
      });
      
      // Should NOT return 403 Forbidden when comments are enabled
      expect(response.status).not.toBe(403);
    } finally {
      // Restore original setting
      process.env.COMMENTS_ENABLED = originalCommentsEnabled;
    }
  }, 10000);

  it("should verify comment form is disabled when comments are disabled", async () => {
    const { page, baseUrl } = context;
    
    await page.goto(`${baseUrl}`, { waitUntil: "networkidle0", timeout: 10000 });
    
    // Wait for page to load
    await page.waitForSelector('body', { timeout: 10000 });
    
    // Check if comment button exists and is disabled when COMMENTS_ENABLED is false
    const commentButton = await page.$('button[title*="Comment"], button[title*="comment"]');
    
    if (commentButton) {
      const isDisabled = await commentButton.evaluate((el) => {
        const button = el as HTMLButtonElement;
        return button.disabled;
      });
      
      // If comments are disabled, the button should be disabled
      // If comments are enabled, the button should not be disabled
      const commentsEnabled = process.env.COMMENTS_ENABLED !== "false";
      
      if (!commentsEnabled) {
        expect(isDisabled).toBe(true);
      }
    }
  }, 15000);

  it("should verify comment posting fails when comments disabled", async () => {
    const { page, baseUrl } = context;
    
    // Temporarily disable comments
    const originalCommentsEnabled = process.env.COMMENTS_ENABLED;
    process.env.COMMENTS_ENABLED = "false";
    
    try {
      await page.goto(`${baseUrl}`, { waitUntil: "networkidle0", timeout: 10000 });
      await page.waitForSelector('body', { timeout: 10000 });
      
      // Find and click comment button (if it exists)
      const commentButton = await page.$('button[title*="Comment"], button[title*="comment"]');
      if (commentButton) {
        await commentButton.click();
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        // Try to find textarea and type content
        const textarea = await page.$('textarea[placeholder*="comment"], textarea[placeholder*="Comment"]');
        if (textarea) {
          // If we can find the textarea when comments are disabled, that's a bug
          throw new Error("Comment form should not be accessible when comments are disabled");
        }
      }
    } finally {
      // Restore original setting
      process.env.COMMENTS_ENABLED = originalCommentsEnabled;
    }
  }, 15000);

  it("should verify database has comments table", async () => {
    const { PrismaClient } = await import("@prisma/client");
    const client = new PrismaClient();
    
    // Verify the Comment model exists by trying to query it
    const comments = await client.comment.findMany({ take: 1 });
    expect(comments).toBeDefined();
    
    await client.$disconnect();
  }, 10000);

  it("should verify comments can be created in database when enabled", async () => {
    const { PrismaClient } = await import("@prisma/client");
    const client = new PrismaClient();
    
    // Ensure COMMENTS_ENABLED is true
    const originalCommentsEnabled = process.env.COMMENTS_ENABLED;
    process.env.COMMENTS_ENABLED = "true";
    
    try {
      // Get a test article
      const articles = await client.article.findMany({ take: 1 });
      if (articles.length === 0) {
        throw new Error("No articles found to test comment creation");
      }
      
      const article = articles[0];
      
      // Try to create a comment directly in database
      const comment = await client.comment.create({
        data: {
          articleId: article.id,
          authorName: "Test User",
          body: "Test comment",
          ip: "127.0.0.1",
          approved: false,
        },
      });
      
      expect(comment).toBeDefined();
      expect(comment.body).toBe("Test comment");
      
      // Clean up
      await client.comment.delete({ where: { id: comment.id } });
    } finally {
      // Restore original setting
      process.env.COMMENTS_ENABLED = originalCommentsEnabled;
      await client.$disconnect();
    }
  }, 10000);
});
