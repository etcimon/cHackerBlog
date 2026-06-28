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

  it("should preserve collapsible code blocks (.cb-code)", () => {
    const html = `<div class="cb-code collapsed" data-lines="10" data-preview-lines="2" data-collapse-kind="preview">
      <pre class="cb-code__pre" style="--cb-preview-lines:2"><code class="language-javascript hljs">const x = 5;</code></pre>
      <button class="cb-code__toggle" type="button" aria-label="Expand code"><svg class="cb-code__caret"></svg></button>
    </div>`;
    const markdown = turndown.turndown(html);
    // Should preserve the code block content
    expect(markdown).toContain("const x = 5;");
    // Should not leak the toggle bar into markdown
    expect(markdown).not.toContain("cb-code__caret");
  });

  it("should preserve expanded collapsible code blocks (.cb-code)", () => {
    const html = `<div class="cb-code expanded" data-lines="10" data-preview-lines="2" data-collapse-kind="preview">
      <pre class="cb-code__pre" style="--cb-preview-lines:2"><code class="language-javascript hljs">const x = 5;</code></pre>
      <button class="cb-code__toggle" type="button" aria-label="Collapse code"><svg class="cb-code__caret"></svg></button>
    </div>`;
    const markdown = turndown.turndown(html);
    expect(markdown).toContain("const x = 5;");
    expect(markdown).toContain("```javascript preview=2");
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
    const html = `<div class="cb-code collapsed" data-lines="3" data-preview-lines="2" data-collapse-kind="preview">
      <pre class="cb-code__pre" style="--cb-preview-lines:2"><code class="language-javascript hljs">const x = 5;
const y = 10;
const z = 15;</code></pre>
      <button class="cb-code__toggle" type="button" aria-label="Expand code"><svg class="cb-code__caret"></svg></button>
    </div>`;
    const markdown = turndown.turndown(html);
    expect(markdown).toContain("```javascript preview=2");
    expect(markdown).toContain("const x = 5;");
  });

  it("should preserve a size preset together with preview=N", () => {
    const html = `<div class="cb-code collapsed cb-code--size-small" data-lines="6" data-preview-lines="3" data-collapse-kind="preview" data-size="small" style="--cb-preview-lines:3">
      <div class="cb-code__header"><span class="cb-code__lang-icon"><svg></svg></span><span class="cb-code__lang">TypeScript</span></div>
      <pre class="cb-code__pre"><code class="language-typescript hljs">const a = 1;</code></pre>
      <button class="cb-code__toggle" type="button"><svg class="cb-code__caret"></svg></button>
    </div>`;
    const markdown = turndown.turndown(html);
    expect(markdown).toContain("```typescript small preview=3");
    expect(markdown).toContain("const a = 1;");
    // Header label must not leak into the markdown output.
    expect(markdown).not.toContain("TypeScript");
  });

  it("should preserve a width= size on a non-collapsible block", () => {
    const html = `<div class="cb-code cb-code--size-pixels" data-lines="1" data-size="width=300" style="max-width:300px;">
      <div class="cb-code__header"><span class="cb-code__lang">Python</span></div>
      <pre class="cb-code__pre"><code class="language-python hljs">x = 1</code></pre>
    </div>`;
    const markdown = turndown.turndown(html);
    expect(markdown).toContain("```python width=300");
    expect(markdown).toContain("x = 1");
  });

  it("should preserve collapse=N parameter (alias of preview)", () => {
    const html = `<div class="cb-code collapsed" data-lines="3" data-preview-lines="2" data-collapse-kind="collapse">
      <pre class="cb-code__pre" style="--cb-preview-lines:2"><code class="language-python hljs">a = 1
b = 2
c = 3</code></pre>
      <button class="cb-code__toggle" type="button" aria-label="Expand code"><svg class="cb-code__caret"></svg></button>
    </div>`;
    const markdown = turndown.turndown(html);
    expect(markdown).toContain("```python collapse=2");
    expect(markdown).toContain("a = 1");
  });
});
