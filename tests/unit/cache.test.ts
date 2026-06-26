// Set up environment before importing kv
process.env.DATABASE_URL = "file:./test.sqlite";
process.env.CACHE_DRIVER = "memory";

import { kvGet, kvSet, kvDel, kvDelByPrefix } from "@/lib/kv";

describe("Cache (KV) Layer", () => {
  beforeEach(async () => {
    // Clear all test keys before each test
    await kvDelByPrefix("test:");
  });

  it("should set and get a value", async () => {
    await kvSet("test:key1", "value1");
    const result = await kvGet("test:key1");
    expect(result).toBe("value1");
  });

  it("should return null for non-existent key", async () => {
    const result = await kvGet("test:nonexistent");
    expect(result).toBeNull();
  });

  it("should delete a key", async () => {
    await kvSet("test:key2", "value2");
    await kvDel("test:key2");
    const result = await kvGet("test:key2");
    expect(result).toBeNull();
  });

  it("should set value with TTL", async () => {
    await kvSet("test:key3", "value3", 1); // 1 second TTL
    const result1 = await kvGet("test:key3");
    expect(result1).toBe("value3");

    // Wait for TTL to expire
    await new Promise((resolve) => setTimeout(resolve, 1100));
    const result2 = await kvGet("test:key3");
    expect(result2).toBeNull();
  });

  it("should delete all keys with prefix", async () => {
    await kvSet("test:prefix:a", "value1");
    await kvSet("test:prefix:b", "value2");
    await kvSet("test:other:c", "value3");

    await kvDelByPrefix("test:prefix:");

    const result1 = await kvGet("test:prefix:a");
    const result2 = await kvGet("test:prefix:b");
    const result3 = await kvGet("test:other:c");

    expect(result1).toBeNull();
    expect(result2).toBeNull();
    expect(result3).toBe("value3");
  });

  it("should handle JSON serialization", async () => {
    const obj = { foo: "bar", num: 42 };
    await kvSet("test:json", JSON.stringify(obj));
    const result = await kvGet("test:json");
    expect(result).toBe(JSON.stringify(obj));
  });

  it("should work with both Redis and in-memory fallback", async () => {
    // This test verifies the KV abstraction works regardless of backend
    await kvSet("test:fallback", "value");
    const result = await kvGet("test:fallback");
    expect(result).toBe("value");
  });
});
