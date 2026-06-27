/**
 * Test for code block round-trip conversion between wysiwyg and markdown.
 * Ensures that code blocks with preview functionality are properly preserved
 * when converting HTML back to markdown.
 */
import TurndownService from "turndown";
import { addEmbedTurndownRule } from "@/lib/embeds";

describe("Code Block Round-trip Conversion", () => {
  const turndown = new TurndownService({ headingStyle: "atx" });
  addEmbedTurndownRule(turndown);

  it("should preserve simple code blocks", () => {
    const html = `<pre><code class="language-javascript">const x = 5;</code></pre>`;
    const markdown = turndown.turndown(html);
    expect(markdown).toContain("```javascript");
    expect(markdown).toContain("const x = 5;");
    expect(markdown).toContain("```");
  });

  it("should preserve code blocks with collapsed class", () => {
    const html = `<div class="code-block-wrapper collapsed" data-lines="10">
      <pre><code class="language-javascript">const x = 5;</code></pre>
      <button class="code-expand-btn" type="button">
        <span class="icon"><svg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><polyline points='6 9 12 15 18 9'></polyline></svg></span>
        <span class="text">Expand</span>
      </button>
    </div>`;
    const markdown = turndown.turndown(html);
    // Should preserve the code block content
    expect(markdown).toContain("const x = 5;");
    // Should not include the button text in the code
    expect(markdown).not.toContain("Expand");
  });

  it("should preserve code blocks with expanded class", () => {
    const html = `<div class="code-block-wrapper expanded" data-lines="10">
      <pre><code class="language-javascript">const x = 5;</code></pre>
      <button class="code-expand-btn" type="button">
        <span class="icon"><svg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><polyline points='18 15 12 9 6 15'></polyline></svg></span>
        <span class="text">Collapse</span>
      </button>
    </div>`;
    const markdown = turndown.turndown(html);
    // Should preserve the code block content
    expect(markdown).toContain("const x = 5;");
    // Should not include the button text in the code
    expect(markdown).not.toContain("Collapse");
  });

  it("should preserve multi-line code blocks", () => {
    const html = `<pre><code class="language-javascript">const x = 5;
const y = 10;
const z = x + y;</code></pre>`;
    const markdown = turndown.turndown(html);
    expect(markdown).toContain("const x = 5;");
    expect(markdown).toContain("const y = 10;");
    expect(markdown).toContain("const z = x + y;");
  });

  it("should handle code blocks without language class", () => {
    const html = `<pre><code>plain text code</code></pre>`;
    const markdown = turndown.turndown(html);
    expect(markdown).toContain("```");
    expect(markdown).toContain("plain text code");
  });

  it("should preserve hljs class for syntax highlighted code", () => {
    const html = `<pre><code class="hljs language-javascript">const x = 5;</code></pre>`;
    const markdown = turndown.turndown(html);
    expect(markdown).toContain("```javascript");
    expect(markdown).toContain("const x = 5;");
  });

  it("should preserve preview=N parameter in code blocks", () => {
    const html = `<div class="code-block-wrapper collapsed" data-lines="10" data-preview-lines="2" style="--preview-lines: 2">
      <pre><code class="language-javascript">const x = 5;
const y = 10;
const z = 15;</code></pre>
      <button class="code-expand-btn" type="button">
        <span class="icon"><svg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><polyline points='6 9 12 15 18 9'></polyline></svg></span>
        <span class="text">Expand</span>
      </button>
    </div>`;
    const markdown = turndown.turndown(html);
    expect(markdown).toContain("```javascript preview=2");
    expect(markdown).toContain("const x = 5;");
    expect(markdown).not.toContain("Expand");
  });
});
