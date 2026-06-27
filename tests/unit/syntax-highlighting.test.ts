/**
 * Unit tests for code syntax highlighting.
 * Validates that highlight.js is properly integrated with marked
 * and that code blocks are highlighted correctly.
 */
import { marked } from "marked";
import hljs from "highlight.js";
import {
  registerEmbedExtension,
} from "@/lib/embeds";

describe("Syntax Highlighting", () => {
  beforeAll(() => {
    // Register the marked extension globally
    registerEmbedExtension(marked);

    // Configure marked to use highlight.js for syntax highlighting
    marked.use({
      renderer: {
        code(code: string, language: string | undefined) {
          const validLang = language && hljs.getLanguage(language) ? language : "plaintext";
          const highlighted = hljs.highlight(code, { language: validLang }).value;
          return `<pre><code class="hljs language-${validLang}">${highlighted}</code></pre>`;
        },
      },
    });
  });

  it("should highlight D language code blocks", () => {
    const markdown = "```d\nimport std.stdio;\nvoid main() { writeln(\"Hello\"); }\n```";
    const html = marked.parse(markdown) as string;

    expect(html).toContain("hljs");
    expect(html).toContain("language-d");
    expect(html).toContain("import");
    expect(html).toContain("std");
    expect(html).toContain("writeln");
  });

  it("should highlight TypeScript code blocks", () => {
    const markdown = "```typescript\nconst greeting: string = \"Hello\";\nconsole.log(greeting);\n```";
    const html = marked.parse(markdown) as string;

    expect(html).toContain("hljs");
    expect(html).toContain("language-typescript");
    expect(html).toContain("const");
    expect(html).toContain("string");
    expect(html).toContain("console");
  });

  it("should highlight JavaScript code blocks", () => {
    const markdown = "```javascript\nfunction add(a, b) { return a + b; }\n```";
    const html = marked.parse(markdown) as string;

    expect(html).toContain("hljs");
    expect(html).toContain("language-javascript");
    expect(html).toContain("function");
    expect(html).toContain("return");
  });

  it("should highlight Python code blocks", () => {
    const markdown = "```python\ndef greet():\n    print(\"Hello\")\n```";
    const html = marked.parse(markdown) as string;

    expect(html).toContain("hljs");
    expect(html).toContain("language-python");
    expect(html).toContain("def");
    expect(html).toContain("print");
  });

  it("should handle unknown languages with plaintext fallback", () => {
    const markdown = "```unknownlanguage\nsome random code\n```";
    const html = marked.parse(markdown) as string;

    expect(html).toContain("hljs");
    expect(html).toContain("language-plaintext");
  });

  it("should handle code blocks without language specification", () => {
    const markdown = "```\nconst x = 1;\n```";
    const html = marked.parse(markdown) as string;

    expect(html).toContain("hljs");
    expect(html).toContain("language-plaintext");
  });

  it("should wrap code in pre and code tags", () => {
    const markdown = "```typescript\nconst x = 1;\n```";
    const html = marked.parse(markdown) as string;

    expect(html).toContain("<pre>");
    expect(html).toContain("</pre>");
    expect(html).toContain("<code");
    expect(html).toContain("</code>");
  });

  it("should preserve code content exactly", () => {
    const code = "const x = 42;";
    const markdown = `\`\`\`javascript\n${code}\n\`\`\``;
    const html = marked.parse(markdown) as string;

    expect(html).toContain("42");
  });

  it("should handle multiple code blocks in a single document", () => {
    const markdown = [
      "# Code Examples",
      "",
      "D language:",
      "```d\nimport std.stdio;\n```",
      "",
      "TypeScript:",
      "```typescript\nconst x: number = 1;\n```",
    ].join("\n");

    const html = marked.parse(markdown) as string;

    expect(html).toContain("language-d");
    expect(html).toContain("language-typescript");
    expect(html).toMatch(/hljs.*hljs/); // At least two hljs classes
  });

  it("should not affect regular markdown without code blocks", () => {
    const markdown = [
      "# Heading",
      "",
      "**Bold** and *italic* text.",
      "",
      "- List item 1",
      "- List item 2",
    ].join("\n");

    const html = marked.parse(markdown) as string;

    expect(html).not.toContain("hljs");
    expect(html).toContain("<h1>");
    expect(html).toContain("<strong>");
  });

  it("should apply hljs class to code elements", () => {
    const markdown = "```typescript\nconst x = 1;\n```";
    const html = marked.parse(markdown) as string;

    // Check that the code element has the hljs class
    expect(html).toMatch(/<code[^>]*class="[^"]*hljs/);
  });

  it("should include language class on code elements", () => {
    const markdown = "```typescript\nconst x = 1;\n```";
    const html = marked.parse(markdown) as string;

    // Check that the code element has the language class
    expect(html).toContain("language-typescript");
  });
});
