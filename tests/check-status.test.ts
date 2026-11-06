import { readFileSync } from "node:fs";
import path from "node:path";
import { QueryClient, QueryObserver, onlineManager } from "@tanstack/query-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { checkStatus } from "@/components/gate/checkStatus";
import { retryRead } from "@/utils/retry";

/**
 * The waiting room's "Check status" with no signal: the applicant's
 * application, read with the app's own query options (src/lib/queryClient.ts),
 * fails its first try and its further tries wait for the signal, neither
 * landing nor failing. The check is decided by the profile's read alone,
 * which gives up and says so.
 */

function applicationQuery({ held }: { held: boolean }) {
  const client = new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        networkMode: "offlineFirst",
        retry: retryRead,
        retryDelay: (attempt) => Math.min(800 * 2 ** attempt, 5000),
      },
    },
  });
  const key = ["my-application", "u1"];
  if (held) client.setQueryData(key, { status: "pending" });
  const reads: number[] = [];
  const observer = new QueryObserver(client, {
    queryKey: key,
    queryFn: async () => {
      reads.push(Date.now());
      if (!onlineManager.isOnline()) throw new TypeError("Network request failed");
      return { status: "approved" };
    },
  });
  // Mounted, as QueryClientProvider mounts the app's: told when the signal returns.
  client.mount();
  const stop = observer.subscribe(() => undefined);
  const unsubscribe = () => {
    stop();
    client.unmount();
  };
  return { client, observer, reads, unsubscribe };
}

/** The profile's read as the provider makes it offline: three tries, then false. */
async function profileGivesUp(): Promise<boolean> {
  for (let i = 0; i < 3; i++) await new Promise((r) => setTimeout(r, 800));
  return false;
}

async function settledWithin<T>(p: Promise<T>, ms: number): Promise<{ done: boolean; value?: T }> {
  const out: { done: boolean; value?: T } = { done: false };
  void p.then((value) => {
    out.done = true;
    out.value = value;
  });
  for (let t = 0; t < ms && !out.done; t += 100) await vi.advanceTimersByTimeAsync(100);
  return out;
}

beforeEach(() => {
  vi.useFakeTimers();
  onlineManager.setOnline(false);
});
afterEach(() => {
  onlineManager.setOnline(true);
  vi.useRealTimers();
});

describe("Check status, with no signal", () => {
  for (const held of [true, false]) {
    it(`finishes, and says it could not reach VINTAGE (application ${held ? "held" : "never read"})`, async () => {
      const { observer, reads, unsubscribe } = applicationQuery({ held });
      try {
        const check = await settledWithin(checkStatus(profileGivesUp, observer.refetch), 30_000);
        expect(check.done).toBe(true);
        expect(check.value).toBe(false);
        // The application was asked for, and waits for the signal.
        expect(reads.length).toBeGreaterThan(0);
        expect(observer.getCurrentResult().fetchStatus).toBe("paused");

        // As it was: the tap waited on the application too, and it never settled.
        const both = await settledWithin(Promise.all([profileGivesUp(), observer.refetch()]), 30_000);
        expect(both.done).toBe(false);

        // The signal back, the application lands by itself, and the screen's words with it.
        onlineManager.setOnline(true);
        await vi.advanceTimersByTimeAsync(100);
        expect(observer.getCurrentResult().data).toEqual({ status: "approved" });
        // Only now did the old way's tap finish.
        expect(both.done).toBe(true);
      } finally {
        unsubscribe();
      }
    });
  }

  it("the waiting room decides the check by the profile's read alone", () => {
    const pending = readFileSync(path.resolve(import.meta.dirname, "..", "app/(gate)/pending.tsx"), "utf8");
    expect(pending).toMatch(/const ok = await checkStatus\(refreshProfile, application\.refetch\);\s*setCheckFailed\(!ok\);\s*setCheckedAt\(new Date\(\)\);/);
    expect(pending).not.toMatch(/Promise\.all\(\[refreshProfile\(\), application\.refetch\(\)\]\)/);
  });
});
