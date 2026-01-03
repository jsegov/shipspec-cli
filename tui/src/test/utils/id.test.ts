import { describe, expect, it } from "bun:test";
import { createId } from "../../utils/id.js";

describe("createId", () => {
  it("returns a string", () => {
    const id = createId();
    expect(typeof id).toBe("string");
  });

  it("returns valid UUID format", () => {
    const id = createId();
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    expect(id).toMatch(uuidRegex);
  });

  it("returns unique values on multiple calls", () => {
    const ids = new Set<string>();
    for (let i = 0; i < 100; i++) {
      ids.add(createId());
    }
    expect(ids.size).toBe(100);
  });
});
