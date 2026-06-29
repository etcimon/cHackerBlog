/**
 * Unit tests for social sharing network builders.
 * These are pure, client-safe functions that generate intent URLs.
 */
import { buildShareTargets, toNativeShareData, toHashtags, type SharePayload } from "@/lib/sharing/networks";

describe("toHashtags", () => {
  it("should convert comma-separated keywords to hashtag array", () => {
    expect(toHashtags("react, typescript, web")).toEqual(["react", "typescript", "web"]);
  });

  it("should trim whitespace and remove special characters", () => {
    expect(toHashtags("react-js, typescript, web dev")).toEqual(["reactjs", "typescript", "webdev"]);
  });

  it("should handle empty input", () => {
    expect(toHashtags("")).toEqual([]);
  });

  it("should handle undefined input", () => {
    expect(toHashtags(undefined)).toEqual([]);
  });

  it("should limit to 4 hashtags", () => {
    expect(toHashtags("a, b, c, d, e, f")).toEqual(["a", "b", "c", "d"]);
  });

  it("should filter out empty strings after cleaning", () => {
    expect(toHashtags("react, , , typescript")).toEqual(["react", "typescript"]);
  });
});

describe("toNativeShareData", () => {
  it("should convert payload to ShareData format", () => {
    const payload: SharePayload = {
      url: "https://example.com/article/test",
      title: "Test Article",
      description: "A test description",
    };
    const result = toNativeShareData(payload);
    expect(result).toEqual({
      title: "Test Article",
      text: "A test description",
      url: "https://example.com/article/test",
    });
  });

  it("should use title as text when description is missing", () => {
    const payload: SharePayload = {
      url: "https://example.com/article/test",
      title: "Test Article",
    };
    const result = toNativeShareData(payload);
    expect(result.text).toBe("Test Article");
  });
});

describe("buildShareTargets", () => {
  const basePayload: SharePayload = {
    url: "https://example.com/article/test-slug",
    title: "Test Article Title",
    description: "This is a test article description",
    keywords: "react, typescript, web",
    via: "testuser",
  };

  it("should build all share targets", () => {
    const targets = buildShareTargets(basePayload);
    expect(targets).toHaveLength(7);
    expect(targets.map((t) => t.id)).toEqual([
      "x",
      "facebook",
      "linkedin",
      "reddit",
      "whatsapp",
      "telegram",
      "email",
    ]);
  });

  it("should build X share URL with all parameters", () => {
    const targets = buildShareTargets(basePayload);
    const xTarget = targets.find((t) => t.id === "x");
    expect(xTarget).toBeDefined();
    expect(xTarget?.href).toContain("https://x.com/intent/tweet");
    expect(xTarget?.href).toContain("url=https%3A%2F%2Fexample.com%2Farticle%2Ftest-slug");
    expect(xTarget?.href).toContain("text=Test+Article+Title");
    expect(xTarget?.href).toContain("hashtags=react%2Ctypescript%2Cweb");
    expect(xTarget?.href).toContain("via=testuser");
  });

  it("should build X share URL without via when not provided", () => {
    const payload = { ...basePayload, via: null };
    const targets = buildShareTargets(payload);
    const xTarget = targets.find((t) => t.id === "x");
    expect(xTarget?.href).not.toContain("via=");
  });

  it("should build Facebook share URL with only URL parameter", () => {
    const targets = buildShareTargets(basePayload);
    const fbTarget = targets.find((t) => t.id === "facebook");
    expect(fbTarget).toBeDefined();
    expect(fbTarget?.href).toBe(
      "https://www.facebook.com/sharer/sharer.php?u=https%3A%2F%2Fexample.com%2Farticle%2Ftest-slug",
    );
  });

  it("should build LinkedIn share URL with only URL parameter", () => {
    const targets = buildShareTargets(basePayload);
    const liTarget = targets.find((t) => t.id === "linkedin");
    expect(liTarget).toBeDefined();
    expect(liTarget?.href).toBe(
      "https://www.linkedin.com/sharing/share-offsite/?url=https%3A%2F%2Fexample.com%2Farticle%2Ftest-slug",
    );
  });

  it("should build Reddit share URL with URL and title", () => {
    const targets = buildShareTargets(basePayload);
    const redditTarget = targets.find((t) => t.id === "reddit");
    expect(redditTarget).toBeDefined();
    expect(redditTarget?.href).toContain("url=https%3A%2F%2Fexample.com%2Farticle%2Ftest-slug");
    expect(redditTarget?.href).toContain("title=Test%20Article%20Title");
  });

  it("should build WhatsApp share URL with title and URL", () => {
    const targets = buildShareTargets(basePayload);
    const waTarget = targets.find((t) => t.id === "whatsapp");
    expect(waTarget).toBeDefined();
    expect(waTarget?.href).toContain("text=Test%20Article%20Title%20https%3A%2F%2Fexample.com%2Farticle%2Ftest-slug");
  });

  it("should build Telegram share URL with URL and title", () => {
    const targets = buildShareTargets(basePayload);
    const tgTarget = targets.find((t) => t.id === "telegram");
    expect(tgTarget).toBeDefined();
    expect(tgTarget?.href).toContain("url=https%3A%2F%2Fexample.com%2Farticle%2Ftest-slug");
    expect(tgTarget?.href).toContain("text=Test%20Article%20Title");
  });

  it("should build email share URL with subject and body", () => {
    const targets = buildShareTargets(basePayload);
    const emailTarget = targets.find((t) => t.id === "email");
    expect(emailTarget).toBeDefined();
    expect(emailTarget?.href).toContain("subject=Test%20Article%20Title");
    expect(emailTarget?.href).toContain("body=This%20is%20a%20test%20article%20description%0A%0Ahttps%3A%2F%2Fexample.com%2Farticle%2Ftest-slug");
  });

  it("should build email share URL without description when missing", () => {
    const payload = { ...basePayload, description: undefined };
    const targets = buildShareTargets(payload);
    const emailTarget = targets.find((t) => t.id === "email");
    expect(emailTarget?.href).toContain("body=https%3A%2F%2Fexample.com%2Farticle%2Ftest-slug");
  });

  it("should handle minimal payload with only required fields", () => {
    const minimalPayload: SharePayload = {
      url: "https://example.com/article/test",
      title: "Test",
    };
    const targets = buildShareTargets(minimalPayload);
    expect(targets).toHaveLength(7);
    targets.forEach((target) => {
      expect(target.href).toBeTruthy();
      expect(target.label).toBeTruthy();
      expect(target.brand).toBeTruthy();
    });
  });

  it("should have correct brand colors for each network", () => {
    const targets = buildShareTargets(basePayload);
    const brands = Object.fromEntries(targets.map((t) => [t.id, t.brand]));
    expect(brands.x).toBe("#000000");
    expect(brands.facebook).toBe("#1877F2");
    expect(brands.linkedin).toBe("#0A66C2");
    expect(brands.reddit).toBe("#FF4500");
    expect(brands.whatsapp).toBe("#25D366");
    expect(brands.telegram).toBe("#26A5E4");
    expect(brands.email).toBe("#6B7280");
  });
});
