import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { firstVisitPage, settingsPath } from "@/components/darkroom/words";
import { panelFor, panelWords, type PanelKind } from "@/post/panels";

/**
 * What the Post tab's mount says in each state of the library's access,
 * word for word; that full and limited access with a roll to show have no
 * panel at all; and that the tab's one way of asking iOS for the library
 * is the tap on its own explanation.
 */

const root = path.resolve(import.meta.dirname, "..");
const code = (f: string) =>
  readFileSync(path.join(root, f), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");

describe("which panel the mount shows", () => {
  const at = (phase: Parameters<typeof panelFor>[0]["phase"], access: Parameters<typeof panelFor>[0]["access"], empty = false, available = true) =>
    panelFor({ available, phase, access, empty });

  it("shows the photograph, and no panel, when there is a roll to show", () => {
    expect(at("ready", "full")).toBeNull();
    expect(at("ready", "limited")).toBeNull();
  });

  it("shows a panel for every other state", () => {
    expect(at("waiting", null)).toBe("waiting");
    expect(at("loading", "full")).toBe("loading");
    expect(at("undetermined", "undetermined")).toBe("ask");
    expect(at("denied", "denied")).toBe("denied");
    expect(at("failed", "full")).toBe("failed");
    expect(at("ready", "full", true)).toBe("empty-full");
    expect(at("ready", "limited", true)).toBe("empty-limited");
    expect(at("unavailable", "unavailable")).toBe("unavailable");
    expect(at("waiting", null, false, false)).toBe("unavailable");
  });
});

describe("what each panel says", () => {
  it("explains before iOS asks, and asks only from the tap", () => {
    expect(panelWords("ask", 18)).toEqual({
      kind: "ask",
      eyebrow: "Your camera roll",
      headline: "Your photographs, right here.",
      body: "VINTAGE shows them on this iPhone only. Nothing leaves it until you post one.",
      bar: { label: "Continue", hint: "Asks to see your photo library.", act: "ask" },
      path: null,
      quiet: null,
    });
  });

  it("says where Settings keeps the way in, on the iOS it is", () => {
    const denied = panelWords("denied", 18)!;
    expect(denied).toMatchObject({
      eyebrow: "Your camera roll",
      headline: "VINTAGE can’t see your photographs.",
      body: "Choose one at a time from Library, or let VINTAGE in from Settings. It only ever reads on this iPhone.",
      // Refused, the mount's one bar still leads to a post: the picker, which needs no access.
      bar: { label: "Choose a photograph", hint: "Opens your photo library. Nothing is shared until you choose Share to VINTAGE.", act: "choose" },
      path: "Settings\u00A0› Apps\u00A0› VINTAGE\u00A0› Photos\u00A0› Full\u00A0Access",
      quiet: { label: "Open Settings", hint: "Opens VINTAGE’s page in Settings." },
    });
    expect(panelWords("denied", 17)!.path).toBe("Settings\u00A0› VINTAGE\u00A0› Photos\u00A0› Full\u00A0Access");
    // The room's own words for the way, with each step held together: it breaks only after a "›".
    for (const ios of [17, 18]) {
      const path = panelWords("denied", ios)!.path!;
      expect(path.replace(/\u00A0/g, " ")).toBe(settingsPath(ios));
      expect(path.split(" ").every((step) => !step.includes(" "))).toBe(true);
      expect(path.split(" ").slice(0, -1).every((step) => step.endsWith("›"))).toBe(true);
    }
  });

  it("tells an empty library from an empty selection, and the empty selection how to share more", () => {
    expect(panelWords("empty-full", 18)).toMatchObject({ headline: "Nothing here yet.", body: "Take one, and it will be the first.", bar: null });
    expect(panelWords("empty-limited", 18)).toMatchObject({
      headline: "Nothing shared with VINTAGE yet.",
      body: "Choose the photographs it may see. Nothing leaves this iPhone until you post one.",
      bar: { label: "Share more", hint: "Opens iOS’s list of the photographs VINTAGE may see.", act: "shareMore" },
    });
  });

  it("never shows a library that would not answer as an empty one", () => {
    expect(panelWords("failed", 18)).toMatchObject({
      headline: "Your photographs didn’t load.",
      body: "Try again in a moment.",
      bar: { label: "Try again", hint: "Reads your photographs again.", act: "retry" },
    });
  });

  it("is the picker's own page where there is no library to read, with the clip's limit under the ways", () => {
    expect(panelWords("unavailable", 0)).toMatchObject({
      eyebrow: "From your library",
      headline: "Share a photograph.",
      body: "The one you have in mind.",
      bar: { label: "Choose a photograph", hint: "Opens your photo library. Nothing is shared until you choose Share to VINTAGE.", act: "choose" },
    });
    const tab = code("app/(tabs)/create.tsx");
    const alone = tab.slice(tab.indexOf("if (!door) {"), tab.indexOf("const dim"));
    expect(alone).toMatch(/kind="unavailable"/);
    expect(alone).toMatch(/\{clipNote\}/);
    expect(tab).toMatch(/Platform\.OS !== "ios" \? \(/);
  });

  it("has no words for the two that are only a box", () => {
    for (const kind of ["loading", "waiting"] as PanelKind[]) expect(panelWords(kind, 18)).toBeNull();
  });
});

describe("asking iOS for the library", () => {
  it("is reachable only from the panel's CONTINUE", () => {
    const roll = code("src/post/useRoll.ts");
    expect(roll.match(/requestAccess\(/g)).toHaveLength(1);
    const ask = roll.slice(roll.indexOf("const ask = useCallback"), roll.indexOf("const shareMore = useCallback"));
    expect(ask).toContain("requestAccess()");
    // The mount's bar is the one way to `ask`, and only the ask panel's bar says so.
    const tab = code("app/(tabs)/create.tsx");
    expect(tab.match(/roll\.ask\(\)/g)).toHaveLength(1);
    expect(tab).toMatch(/if \(act === "ask"\) roll\.ask\(\);/);
    const acts = (["ask", "denied", "empty-full", "empty-limited", "failed", "unavailable"] as PanelKind[]).map((k) => panelWords(k, 18)?.bar?.act);
    expect(acts.filter((a) => a === "ask")).toHaveLength(1);
  });
});

describe("the one button before iOS's own prompt", () => {
  // Apple's Human Interface Guidelines (Privacy, pre-alert screens) and App Review's 5.1.1
  // rejections ask that the single button on a custom screen shown before the permission
  // alert say "Continue" or "Next", so it reads as a step to the alert and not as a second
  // "Allow". The app has two such screens: the Post tab's first panel and the room's first page.
  const neutral = /^(Continue|Next)$/;

  it("says Continue on the Post tab's panel, and is that panel's only control", () => {
    const ask = panelWords("ask", 18)!;
    expect(ask.bar?.act).toBe("ask");
    expect(ask.bar?.label).toMatch(neutral);
    expect(ask.quiet).toBeNull();
    // Every bar that leads to iOS's prompt is titled that way, whatever the panel.
    for (const k of ["ask", "denied", "empty-full", "empty-limited", "failed", "unavailable"] as PanelKind[]) {
      const bar = panelWords(k, 18)?.bar;
      if (bar?.act === "ask") expect(bar.label, k).toMatch(neutral);
    }
  });

  it("says Continue on the room's first page while iOS has not asked yet", () => {
    const words = firstVisitPage("undetermined").words;
    expect(words).toHaveLength(1);
    expect(words[0].label).toMatch(neutral);
  });
});
