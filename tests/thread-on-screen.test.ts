import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { fromThreadOnScreen, threadOnScreen } from "../src/utils/threadOnScreen";

const read = (file: string) => readFileSync(path.resolve(__dirname, "..", file), "utf8");

/**
 * Each message files a notice (0040). While a thread is open, a message
 * notice from its member is not shown over it; one from anyone else is.
 */
describe("a message notice over the thread it belongs to", () => {
  const leaving: Array<() => void> = [];
  const open = (peer: string) => {
    const leave = threadOnScreen(peer);
    leaving.push(leave);
    return leave;
  };
  afterEach(() => {
    for (const leave of leaving.splice(0)) leave();
  });

  it("is not shown while that member's thread is in front", () => {
    open("ana");
    expect(fromThreadOnScreen({ kind: "message", actorId: "ana", route: "/messages" })).toBe(true);
  });

  it("is shown when it comes from somebody else, or is not a message", () => {
    open("ana");
    expect(fromThreadOnScreen({ kind: "message", actorId: "ben" })).toBe(false);
    expect(fromThreadOnScreen({ kind: "comment", actorId: "ana" })).toBe(false);
    expect(fromThreadOnScreen({ kind: "message" })).toBe(false);
    expect(fromThreadOnScreen(null)).toBe(false);
    expect(fromThreadOnScreen("message")).toBe(false);
  });

  it("is shown once no thread is in front, and a thread leaving does not clear another that came", () => {
    expect(fromThreadOnScreen({ kind: "message", actorId: "ana" })).toBe(false);
    const leaveAna = open("ana");
    const leaveBen = open("ben");
    leaveAna();
    expect(fromThreadOnScreen({ kind: "message", actorId: "ben" })).toBe(true);
    leaveBen();
    expect(fromThreadOnScreen({ kind: "message", actorId: "ben" })).toBe(false);
  });

  it("holds when a thread with the same member opens over another and the one below leaves after", () => {
    const below = open("ana");
    const above = open("ana");
    below();
    expect(fromThreadOnScreen({ kind: "message", actorId: "ana" })).toBe(true);
    above();
    expect(fromThreadOnScreen({ kind: "message", actorId: "ana" })).toBe(false);
  });

  it("is what the phone's handler asks, and the thread says when it is in front", () => {
    const push = read("src/utils/push.ts");
    expect(push).toMatch(/handleNotification: async \(notification\) => \{\s*const show = !fromThreadOnScreen\(notification\.request\.content\.data\);/);
    expect(push).toMatch(/shouldShowBanner: show,\s*shouldShowList: show,/);
    const thread = read("app/messages/[id].tsx");
    expect(thread).toMatch(/if \(!focused \|\| !peerId\) return;\s*return threadOnScreen\(peerId\);\s*\}, \[focused, peerId\]\);/);
    // The push function sends who it is from with every Activity notice.
    expect(read("supabase/functions/push/index.ts")).toMatch(/if \(actor\) data\.actorId = actor;/);
  });
});
