import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { postAge, postedAgo, postedAgoSpoken } from "@/utils/time";

/**
 * When a post went up: the words at the foot of a feed card, the one clock
 * that keeps them current, and where the card puts them.
 */

// The phone's AppState, held in the test's hand.
const phone = vi.hoisted(() => ({
  state: "active" as string,
  listeners: [] as ((state: string) => void)[],
}));

vi.mock("react-native", () => ({
  AppState: {
    get currentState() {
      return phone.state;
    },
    addEventListener: (_type: string, listener: (state: string) => void) => {
      phone.listeners.push(listener);
      return { remove: () => (phone.listeners = phone.listeners.filter((l) => l !== listener)) };
    },
  },
}));

/** Moves the app to `state`, as iOS would. */
function appGoes(state: string): void {
  phone.state = state;
  for (const listener of [...phone.listeners]) listener(state);
}

const SECOND = 1_000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** Noon on 28 August 2026, local time, so the dates below read the same in any zone. */
const now = new Date(2026, 7, 28, 12, 0, 0);
const ago = (ms: number) => new Date(now.getTime() - ms).toISOString();
const local = (y: number, m: number, d: number) => new Date(y, m, d, 12, 0, 0).toISOString();

describe("postedAgo", () => {
  it("says the first minute as just now", () => {
    expect(postedAgo(ago(0), now)).toBe("Just now");
    expect(postedAgo(ago(59 * SECOND), now)).toBe("Just now");
    expect(postedAgo(ago(59 * SECOND + 999), now)).toBe("Just now");
  });

  it("counts minutes from the sixtieth second", () => {
    expect(postedAgo(ago(60 * SECOND), now)).toBe("1m ago");
    expect(postedAgo(ago(29 * MINUTE), now)).toBe("29m ago");
    expect(postedAgo(ago(29 * MINUTE + 59 * SECOND), now)).toBe("29m ago");
    expect(postedAgo(ago(30 * MINUTE), now)).toBe("30m ago");
    expect(postedAgo(ago(59 * MINUTE + 59 * SECOND), now)).toBe("59m ago");
  });

  it("counts hours from the sixtieth minute", () => {
    expect(postedAgo(ago(60 * MINUTE), now)).toBe("1h ago");
    expect(postedAgo(ago(5 * HOUR), now)).toBe("5h ago");
    expect(postedAgo(ago(24 * HOUR - SECOND), now)).toBe("23h ago");
  });

  it("counts days from the twenty-fourth hour, for under a week", () => {
    expect(postedAgo(ago(24 * HOUR), now)).toBe("1d ago");
    expect(postedAgo(ago(3 * DAY), now)).toBe("3d ago");
    expect(postedAgo(ago(7 * DAY - SECOND), now)).toBe("6d ago");
  });

  it("gives the day it was posted from a week on, with the year once it was another year", () => {
    expect(postedAgo(ago(7 * DAY), now)).toBe("Aug 21");
    expect(postedAgo(local(2026, 9, 3), new Date(2026, 9, 20, 12))).toBe("Oct 3");
    expect(postedAgo(local(2026, 0, 1), now)).toBe("Jan 1");
    expect(postedAgo(local(2025, 9, 3), now)).toBe("Oct 3, 2025");
    expect(postedAgo(local(1999, 11, 31), now)).toBe("Dec 31, 1999");
  });

  it("reads the year against today's, across New Year", () => {
    const newYear = new Date(2027, 0, 2, 12, 0, 0);
    // Four days back is still days, whatever year it was.
    expect(postedAgo(local(2026, 11, 29), newYear)).toBe("4d ago");
    expect(postedAgo(local(2026, 11, 20), newYear)).toBe("Dec 20, 2026");
    // And a week into the new year, the year's own posts drop the year.
    expect(postedAgo(local(2027, 0, 1), new Date(2027, 0, 9, 12))).toBe("Jan 1");
  });

  it("says a time ahead of the phone's clock as just now", () => {
    expect(postedAgo(ago(-5 * SECOND), now)).toBe("Just now");
    expect(postedAgo(ago(-3 * HOUR), now)).toBe("Just now");
    expect(postedAgo(ago(-400 * DAY), now)).toBe("Just now");
  });

  it("reads the time now when it is not given one", () => {
    expect(postedAgo(new Date(Date.now() - 2 * HOUR).toISOString())).toBe("2h ago");
  });
});

describe("postedAgoSpoken", () => {
  it("says it in full, in the singular where it is one", () => {
    expect(postedAgoSpoken(ago(59 * SECOND), now)).toBe("Posted just now");
    expect(postedAgoSpoken(ago(60 * SECOND), now)).toBe("Posted 1 minute ago");
    expect(postedAgoSpoken(ago(29 * MINUTE), now)).toBe("Posted 29 minutes ago");
    expect(postedAgoSpoken(ago(60 * MINUTE), now)).toBe("Posted 1 hour ago");
    expect(postedAgoSpoken(ago(5 * HOUR), now)).toBe("Posted 5 hours ago");
    expect(postedAgoSpoken(ago(24 * HOUR), now)).toBe("Posted 1 day ago");
    expect(postedAgoSpoken(ago(7 * DAY - SECOND), now)).toBe("Posted 6 days ago");
  });

  it("names the month in full", () => {
    expect(postedAgoSpoken(ago(7 * DAY), now)).toBe("Posted August 21");
    expect(postedAgoSpoken(local(2026, 9, 3), new Date(2026, 9, 20, 12))).toBe("Posted October 3");
    expect(postedAgoSpoken(local(2025, 9, 3), now)).toBe("Posted October 3, 2025");
  });

  it("is said of a time ahead of the clock as just now", () => {
    expect(postedAgoSpoken(ago(-2 * HOUR), now)).toBe("Posted just now");
  });

  it("always agrees with the written line", () => {
    for (const ms of [0, 59_999, 60_000, 3_599_999, 3_600_000, DAY - 1, DAY, 7 * DAY - 1, 7 * DAY, 400 * DAY]) {
      const written = postedAgo(ago(ms), now);
      const said = postedAgoSpoken(ago(ms), now);
      const n = written.match(/^(\d+)[mhd] ago$/)?.[1];
      if (n) expect(said).toMatch(new RegExp(`^Posted ${n} (minute|hour|day)s? ago$`));
      else if (written === "Just now") expect(said).toBe("Posted just now");
      else expect(said.startsWith("Posted ")).toBe(true);
    }
  });
});

describe("postAge, which shares the reckoning", () => {
  it("still says it the short way, at the same boundaries", () => {
    expect(postAge(ago(59 * SECOND + 999), now)).toBe("now");
    expect(postAge(ago(60 * SECOND), now)).toBe("1m");
    expect(postAge(ago(59 * MINUTE + 59 * SECOND), now)).toBe("59m");
    expect(postAge(ago(60 * MINUTE), now)).toBe("1h");
    expect(postAge(ago(24 * HOUR - SECOND), now)).toBe("23h");
    expect(postAge(ago(24 * HOUR), now)).toBe("1d");
    expect(postAge(ago(7 * DAY - SECOND), now)).toBe("6d");
    expect(postAge(ago(7 * DAY), now)).toBe("Aug 21");
    expect(postAge(local(2025, 9, 3), now)).toBe("Oct 3, 2025");
    expect(postAge(ago(-3 * HOUR), now)).toBe("now");
  });
});

// ---------------------------------------------------------------------------

describe("the minute clock", () => {
  // A fresh clock for each test: it is one per app, held in the module.
  async function freshClock() {
    vi.resetModules();
    return (await import("@/utils/useMinute")).minuteClock;
  }

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
    phone.state = "active";
    phone.listeners = [];
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("is one timer, and one AppState listener, however many lines follow it", async () => {
    const clock = await freshClock();
    const leave = [1, 2, 3, 4, 5].map(() => clock.subscribe(() => undefined));
    expect(vi.getTimerCount()).toBe(1);
    expect(phone.listeners).toHaveLength(1);
    for (const off of leave) off();
  });

  it("moves on once a minute, and tells every line at once", async () => {
    const clock = await freshClock();
    const heard = [0, 0, 0];
    const leave = heard.map((_, i) => clock.subscribe(() => (heard[i] += 1)));
    const start = clock.get();
    expect(start).toBe(now.getTime());

    vi.advanceTimersByTime(MINUTE - 1);
    expect(heard).toEqual([0, 0, 0]);
    expect(clock.get()).toBe(start);

    vi.advanceTimersByTime(1);
    expect(heard).toEqual([1, 1, 1]);
    expect(clock.get()).toBe(start + MINUTE);

    vi.advanceTimersByTime(29 * MINUTE);
    expect(heard).toEqual([30, 30, 30]);
    expect(clock.get()).toBe(start + 30 * MINUTE);
    for (const off of leave) off();
  });

  it("holds its time between ticks, so a page drawn twice in a minute is drawn the same", async () => {
    const clock = await freshClock();
    const off = clock.subscribe(() => undefined);
    const first = clock.get();
    vi.advanceTimersByTime(45 * SECOND);
    expect(clock.get()).toBe(first);
    expect(clock.get()).toBe(clock.get());
    off();
  });

  it("stops when the last line goes", async () => {
    const clock = await freshClock();
    const heard: number[] = [];
    const a = clock.subscribe(() => heard.push(1));
    const b = clock.subscribe(() => heard.push(2));
    a();
    expect(vi.getTimerCount()).toBe(1);
    b();
    // Leaving twice changes nothing.
    b();
    expect(vi.getTimerCount()).toBe(0);
    expect(phone.listeners).toHaveLength(0);
    vi.advanceTimersByTime(10 * MINUTE);
    expect(heard).toEqual([]);
  });

  it("does not tick in the background, and reads the time at once when the app is back", async () => {
    const clock = await freshClock();
    let heard = 0;
    const off = clock.subscribe(() => (heard += 1));

    appGoes("inactive");
    expect(vi.getTimerCount()).toBe(1);
    appGoes("background");
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(90 * MINUTE);
    expect(heard).toBe(0);
    expect(clock.get()).toBe(now.getTime());

    appGoes("active");
    expect(heard).toBe(1);
    expect(clock.get()).toBe(now.getTime() + 90 * MINUTE);
    expect(vi.getTimerCount()).toBe(1);

    // And it keeps time from there, still one timer.
    appGoes("active");
    expect(heard).toBe(1);
    expect(vi.getTimerCount()).toBe(1);
    vi.advanceTimersByTime(MINUTE);
    expect(heard).toBe(2);
    off();
  });

  it("waits for the app to come to the front when it is first followed in the background", async () => {
    phone.state = "background";
    const clock = await freshClock();
    let heard = 0;
    const off = clock.subscribe(() => (heard += 1));
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(5 * MINUTE);
    expect(heard).toBe(0);
    appGoes("active");
    expect(heard).toBe(1);
    expect(vi.getTimerCount()).toBe(1);
    off();
  });

  it("gives the first line after a quiet spell the time afresh", async () => {
    const clock = await freshClock();
    const off = clock.subscribe(() => undefined);
    off();
    vi.setSystemTime(now.getTime() + 3 * HOUR);
    expect(clock.get()).toBe(now.getTime() + 3 * HOUR);
    // Asked again in the same minute, the answer is the same.
    vi.setSystemTime(now.getTime() + 3 * HOUR + 30 * SECOND);
    expect(clock.get()).toBe(now.getTime() + 3 * HOUR);
  });

  it("is read through useSyncExternalStore", () => {
    const hook = code("src/utils/useMinute.ts");
    expect(hook).toMatch(/useSyncExternalStore\(minuteClock\.subscribe, minuteClock\.get, minuteClock\.get\)/);
  });
});

// ---------------------------------------------------------------------------

const root = path.resolve(import.meta.dirname, "..");

/** The source without its comments, so prose that names what is not done is not taken as doing it. */
function code(file: string): string {
  return readFileSync(path.join(root, file), "utf8")
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

describe("the feed card's posted time", () => {
  const card = code("src/components/PostCard.tsx");
  const body = card.slice(card.indexOf("export function PostCard("), card.indexOf("function PostedTime("));
  const line = card.slice(card.indexOf("function PostedTime("), card.indexOf("export function Byline("));

  it("is the last thing on the card, after the caption and the comments", () => {
    expect(body.length).toBeGreaterThan(0);
    const posted = body.indexOf("<PostedTime ");
    expect(posted).toBeGreaterThan(body.indexOf("{post.caption ? ("));
    expect(posted).toBeGreaterThan(body.indexOf("{preview.map("));
    expect(posted).toBeGreaterThan(body.indexOf("{hidden > 0 ? ("));
    expect(body).toMatch(/<PostedTime at=\{post\.created_at\} \/>\s*<\/View>\s*\);\s*\}\s*$/);
    expect(body.match(/<PostedTime\b/g)).toHaveLength(1);
  });

  it("says when it was posted, not when it was taken, and says it in full to a screen reader", () => {
    expect(line).toMatch(/accessibilityLabel=\{postedAgoSpoken\(at, now\)\}/);
    expect(line).toMatch(/\{postedAgo\(at, now\)\}/);
    expect(line).not.toMatch(/taken_at/);
  });

  it("is set in the byline's type, a shade fainter", () => {
    expect(line).toMatch(/style=\{\[styles\.meta, styles\.posted\]\}/);
    const posted = card.match(/^ {2}posted: \{[\s\S]*?\n {2}\},/m)?.[0] ?? "";
    expect(posted).toMatch(/color: colors\.inkFaint/);
  });

  it("follows the app's one clock, and starts no timer of its own", () => {
    expect(line).toMatch(/const now = new Date\(useMinute\(\)\);/);
    // Only the line follows the clock, so a tick draws the line again, not the card and its picture.
    expect(body).not.toMatch(/useMinute\(/);
    expect(card).not.toMatch(/\bset(Interval|Timeout)\(/);
    expect(card).not.toMatch(/\bAppState\b/);
    const clock = code("src/utils/useMinute.ts");
    expect(clock.match(/setInterval\(/g)).toHaveLength(1);
    expect(clock).toMatch(/const MINUTE = 60_000;/);
  });
});
