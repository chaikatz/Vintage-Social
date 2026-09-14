import { describe, expect, it, vi } from "vitest";
import { emitHomeAgain, onHomeAgain } from "@/utils/homeRefresh";

describe("tapping Home on Home", () => {
  it("reaches every listener, and no one who left", () => {
    const a = vi.fn();
    const b = vi.fn();
    const offA = onHomeAgain(a);
    onHomeAgain(b);
    emitHomeAgain();
    offA();
    emitHomeAgain();
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(2);
  });
});
