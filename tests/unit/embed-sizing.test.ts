/**
 * Unit tests for the WYSIWYG "size" toolbar: SizableTarget re-rendering and
 * the markdown round-trip of sized images, file embeds, URL embeds and code
 * blocks (renderSizable -> turndown -> markdown, and back through marked).
 */
import { marked } from "marked";
import TurndownService from "turndown";
import {
  registerEmbedExtension,
  addEmbedTurndownRule,
} from "@/lib/embeds";
import { escapeCode } from "@/lib/code-block-render";
import { renderSizable, type SizableTarget } from "@/lib/embed-sizing";

registerEmbedExtension(marked);

function mdOf(html: string): string {
  const turndown = new TurndownService({
    headingStyle: "atx",
    codeBlockStyle: "fenced",
  });
  addEmbedTurndownRule(turndown);
  return turndown.turndown(html);
}

describe("renderSizable markdown round-trip", () => {
  it("sized image -> HTML + ![alt](src){medium}", () => {
    const t: SizableTarget = {
      kind: "image",
      alt: "pasted",
      src: "/api/uploads/a.png",
      size: { type: "preset", size: "medium" },
    };
    const html = renderSizable(t);
    expect(html).toContain("cb-img--size-medium");
    expect(html).toContain('data-src="/api/uploads/a.png"');
    expect(mdOf(html)).toContain("![pasted](/api/uploads/a.png){medium}");
  });

  it("base64 image payload appears once, no data-src, markdown keeps data URL", () => {
    const src = "data:image/png;base64,AAAA";
    const t: SizableTarget = {
      kind: "image",
      alt: "pasted",
      src,
      size: { type: "preset", size: "medium" },
    };
    const html = renderSizable(t);
    expect(html).toContain("cb-img--size-medium");
    expect(html).not.toContain("data-src=");
    expect(html.match(/AAAA/g) ?? []).toHaveLength(1);
    const md = mdOf(html);
    expect(md).toContain("![pasted](data:image/png;base64,AAAA){medium}");
    expect(marked.parse(md) as string).toContain("cb-img--size-medium");
  });

  it("file embed with percent size -> @[name 50%](src)", () => {
    const t: SizableTarget = {
      kind: "file",
      name: "clip.mp4",
      src: "/api/uploads/clip.mp4",
      size: { type: "percent", width: 50 },
    };
    const md = mdOf(renderSizable(t));
    expect(md).toContain("@[clip.mp4 50%](/api/uploads/clip.mp4)");
  });

  it("url embed pixels + urlOnly -> @[640x360 urlOnly](url)", () => {
    const t: SizableTarget = {
      kind: "url",
      url: "https://example.com/post",
      size: { type: "pixels", width: 640, height: 360 },
      urlOnly: true,
    };
    const md = mdOf(renderSizable(t));
    expect(md).toContain("@[640x360 urlOnly](https://example.com/post)");
  });

  it("code block size + preview lines -> ```lang small preview=3", () => {
    const lines = Array.from({ length: 10 }, (_, i) => `const v${i} = ${i};`).join("\n");
    const t: SizableTarget = {
      kind: "code",
      lang: "javascript",
      bodyHtml: escapeCode(lines),
      highlighted: false,
      totalLines: 10,
      size: { type: "preset", size: "small" },
      previewLines: 3,
      collapseKind: "preview",
    };
    const html = renderSizable(t);
    expect(html).toContain('data-preview-lines="3"');
    expect(html).toContain("cb-code--size-small");
    expect(mdOf(html)).toContain("```javascript small preview=3");
  });
});
