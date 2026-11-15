/**
 * Unit tests for collapsing base64 data URLs in markdown image/embed targets
 * to short "[base64 data]" placeholders (and expanding them back).
 */
import {
  base64Placeholder,
  collapseBase64,
  expandBase64,
} from "@/lib/base64-placeholders";

describe("base64Placeholder", () => {
  it("numbers placeholders", () => {
    expect(base64Placeholder(1)).toBe("[base64 data]");
    expect(base64Placeholder(2)).toBe("[base64 data 2]");
    expect(base64Placeholder(7)).toBe("[base64 data 7]");
  });
});

describe("collapseBase64 / expandBase64", () => {
  it("collapses distinct payloads to numbered placeholders and restores", () => {
    const md =
      "![a](data:image/png;base64,AAAA){medium} and ![b](data:image/jpeg;base64,BBBB)";
    const { md: collapsed, store } = collapseBase64(md);
    expect(collapsed).toBe(
      "![a]([base64 data]){medium} and ![b]([base64 data 2])",
    );
    expect(expandBase64(collapsed, store)).toBe(md);
  });

  it("identical payloads share one placeholder", () => {
    const md =
      "![a](data:image/png;base64,AAAA) tail ![b](data:image/png;base64,AAAA)";
    const { md: collapsed, store } = collapseBase64(md);
    expect(collapsed).toBe(
      "![a]([base64 data]) tail ![b]([base64 data])",
    );
    expect(store.size).toBe(1);
    expect(expandBase64(collapsed, store)).toBe(md);
  });

  it("leaves unknown placeholders untouched on expand", () => {
    const { store } = collapseBase64("![a](data:image/png;base64,AAAA)");
    const md = "x ([base64 data 9]) y";
    expect(expandBase64(md, store)).toBe(md);
  });

  it("never substitutes placeholder-looking text outside the URL position", () => {
    const { store } = collapseBase64("![a](data:image/png;base64,AAAA)");
    const md = "escaped \\[base64 data\\] and bare [base64 data] here";
    expect(expandBase64(md, store)).toBe(md);
  });

  it("keeps newly pasted data: text that replaced a placeholder", () => {
    const { md: collapsed, store } = collapseBase64(
      "![a](data:image/png;base64,AAAA)",
    );
    const edited = collapsed.replace(
      "([base64 data])",
      "(data:image/gif;base64,CCCC)",
    );
    expect(expandBase64(edited, store)).toBe(edited);
    expect(edited).toContain("data:image/gif;base64,CCCC");
  });
});
