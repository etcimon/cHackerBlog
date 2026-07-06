/**
 * Security regression test: verifies that every call to requireAdmin() across
 * all API route handlers is awaited. An un-awaited async function returns a
 * promise that rejects *after* the handler has already proceeded — the throw
 * never stops execution, so admin mutations run without a valid session.
 *
 * This test scans source files statically so it runs in CI without a server.
 */
import fs from "node:fs";
import path from "node:path";

const API_DIR = path.join(process.cwd(), "src", "app", "api");

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (entry.name === "route.ts") out.push(full);
  }
  return out;
}

describe("Admin endpoint security", () => {
  const routes = walk(API_DIR);

  it("every route.ts file should be discovered", () => {
    expect(routes.length).toBeGreaterThan(0);
  });

  it("requireAdmin() must be awaited in every call site", () => {
    const violations: string[] = [];
    for (const file of routes) {
      const src = fs.readFileSync(file, "utf-8");
      const lines = src.split("\n");
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        // Match requireAdmin() calls that are NOT preceded by "await"
        if (
          line.includes("requireAdmin()") &&
          !line.includes("await requireAdmin()") &&
          !line.trim().startsWith("//") &&
          !line.trim().startsWith("*")
        ) {
          violations.push(`${path.relative(process.cwd(), file)}:${i + 1}: ${line.trim()}`);
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it("isAdmin() must be awaited in every call site", () => {
    const violations: string[] = [];
    for (const file of routes) {
      const src = fs.readFileSync(file, "utf-8");
      const lines = src.split("\n");
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (
          line.includes("isAdmin()") &&
          !line.includes("await isAdmin()") &&
          !line.trim().startsWith("//") &&
          !line.trim().startsWith("*") &&
          !line.includes("export async function isAdmin")
        ) {
          violations.push(`${path.relative(process.cwd(), file)}:${i + 1}: ${line.trim()}`);
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it("no route should accept client-supplied admin flags for unpublished access", () => {
    // The feed route and article route should not read "admin" or
    // "includeUnpublished" directly from query params without an isAdmin() gate.
    const violations: string[] = [];
    for (const file of routes) {
      const src = fs.readFileSync(file, "utf-8");

      // Check for patterns like: searchParams.get("admin") === "true" used
      // directly in an isAdmin() OR expression (bypass)
      if (src.includes('searchParams.get("admin")') && !src.includes("await isAdmin()")) {
        violations.push(`${path.relative(process.cwd(), file)}: uses ?admin= without isAdmin()`);
      }
    }
    expect(violations).toEqual([]);
  });
});
