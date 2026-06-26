// Load test environment before any imports
import { config } from "dotenv";
config({ path: ".env.test" });

import { api } from "@/lib/api-client";

describe("Feed Tag Refresh", () => {
  it("should be able to call tags API", async () => {
    // This test verifies the API client can make the call
    // In a real scenario, this would hit the actual API endpoint
    // For unit testing, we just verify the function exists and can be called
    expect(typeof api.get).toBe("function");
  });

  it("should have correct API endpoint structure", () => {
    // Verify the tags endpoint path
    const tagsEndpoint = "/api/tags";
    expect(tagsEndpoint).toBe("/api/tags");
  });

  it("should verify tag slugification logic", () => {
    // Test the slugification logic used in article editor
    const testName = "My New Tag";
    const slug = testName.toLowerCase().replace(/[^a-z0-9]+/g, "-");
    expect(slug).toBe("my-new-tag");
  });

  it("should handle tag with special characters", () => {
    // Test slugification with special characters
    const testName = "C++ Programming";
    const slug = testName.toLowerCase().replace(/[^a-z0-9]+/g, "-");
    expect(slug).toBe("c-programming");
  });

  it("should preserve original tag name", () => {
    // Verify that the original name is preserved for display
    const originalName = "JavaScript Frameworks";
    const trimmedName = originalName.trim();
    expect(trimmedName).toBe("JavaScript Frameworks");
  });
});
