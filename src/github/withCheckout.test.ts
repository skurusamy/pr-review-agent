import { describe, expect, it, vi } from "vitest";
import { withCheckout, type Checkout } from "./checkout.js";

function fakeCheckout(): Checkout {
  return {
    dir: "/tmp/x",
    headRef: "feature",
    headSha: "abc",
    push: async () => {},
    cleanup: vi.fn(async () => {}),
  };
}

describe("withCheckout", () => {
  it("returns the callback's result and cleans up afterwards", async () => {
    const checkout = fakeCheckout();
    const result = await withCheckout(
      async () => checkout,
      async (c) => c.headRef,
    );
    expect(result).toBe("feature");
    expect(checkout.cleanup).toHaveBeenCalledOnce();
  });

  it("cleans up when the callback throws, and rethrows", async () => {
    const checkout = fakeCheckout();
    await expect(
      withCheckout(
        async () => checkout,
        async () => {
          throw new Error("boom");
        },
      ),
    ).rejects.toThrow("boom");
    expect(checkout.cleanup).toHaveBeenCalledOnce();
  });
});
