import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LibraryAccess } from "@/darkroom/access";
import type { LibrarySource, Page, PageRequest, Print } from "@/darkroom/types";

/**
 * The Post tab's roll as a hook, drawn with react-dom in node over a
 * library made up here: what it does when the tab comes back to the
 * front. Once the selected photograph has been posted (the Memory Room's
 * history says when), the mount moves on to the newest not yet posted;
 * a photograph posted before it was selected leaves the selection where
 * it is. Quick taps on the tab, while the newest is still being read,
 * join that read instead of asking Photos again and throwing the first
 * answer away. And a limited selection changed elsewhere (the Memory
 * Room's SHARE MORE) is read again in full the moment the tab is back,
 * not a minute later.
 */

const h = vi.hoisted(() => ({
  access: "full" as LibraryAccess,
  posted: new Map<string, number>(),
  sheets: 0,
  source: null as LibrarySource | null,
}));

vi.mock("react-native", () => ({
  AppState: { addEventListener: () => ({ remove() {} }) },
  Platform: { OS: "ios", select: (o: Record<string, unknown>) => o.ios ?? o.default },
}));
vi.mock("@/darkroom/access", () => ({
  readAccess: async () => h.access,
  requestAccess: async () => h.access,
  chooseMorePhotographs: async () => {
    h.sheets += 1;
  },
  selectionSheetsOpened: () => h.sheets,
  openPhotoSettings: () => undefined,
}));
vi.mock("@/darkroom/discovery", () => ({ gated: (s: LibrarySource) => s }));
vi.mock("@/darkroom/history", () => ({ developedAt: (id: string) => h.posted.get(id) ?? null }));
vi.mock("@/darkroom/source", () => ({ darkroomAvailable: () => true, darkroomSource: () => h.source }));
vi.mock("@/utils/appReturn", () => ({ onReturnFromBackground: () => () => undefined }));
vi.mock("@/utils/library", () => ({ watchLibrary: () => () => undefined }));
// The tab's slide is not waited for here; the wait itself is held by tests/post-settle.test.ts.
vi.mock("@/post/settle", () => ({
  TAB_SETTLE_MS: 0,
  afterTabSettles: (run: () => void) => {
    const t = setTimeout(run, 0);
    return () => clearTimeout(t);
  },
  tabSettled: async () => undefined,
}));

// react-dom in node, with nothing to draw into but a container it never writes to.
const g = globalThis as Record<string, unknown>;
g.IS_REACT_ACT_ENVIRONMENT = true;
g.window ??= globalThis;
g.HTMLIFrameElement ??= class {};
const doc = { nodeType: 9, addEventListener() {}, removeEventListener() {} };
const container = () => ({
  nodeType: 1,
  nodeName: "DIV",
  tagName: "DIV",
  namespaceURI: "http://www.w3.org/1999/xhtml",
  ownerDocument: doc,
  addEventListener() {},
  removeEventListener() {},
  textContent: "",
  firstChild: null,
  removeChild() {},
  appendChild() {},
});
const reactDomClient = "react-dom/client";
const { createRoot } = (await import(/* @vite-ignore */ reactDomClient)) as {
  createRoot: (container: unknown) => { render: (node: React.ReactNode) => void; unmount: () => void };
};
const { act } = await import("react");
const { useRoll } = await import("@/post/useRoll");
type Roll = ReturnType<typeof useRoll>;

const HOUR = 3_600_000;
function print(n: number, now: number): Print {
  return { id: `p${n}`, uri: `ph://p${n}`, width: 4032, height: 3024, takenAt: now - (n + 1) * HOUR, subtypes: [] };
}

/** A library of `count` photographs, newest first; each page can be held until let go. */
function library(count: number, now: number) {
  const all = Array.from({ length: count }, (_, i) => print(i, now));
  const share = (p: Print) => {
    all.push(p);
    all.sort((a, b) => b.takenAt - a.takenAt);
  };
  const asked: PageRequest[] = [];
  let hold = false;
  const waiting: (() => void)[] = [];
  const source: LibrarySource = {
    count: async () => all.length,
    oldest: async () => all[all.length - 1]?.takenAt ?? null,
    page: async (request: PageRequest): Promise<Page> => {
      asked.push(request);
      if (hold) await new Promise<void>((resolve) => waiting.push(resolve));
      const inRange = all.filter((p) => p.takenAt >= request.range.from && p.takenAt < request.range.to);
      return { prints: inRange.slice(0, request.first), hasNextPage: inRange.length > request.first };
    },
  };
  return {
    source,
    asked,
    share,
    hold: () => (hold = true),
    letGo: () => {
      hold = false;
      for (const go of waiting.splice(0)) go();
    },
  };
}

const settle = () => act(async () => new Promise<void>((r) => setTimeout(r, 5)));

async function drawRoll(focused: boolean) {
  let roll: Roll | null = null;
  function Probe({ focused }: { focused: boolean }) {
    roll = useRoll(focused);
    return null;
  }
  const root = createRoot(container());
  const draw = async (f: boolean) => {
    await act(async () => root.render(React.createElement(Probe, { focused: f })));
    await settle();
    await settle();
  };
  await draw(focused);
  return { roll: () => roll!, draw, unmount: () => act(async () => root.unmount()) };
}

beforeEach(() => {
  h.access = "full";
  h.posted.clear();
  h.sheets = 0;
});
afterEach(() => {
  h.source = null;
});

describe("the Post tab, back in front", () => {
  it("moves the mount off a photograph once it is posted, to the newest not yet posted", async () => {
    const now = Date.now();
    const lib = library(8, now);
    h.source = lib.source;
    const view = await drawRoll(true);
    expect(view.roll().phase).toBe("ready");
    expect(view.roll().selected?.id).toBe("p0");
    await act(async () => view.roll().select("p2"));
    expect(view.roll().selected?.id).toBe("p2");
    // Off to the editor, and posted: the room's history records it, after it was selected.
    await view.draw(false);
    h.posted.set("p2", Date.now() + 1_000);
    h.posted.set("p0", Date.now() + 1_000);
    await view.draw(true);
    // p0 was posted too: the newest not yet posted is p1.
    expect(view.roll().selected?.id).toBe("p1");
    await view.unmount();
  });

  it("keeps the selection when its photograph was posted before it was selected", async () => {
    const now = Date.now();
    const lib = library(8, now);
    h.source = lib.source;
    h.posted.set("p3", now - 10 * 60_000);
    const view = await drawRoll(true);
    await act(async () => view.roll().select("p3"));
    await view.draw(false);
    await view.draw(true);
    expect(view.roll().selected?.id).toBe("p3");
    await view.unmount();
  });
});

describe("tapping the Post tab again", () => {
  it("joins the read under way instead of asking Photos again for each tap", async () => {
    const now = Date.now();
    const lib = library(8, now);
    h.source = lib.source;
    const view = await drawRoll(true);
    const before = lib.asked.length;
    lib.hold();
    // Three quick taps: the first reads the newest, the next two join it.
    await act(async () => {
      view.roll().refresh();
    });
    await settle();
    await act(async () => {
      view.roll().refresh();
      view.roll().refresh();
    });
    await settle();
    expect(lib.asked.length - before).toBe(1);
    lib.letGo();
    await settle();
    expect(view.roll().phase).toBe("ready");
    expect(view.roll().prints).toHaveLength(8);
    // Once that read has answered, the next tap reads again.
    await act(async () => {
      view.roll().refresh();
    });
    await settle();
    expect(lib.asked.length - before).toBe(2);
    await view.unmount();
  });
});

describe("a limited selection changed in the Memory Room", () => {
  it("is read again in full once the tab is back, not a minute later", async () => {
    h.access = "limited";
    const now = Date.now();
    const lib = library(4, now);
    h.source = lib.source;
    const view = await drawRoll(true);
    expect(view.roll().prints.map((p) => p.id)).toEqual(["p0", "p1", "p2", "p3"]);
    await view.draw(false);
    // In the room, SHARE MORE: iOS's sheet, and an older photograph shared with VINTAGE.
    h.sheets += 1;
    lib.share({ ...print(9, now), id: "older" });
    await view.draw(true);
    expect(view.roll().prints.map((p) => p.id)).toEqual(["p0", "p1", "p2", "p3", "older"]);
    // Without a sheet opened meanwhile, a visit within the minute reads nothing again.
    const asked = lib.asked.length;
    await view.draw(false);
    await view.draw(true);
    expect(lib.asked.length).toBe(asked);
    await view.unmount();
  });
});
