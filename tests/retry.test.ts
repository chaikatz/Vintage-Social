import { describe, expect, it } from "vitest";
import { isTransient, withRetry } from "@/utils/retry";

/**
 * A post goes up in several requests. The retry decides which failures
 * are worth another go and which are a real refusal; get it wrong one way
 * and a dropped connection fails a photograph, the other and a policy
 * refusal is hammered three times.
 */
describe("what counts as transient", () => {
  it("retries the network letting go", () => {
    expect(isTransient(new TypeError("Network request failed"))).toBe(true);
    expect(isTransient(new Error("The request timed out"))).toBe(true);
    expect(isTransient(new Error("The Internet connection appears to be offline."))).toBe(true);
    expect(isTransient({ message: "Load failed" })).toBe(true);
  });

  it("retries a server that stumbled, and a rate limit", () => {
    expect(isTransient({ statusCode: 502, message: "Bad Gateway" })).toBe(true);
    expect(isTransient({ status: 503, message: "" })).toBe(true);
    expect(isTransient({ statusCode: 429, message: "Too many requests" })).toBe(true);
  });

  it("does not retry a refusal", () => {
    expect(isTransient({ statusCode: 403, message: "new row violates row-level security policy" })).toBe(false);
    expect(isTransient({ statusCode: 400, message: "Bad Request" })).toBe(false);
    expect(isTransient({ code: "23505", message: "duplicate key value violates unique constraint" })).toBe(false);
    expect(isTransient(null)).toBe(false);
  });
});

describe("withRetry", () => {
  const noSleep = async () => undefined;

  it("returns the first success", async () => {
    let calls = 0;
    const out = await withRetry(
      async (attempt) => {
        calls = attempt;
        if (attempt < 3) throw new TypeError("Network request failed");
        return "posted";
      },
      { sleep: noSleep },
    );
    expect(out).toBe("posted");
    expect(calls).toBe(3);
  });

  it("gives up after the attempts allowed, with the last error", async () => {
    let calls = 0;
    await expect(
      withRetry(
        async () => {
          calls++;
          throw new TypeError("Network request failed");
        },
        { attempts: 3, sleep: noSleep },
      ),
    ).rejects.toThrow("Network request failed");
    expect(calls).toBe(3);
  });

  it("stops at once on a refusal", async () => {
    let calls = 0;
    await expect(
      withRetry(
        async () => {
          calls++;
          throw { statusCode: 403, message: "new row violates row-level security policy" };
        },
        { sleep: noSleep },
      ),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(calls).toBe(1);
  });

  it("backs off, doubling", async () => {
    const waits: number[] = [];
    await withRetry(
      async (attempt) => {
        if (attempt < 3) throw new Error("timed out");
      },
      { baseDelayMs: 100, sleep: async (ms) => void waits.push(ms) },
    );
    expect(waits).toEqual([100, 200]);
  });
});
