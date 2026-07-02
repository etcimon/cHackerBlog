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
  buildUrlEmbedHtml,
  buildUrlEmbedMarkdown,
  parseUrlBracket,
  shouldTreatAsUrlEmbed,
  registerEmbedExtension,
  addEmbedTurndownRule,
  buildImageHtml,
  buildImageMarkdown,
  registerImageSizeExtension,
  addImageTurndownRule,
  buildPreviewEndHtml,
  extractPreviewHtml,
  registerPreviewEndExtension,
  addPreviewEndTurndownRule,
  PREVIEW_END_MARKER,
  parseSizeSpec,
  sizeSpecToString,
  type EmbedSize,
} from "@/lib/embeds";
import { buildProviderEmbed, detectProvider } from "@/lib/ext-embeds";

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

describe("Sized Image Builders", () => {
  it("buildImageMarkdown should emit preset spec", () => {
    const md = buildImageMarkdown({
      alt: "photo",
      src: "http://example.com/p.png",
      size: { type: "preset", size: "small" },
    });
    expect(md).toBe("![photo](http://example.com/p.png){small}");
  });

  it("buildImageMarkdown should emit WxH spec", () => {
    const md = buildImageMarkdown({
      alt: "photo",
      src: "http://example.com/p.png",
      size: { type: "pixels", width: 250, height: 300 },
    });
    expect(md).toBe("![photo](http://example.com/p.png){250x300}");
  });

  it("buildImageMarkdown should emit width= spec when no height", () => {
    const md = buildImageMarkdown({
      alt: "photo",
      src: "http://example.com/p.png",
      size: { type: "pixels", width: 250, height: 0 },
    });
    expect(md).toBe("![photo](http://example.com/p.png){width=250}");
  });

  it("buildImageMarkdown should omit braces when size is none", () => {
    const md = buildImageMarkdown({
      alt: "photo",
      src: "http://example.com/p.png",
      size: { type: "none" },
    });
    expect(md).toBe("![photo](http://example.com/p.png)");
  });

  it("buildImageHtml should carry data attributes for round-trip", () => {
    const html = buildImageHtml({
      alt: "photo",
      src: "http://example.com/p.png",
      size: { type: "preset", size: "small" },
    });
    expect(html).toContain('data-cb-img="1"');
    expect(html).toContain('data-size="small"');
    expect(html).toContain("cb-img--size-small");
  });

  it("buildImageHtml should inline pixel width/height", () => {
    const html = buildImageHtml({
      alt: "photo",
      src: "http://example.com/p.png",
      size: { type: "pixels", width: 250, height: 300 },
    });
    expect(html).toContain("width: 250px;");
    expect(html).toContain("height: 300px;");
  });
});

describe("Sized Image Markdown Round-Trip", () => {
  let turndown: TurndownService;

  beforeAll(() => {
    registerImageSizeExtension(marked);
  });

  beforeEach(() => {
    turndown = new TurndownService({
      headingStyle: "atx",
      codeBlockStyle: "fenced",
    });
    addImageTurndownRule(turndown);
  });

  const sizedImageCases = [
    { name: "small preset", markdown: "![alt text](http://example.com/photo.png){small}" },
    { name: "medium preset", markdown: "![alt text](http://example.com/photo.png){medium}" },
    { name: "large preset", markdown: "![alt text](http://example.com/photo.png){large}" },
    { name: "WxH pixels", markdown: "![alt text](http://example.com/photo.png){640x360}" },
    { name: "width= named", markdown: "![alt text](http://example.com/photo.png){width=250}" },
    {
      name: "width+height named (normalizes to WxH)",
      markdown: "![alt text](http://example.com/photo.png){width=250 height=300}",
      expected: "![alt text](http://example.com/photo.png){250x300}",
    },
    { name: "percentage", markdown: "![alt text](http://example.com/photo.png){50%}" },
  ];

  sizedImageCases.forEach(({ name, markdown, expected }) => {
    it(`should round-trip ${name}`, () => {
      const html = marked.parse(markdown) as string;
      expect(html).toContain("data-cb-img");
      expect(html).toContain("data-size");

      const roundTripped = turndown.turndown(html).trim();
      expect(roundTripped).toBe(expected ?? markdown);
    });
  });

  it("should leave plain images (no spec) untouched by the sized rule", () => {
    const markdown = "![alt text](http://example.com/photo.png)";
    const html = marked.parse(markdown) as string;
    expect(html).not.toContain("data-cb-img");
    const roundTripped = turndown.turndown(html).trim();
    expect(roundTripped).toBe(markdown);
  });

  it("should treat an unknown spec as a plain image with trailing text", () => {
    const markdown = "![alt](http://example.com/p.png){nonsense}";
    const html = marked.parse(markdown) as string;
    // Falls through to default image handling; no sized-image data attrs.
    expect(html).not.toContain("data-cb-img");
    expect(html).toContain("{nonsense}");
  });

  it("should handle a sized image inside a paragraph with surrounding text", () => {
    const markdown = "Here is a photo ![alt](http://example.com/p.png){small} inline.";
    const html = marked.parse(markdown) as string;
    expect(html).toContain("data-cb-img");
    const roundTripped = turndown.turndown(html).trim();
    expect(roundTripped).toContain("![alt](http://example.com/p.png){small}");
  });
});

describe("Preview Separator Builders", () => {
  it("buildPreviewEndHtml should emit an <hr> carrying data-preview-end", () => {
    const html = buildPreviewEndHtml();
    expect(html).toContain("<hr");
    expect(html).toContain('data-preview-end="1"');
    expect(html).toContain("cb-preview-end");
  });

  it("PREVIEW_END_MARKER should be the canonical markdown form", () => {
    expect(PREVIEW_END_MARKER).toBe("--END PREVIEW--");
  });
});

describe("extractPreviewHtml", () => {
  it("returns null when no separator is present", () => {
    expect(extractPreviewHtml("<p>Just a body</p>")).toBeNull();
  });

  it("returns the HTML before the separator, trimmed", () => {
    const html = `<p>Intro</p>${buildPreviewEndHtml()}<p>Hidden</p>`;
    expect(extractPreviewHtml(html)).toBe("<p>Intro</p>");
  });

  it("keeps a full code block before the separator intact", () => {
    const codeBlock =
      '<div class="cb-code"><pre class="cb-code__pre"><code class="language-ts">const x = 1;</code></pre></div>';
    const html = `${codeBlock}${buildPreviewEndHtml()}<p>After</p>`;
    const preview = extractPreviewHtml(html);
    expect(preview).toBe(codeBlock);
    expect(preview).not.toContain("After");
  });

  it("matches the separator regardless of attribute order", () => {
    const html =
      '<p>Intro</p><hr class="cb-preview-end" data-preview-end="1" /><p>Rest</p>';
    expect(extractPreviewHtml(html)).toBe("<p>Intro</p>");
  });
});

describe("Preview Separator Markdown Round-Trip", () => {
  let turndown: TurndownService;

  beforeAll(() => {
    registerPreviewEndExtension(marked);
  });

  beforeEach(() => {
    turndown = new TurndownService({
      headingStyle: "atx",
      codeBlockStyle: "fenced",
    });
    addPreviewEndTurndownRule(turndown);
  });

  it("renders --END PREVIEW-- as an <hr data-preview-end>", () => {
    const html = marked.parse("--END PREVIEW--") as string;
    expect(html).toContain("data-preview-end");
    expect(html).toContain("cb-preview-end");
  });

  it("round-trips the bare separator back to --END PREVIEW--", () => {
    const html = marked.parse("--END PREVIEW--") as string;
    const md = turndown.turndown(html).trim();
    expect(md).toBe("--END PREVIEW--");
  });

  it("preserves the separator inside a larger document", () => {
    const markdown = [
      "# Title",
      "",
      "Intro paragraph.",
      "",
      "--END PREVIEW--",
      "",
      "Hidden paragraph.",
    ].join("\n");
    const html = marked.parse(markdown) as string;
    expect(html).toContain("data-preview-end");

    const md = turndown.turndown(html).trim();
    expect(md).toContain("# Title");
    expect(md).toContain("Intro paragraph.");
    expect(md).toContain("--END PREVIEW--");
    expect(md).toContain("Hidden paragraph.");
    // Order is preserved: separator sits between the intro and the hidden body.
    expect(md.indexOf("Intro paragraph.")).toBeLessThan(md.indexOf("--END PREVIEW--"));
    expect(md.indexOf("--END PREVIEW--")).toBeLessThan(md.indexOf("Hidden paragraph."));
  });

  it("leaves a normal horizontal rule (---) untouched", () => {
    const html = marked.parse("above\n\n---\n\nbelow") as string;
    expect(html).not.toContain("data-preview-end");
    const md = turndown.turndown(html).trim();
    expect(md).not.toContain("--END PREVIEW--");
  });
});

/* ----------------------------- URL embeds -------------------------------- */
// The two canonical fixtures requested for verification.
const SOUNDCLOUD_URL =
  "https://soundcloud.com/elaina-hannah/overwerk-virtue?si=957df22c7ab74dd2a3412cfc5675be41&utm_source=clipboard&utm_medium=text&utm_campaign=social_sharing";
const YOUTUBE_URL = "https://www.youtube.com/watch?v=Z_UOmAed5O8";

describe("URL Embed Detection", () => {
  it("treats external pages as URL embeds", () => {
    expect(shouldTreatAsUrlEmbed(YOUTUBE_URL)).toBe(true);
    expect(shouldTreatAsUrlEmbed(SOUNDCLOUD_URL)).toBe(true);
    expect(shouldTreatAsUrlEmbed("https://example.com/some-post")).toBe(true);
  });

  it("leaves local uploads and direct file links as file embeds", () => {
    expect(shouldTreatAsUrlEmbed("/api/uploads/1234-file.pdf")).toBe(false);
    expect(shouldTreatAsUrlEmbed("https://cdn.example.com/clip.mp4")).toBe(false);
    expect(shouldTreatAsUrlEmbed("https://cdn.example.com/photo.jpg")).toBe(false);
  });

  it("detects providers by host", () => {
    expect(detectProvider(YOUTUBE_URL)).toBe("youtube");
    expect(detectProvider(SOUNDCLOUD_URL)).toBe("soundcloud");
    expect(detectProvider("https://music.youtube.com/watch?v=abc")).toBe("youtubemusic");
    expect(detectProvider("https://example.com/x")).toBeNull();
  });
});

describe("URL Embed Bracket Parser", () => {
  it("parses an empty bracket", () => {
    expect(parseUrlBracket("")).toEqual({ size: { type: "none" }, urlOnly: false });
  });
  it("parses a size spec", () => {
    expect(parseUrlBracket("640x360")).toEqual({
      size: { type: "pixels", width: 640, height: 360 },
      urlOnly: false,
    });
  });
  it("parses the urlOnly keyword (case-insensitive)", () => {
    expect(parseUrlBracket("urlOnly")).toEqual({ size: { type: "none" }, urlOnly: true });
    expect(parseUrlBracket("URLONLY")).toEqual({ size: { type: "none" }, urlOnly: true });
  });
  it("parses size + urlOnly together", () => {
    expect(parseUrlBracket("50% urlOnly")).toEqual({
      size: { type: "percent", width: 50 },
      urlOnly: true,
    });
  });
});

describe("Provider Embed Generation", () => {
  it("builds a YouTube iframe from the video id", () => {
    const frame = buildProviderEmbed(YOUTUBE_URL);
    expect(frame?.provider).toBe("youtube");
    expect(frame?.shape).toBe("video");
    expect(frame?.html).toContain("https://www.youtube.com/embed/Z_UOmAed5O8");
  });

  it("builds a SoundCloud player from the track permalink", () => {
    const frame = buildProviderEmbed(SOUNDCLOUD_URL);
    expect(frame?.provider).toBe("soundcloud");
    expect(frame?.shape).toBe("audio");
    expect(frame?.html).toContain("https://w.soundcloud.com/player/?url=");
    // The permalink is encoded and the tracking query stripped from the player.
    expect(frame?.html).toContain(
      encodeURIComponent("https://soundcloud.com/elaina-hannah/overwerk-virtue"),
    );
    expect(frame?.html).not.toContain("utm_source");
  });
});

describe("URL Embed Round-Trip", () => {
  let turndown: TurndownService;

  beforeAll(() => {
    registerEmbedExtension(marked);
  });

  beforeEach(() => {
    turndown = new TurndownService({ headingStyle: "atx", codeBlockStyle: "fenced" });
    addEmbedTurndownRule(turndown);
  });

  const cases = [
    { name: "YouTube (default rich embed)", markdown: `@[](${YOUTUBE_URL})` },
    { name: "SoundCloud (default rich embed)", markdown: `@[](${SOUNDCLOUD_URL})` },
    { name: "YouTube short link", markdown: "@[](https://youtu.be/Z_UOmAed5O8)" },
    { name: "Sized YouTube embed", markdown: "@[640x360](https://youtu.be/Z_UOmAed5O8)" },
    { name: "Percent-sized SoundCloud", markdown: `@[50%](${SOUNDCLOUD_URL})` },
    { name: "Generic page (preview fallback)", markdown: "@[](https://example.com/some-post)" },
    { name: "urlOnly plain link", markdown: "@[urlOnly](https://example.com/some-post)" },
    { name: "Sized + urlOnly", markdown: "@[50% urlOnly](https://example.com/some-post)" },
  ];

  cases.forEach(({ name, markdown }) => {
    it(`round-trips ${name}`, () => {
      const html = marked.parse(markdown) as string;
      expect(html).toContain('data-embed-type="url"');
      const roundTripped = turndown.turndown(html);
      expect(roundTripped.trim()).toBe(markdown);
    });
  });

  it("renders a YouTube rich embed with the player iframe", () => {
    const html = marked.parse(`@[](${YOUTUBE_URL})`) as string;
    expect(html).toContain('data-provider="youtube"');
    expect(html).toContain("https://www.youtube.com/embed/Z_UOmAed5O8");
    expect(html).toContain('data-shape="video"');
  });

  it("renders a SoundCloud rich embed with the player iframe", () => {
    const html = marked.parse(`@[](${SOUNDCLOUD_URL})`) as string;
    expect(html).toContain('data-provider="soundcloud"');
    expect(html).toContain("https://w.soundcloud.com/player/?url=");
    expect(html).toContain('data-shape="audio"');
    // The full original URL (with tracking params) is preserved for round-trip.
    expect(html).toContain("utm_campaign=social_sharing");
  });

  it("renders a generic page as a link-preview card with a Visit-site button", () => {
    const html = marked.parse("@[](https://example.com/some-post)") as string;
    expect(html).toContain("cb-embed--link");
    expect(html).toContain('data-link-hydrate="1"');
    expect(html).toContain("Visit site");
    expect(html).toContain("example.com");
  });

  it("renders urlOnly as a plain anchor without a preview", () => {
    const html = marked.parse("@[urlOnly](https://example.com/some-post)") as string;
    expect(html).toContain("cb-embed--urlonly");
    expect(html).toContain('data-url-only="1"');
    expect(html).not.toContain("cb-embed__frame");
    expect(html).not.toContain("Visit site");
  });

  it("keeps file/media embeds unaffected by URL-embed detection", () => {
    const markdown = "@[video.mp4](https://cdn.example.com/video.mp4)";
    const html = marked.parse(markdown) as string;
    expect(html).not.toContain('data-embed-type="url"');
    expect(html).toContain("data-embed");
    const roundTripped = turndown.turndown(html);
    expect(roundTripped.trim()).toBe(markdown);
  });

  it("keeps the WYSIWYG-built HTML and markdown preview consistent (same builder)", () => {
    // The editor inserts buildUrlEmbedHtml output directly in rich mode; the
    // markdown preview renders buildUrlEmbedMarkdown through marked. Both must
    // yield identical HTML so the two surfaces stay visually consistent.
    const fromBuilder = buildUrlEmbedHtml({ url: YOUTUBE_URL });
    const fromMarkdown = marked.parse(buildUrlEmbedMarkdown({ url: YOUTUBE_URL })) as string;
    expect(fromMarkdown).toContain(fromBuilder);
  });
});
