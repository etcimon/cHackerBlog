/**
 * Unit tests for collapsing base64 data URLs in markdown image/embed targets
 * to short "[base64 data]" placeholders (and expanding them back).
 */
import {
  base64Placeholder,
  collapseBase64,
  expandBase64,
} from "@/lib/base64-placeholders";

const DATA_A =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
const DATA_B =
  "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";
const DATA_C =
  "data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==";
const DATA_C2 = "data:image/png;base64,QUJD";

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

  it("collapses and expands three different payloads plus a repeat", () => {
    const md = `![a](${DATA_A}){medium}\n\n![b](${DATA_B})\n\n![c](${DATA_C})\n\n![a2](${DATA_A})`;
    const { md: collapsed, store } = collapseBase64(md);
    expect(collapsed).toBe(
      "![a]([base64 data]){medium}\n\n![b]([base64 data 2])\n\n![c]([base64 data 3])\n\n![a2]([base64 data])",
    );
    expect(store.size).toBe(3);
    expect(store.get("[base64 data]")).toBe(DATA_A);
    expect(store.get("[base64 data 2]")).toBe(DATA_B);
    expect(store.get("[base64 data 3]")).toBe(DATA_C);
    expect(expandBase64(collapsed, store)).toBe(md);
  });

  it("keeps each placeholder bound to its own data when swapped", () => {
    const md = `![a](${DATA_A})\n\n![b](${DATA_B})`;
    const { md: collapsed, store } = collapseBase64(md);
    const swapped = collapsed
      .replace("![a]([base64 data])", "![a]([base64 data 2])")
      .replace("![b]([base64 data 2])", "![b]([base64 data])");
    expect(expandBase64(swapped, store)).toBe(
      `![a](${DATA_B})\n\n![b](${DATA_A})`,
    );
  });

  it("preserves a markdown title through collapse and expand", () => {
    const md = `![b](${DATA_B} "Second title")`;
    const { md: collapsed, store } = collapseBase64(md);
    expect(collapsed).toBe('![b]([base64 data] "Second title")');
    expect(expandBase64(collapsed, store)).toBe(md);
  });

  it("keeps fresh data pasted over one placeholder while others expand", () => {
    const md = `![a](${DATA_A}){medium}\n\n![b](${DATA_B})\n\n![c](${DATA_C})\n\n![a2](${DATA_A})`;
    const { md: collapsed, store } = collapseBase64(md);
    const edited = collapsed.replace(
      "![c]([base64 data 3])",
      `![c](${DATA_C2})`,
    );
    expect(expandBase64(edited, store)).toBe(
      `![a](${DATA_A}){medium}\n\n![b](${DATA_B})\n\n![c](${DATA_C2})\n\n![a2](${DATA_A})`,
    );
  });
});
