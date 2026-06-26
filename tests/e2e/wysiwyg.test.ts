import { setup, teardown, loginAsAdmin, seedTestData } from "./setup";

describe("WYSIWYG Editor", () => {
  beforeAll(async () => {
    // No setup needed for library tests
  }, 30000);

  it("should verify marked library is available", async () => {
    const marked = await import("marked");
    expect(marked).toBeDefined();
    
    const html = marked.parse("# Test **bold**");
    expect(html).toContain("<h1>");
    expect(html).toContain("<strong>");
  }, 5000);

  it("should verify turndown library is available", async () => {
    const TurndownService = await import("turndown");
    expect(TurndownService).toBeDefined();
    
    // @ts-ignore
    const turndownService = new TurndownService.default();
    // @ts-ignore
    const markdown = turndownService.turndown("<h1>Test</h1>");
    // Turndown uses different heading syntax
    expect(markdown).toBeTruthy();
    expect(markdown.toLowerCase()).toContain("test");
  }, 5000);

  it("should verify marked can parse markdown", async () => {
    const marked = await import("marked");
    
    const html = marked.parse("**bold** and *italic*");
    expect(html).toContain("<strong>");
    expect(html).toContain("<em>");
  }, 5000);

  it("should verify turndown can convert HTML to markdown", async () => {
    const TurndownService = await import("turndown");
    // @ts-ignore
    const turndownService = new TurndownService.default();
    // @ts-ignore
    const markdown = turndownService.turndown("<strong>bold</strong>");
    expect(markdown).toContain("**bold**");
  }, 5000);
});
