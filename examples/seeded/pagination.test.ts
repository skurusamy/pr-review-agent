import { describe, expect, it } from "vitest";
import { formatRange, paginate } from "./pagination.js";

describe("formatRange", () => {
  it("shows the first and last item of a page", () => {
    expect(formatRange(2, 10, 47)).toBe("11-20 of 47");
  });

  it("does not run past the total on the last page", () => {
    expect(formatRange(5, 10, 47)).toBe("41-47 of 47");
  });

  it("handles an empty list", () => {
    expect(formatRange(1, 10, 0)).toBe("0 of 0");
  });
});

describe("paginate", () => {
  it("counts the pages", () => {
    const items = Array.from({ length: 47 }, (_, i) => i);
    expect(paginate(items, 1, 10).totalPages).toBe(5);
  });
});
