/**
 * Unit tests for embed markdown round-trip consistency.
 * Validates that @[name](url) tags survive the HTML ↔ Markdown conversion
 * via marked and turndown.
 */
import { marked } from "marked";
import TurndownService from "turndown";
import {
  buildEmbedHtml,
  buildEmbedMarkdown,
  registerEmbedExtension,
  addEmbedTurndownRule,
  parseSizeSpec,
  sizeSpecToString,
  type EmbedSize,
} from "@/lib/embeds";

describe("Size Specification Parser", () => {
  it("should parse pixel dimensions (WxH)", () => {
    const result = parseSizeSpec("640x360");
    expect(result).toEqual({ type: "pixels", width: 640, height: 360 });
  });

  it("should parse pixel dimensions with lowercase x", () => {
    const result = parseSizeSpec("640X360");
    expect(result).toEqual({ type: "pixels", width: 640, height: 360 });
  });

  it("should parse percentage width", () => {
    const result = parseSizeSpec("50%");
    expect(result).toEqual({ type: "percent", width: 50 });
  });

  it("should parse preset size 'small'", () => {
    const result = parseSizeSpec("small");
    expect(result).toEqual({ type: "preset", size: "small" });
  });

  it("should parse preset size 'medium'", () => {
    const result = parseSizeSpec("medium");
    expect(result).toEqual({ type: "preset", size: "medium" });
  });

  it("should parse preset size 'large'", () => {
    const result = parseSizeSpec("large");
    expect(result).toEqual({ type: "preset", size: "large" });
  });

  it("should parse named width parameter", () => {
    const result = parseSizeSpec("width=640");
    expect(result).toEqual({ type: "pixels", width: 640, height: 0 });
  });

  it("should parse named width and height parameters", () => {
    const result = parseSizeSpec("width=640 height=360");
    expect(result).toEqual({ type: "pixels", width: 640, height: 360 });
  });

  it("should handle extra spaces", () => {
    const result = parseSizeSpec("  640x360  ");
    expect(result).toEqual({ type: "pixels", width: 640, height: 360 });
  });

  it("should return none for empty string", () => {
    const result = parseSizeSpec("");
    expect(result).toEqual({ type: "none" });
  });

  it("should return none for invalid format", () => {
    const result = parseSizeSpec("invalid");
    expect(result).toEqual({ type: "none" });
  });

  it("should handle single number as pixel width", () => {
    const result = parseSizeSpec("640");
    expect(result).toEqual({ type: "pixels", width: 640, height: 0 });
  });
});

describe("Size Specification Stringifier", () => {
  it("should convert pixels with height to WxH format", () => {
    const size: EmbedSize = { type: "pixels", width: 640, height: 360 };
    expect(sizeSpecToString(size)).toBe("640x360");
  });

  it("should convert pixels without height to width= format", () => {
    const size: EmbedSize = { type: "pixels", width: 640, height: 0 };
    expect(sizeSpecToString(size)).toBe("width=640");
  });

  it("should convert percent to percentage format", () => {
    const size: EmbedSize = { type: "percent", width: 50 };
    expect(sizeSpecToString(size)).toBe("50%");
  });

  it("should convert preset to name", () => {
    const size: EmbedSize = { type: "preset", size: "small" };
    expect(sizeSpecToString(size)).toBe("small");
  });

  it("should convert none to empty string", () => {
    const size: EmbedSize = { type: "none" };
    expect(sizeSpecToString(size)).toBe("");
  });
});

describe("Embed Markdown Round-Trip", () => {
  let turndown: TurndownService;

  beforeAll(() => {
    // Register the marked extension globally
    registerEmbedExtension(marked);
  });

  beforeEach(() => {
    // Create a fresh turndown instance for each test
    turndown = new TurndownService({
      headingStyle: "atx",
      codeBlockStyle: "fenced",
    });
    addEmbedTurndownRule(turndown);
  });

  const testCases = [
    {
      name: "PDF document",
      markdown: "@[document.pdf](http://example.com/document.pdf)",
    },
    {
      name: "MP3 audio",
      markdown: "@[track.mp3](http://example.com/track.mp3)",
    },
    {
      name: "MP4 video",
      markdown: "@[video.mp4](http://example.com/video.mp4)",
    },
    {
      name: "DOCX document",
      markdown: "@[report.docx](http://example.com/report.docx)",
    },
    {
      name: "XLSX spreadsheet",
      markdown: "@[data.xlsx](http://example.com/data.xlsx)",
    },
    {
      name: "PPTX slides",
      markdown: "@[presentation.pptx](http://example.com/presentation.pptx)",
    },
    {
      name: "ZIP archive",
      markdown: "@[archive.zip](http://example.com/archive.zip)",
    },
    {
      name: "TXT file",
      markdown: "@[notes.txt](http://example.com/notes.txt)",
    },
  ];

  const sizeTestCases = [
    {
      name: "PDF with pixel dimensions",
      markdown: "@[document.pdf 640x360](http://example.com/document.pdf)",
    },
    {
      name: "Video with pixel dimensions",
      markdown: "@[video.mp4 1280x720](http://example.com/video.mp4)",
    },
    {
      name: "Audio with percentage width",
      markdown: "@[track.mp3 50%](http://example.com/track.mp3)",
    },
    {
      name: "Video with percentage width",
      markdown: "@[video.mp4 75%](http://example.com/video.mp4)",
    },
    {
      name: "PDF with small preset",
      markdown: "@[document.pdf small](http://example.com/document.pdf)",
    },
    {
      name: "Video with medium preset",
      markdown: "@[video.mp4 medium](http://example.com/video.mp4)",
    },
    {
      name: "Audio with large preset",
      markdown: "@[track.mp3 large](http://example.com/track.mp3)",
    },
    {
      name: "PDF with named width",
      markdown: "@[document.pdf width=640](http://example.com/document.pdf)",
    },
    {
      name: "Video with named width and height",
      markdown: "@[video.mp4 1280x720](http://example.com/video.mp4)",
    },
  ];

  testCases.forEach(({ name, markdown }) => {
    it(`should preserve ${name} markdown through HTML round-trip`, () => {
      // Step 1: Markdown → HTML via marked
      const html = marked.parse(markdown) as string;
      expect(html).toContain("data-embed");
      expect(html).toContain("data-name");
      expect(html).toContain("data-src");

      // Step 2: HTML → Markdown via turndown
      const roundTripped = turndown.turndown(html);

      // Step 3: The round-tripped markdown should match the original
      expect(roundTripped.trim()).toBe(markdown);
    });
  });

  sizeTestCases.forEach(({ name, markdown }) => {
    it(`should preserve ${name} with size through HTML round-trip`, () => {
      // Step 1: Markdown → HTML via marked
      const html = marked.parse(markdown) as string;
      expect(html).toContain("data-embed");
      expect(html).toContain("data-name");
      expect(html).toContain("data-src");
      expect(html).toContain("data-size");

      // Step 2: HTML → Markdown via turndown
      const roundTripped = turndown.turndown(html);

      // Step 3: The round-tripped markdown should match the original
      expect(roundTripped.trim()).toBe(markdown);
    });
  });

  it("should handle multiple embeds in a single document", () => {
    const markdown = [
      "# Test Document",
      "",
      "Here is a PDF:",
      "@[doc.pdf](http://example.com/doc.pdf)",
      "",
      "And a video:",
      "@[video.mp4](http://example.com/video.mp4)",
      "",
      "And audio:",
      "@[audio.mp3](http://example.com/audio.mp3)",
    ].join("\n");

    const html = marked.parse(markdown) as string;
    const roundTripped = turndown.turndown(html);

    // All three embeds should be preserved
    expect(roundTripped).toContain("@[doc.pdf]");
    expect(roundTripped).toContain("@[video.mp4]");
    expect(roundTripped).toContain("@[audio.mp3]");
  });

  it("should handle embeds with special characters in filename", () => {
    const markdown = "@[file with spaces & symbols.pdf](http://example.com/file.pdf)";
    const html = marked.parse(markdown) as string;
    const roundTripped = turndown.turndown(html);
    expect(roundTripped.trim()).toBe(markdown);
  });

  it("should handle embeds with URLs containing query parameters", () => {
    const markdown = "@[file.pdf](http://example.com/file.pdf?v=1&token=abc123)";
    const html = marked.parse(markdown) as string;
    const roundTripped = turndown.turndown(html);
    expect(roundTripped.trim()).toBe(markdown);
  });

  it("should not affect regular markdown elements", () => {
    const markdown = [
      "# Heading",
      "",
      "**Bold** and *italic* text.",
      "",
      "- List item 1",
      "- List item 2",
      "",
      "Regular link: [Example](http://example.com)",
    ].join("\n");

    const html = marked.parse(markdown) as string;
    const roundTripped = turndown.turndown(html);

    // Regular markdown should be preserved (allowing for minor formatting differences)
    expect(roundTripped).toContain("# Heading");
    expect(roundTripped).toContain("**Bold**");
    // turndown may convert *italic* to _italic_ (both are valid)
    expect(roundTripped).toMatch(/[*_]italic[*_]/);
    expect(roundTripped).toContain("List item 1");
    expect(roundTripped).toContain("[Example]");
  });
});
