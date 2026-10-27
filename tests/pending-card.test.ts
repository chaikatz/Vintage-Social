import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  announcement,
  clipMayPlay,
  offersDiscard,
  offersRetry,
  statusAccessibility,
} from "@/components/pendingCardWords";
import { stateLine } from "@/uploads/words";
import type { PendingState } from "@/uploads/types";

/**
 * The pending card and the picture it shares with every post, without a
 * phone: what the card offers in each state, what VoiceOver hears and
 * when, and, read from the source, the few lines of PostMedia and the card
 * that have to stay the way they are.
 */

const MOVING: PendingState[] = ["preparing", "developing", "uploading", "saving", "waiting-network", "waiting-foreground"];

// ---------------------------------------------------------------------------
// What the card offers
// ---------------------------------------------------------------------------

describe("taking a post back", () => {
  it("is offered while nothing of it can have been published, whatever it is doing", () => {
    for (const state of [...MOVING, "queued"] as PendingState[]) {
      expect(offersDiscard({ state, canDiscard: true })).toBe(true);
    }
  });

  it("is not offered once the insert may have landed", () => {
    for (const state of [...MOVING, "queued", "done"] as PendingState[]) {
      expect(offersDiscard({ state, canDiscard: false })).toBe(false);
    }
  });

  it("is always offered beside Retry once it has failed", () => {
    expect(offersDiscard({ state: "failed", canDiscard: false })).toBe(true);
    expect(offersDiscard({ state: "failed", canDiscard: true })).toBe(true);
  });

  it("leaves Retry to a failure alone", () => {
    expect(offersRetry({ state: "failed" })).toBe(true);
    for (const state of [...MOVING, "queued", "done"] as PendingState[]) {
      expect(offersRetry({ state })).toBe(false);
    }
  });
});

describe("a pending clip", () => {
  it("does not play while it is prepared, developed, waiting its turn, or failed", () => {
    for (const state of ["preparing", "developing", "queued", "failed"] as PendingState[]) {
      expect(clipMayPlay(state)).toBe(false);
    }
  });

  it("plays once it has been developed", () => {
    for (const state of ["uploading", "saving", "waiting-network", "waiting-foreground", "done"] as PendingState[]) {
      expect(clipMayPlay(state)).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// What VoiceOver hears
// ---------------------------------------------------------------------------

describe("the state line, read aloud", () => {
  it("says the percent once, as the bar's value, and not again in the label", () => {
    for (const state of ["developing", "uploading"] as PendingState[]) {
      for (const kind of ["photo", "video"] as const) {
        const read = statusAccessibility(state, 0.62, kind);
        expect(read.role).toBe("progressbar");
        expect(read.value).toEqual({ min: 0, max: 100, now: 62 });
        expect(read.label).not.toMatch(/\d|percent|%/);
        const spoken = `${read.label} ${read.value?.now}%`;
        expect(spoken.match(/62/g)).toHaveLength(1);
      }
    }
  });

  it("has no value where there is no measure", () => {
    expect(statusAccessibility("uploading", null, "photo")).toEqual({
      role: "progressbar",
      label: "Your photograph, uploading",
      value: undefined,
    });
    expect(statusAccessibility("waiting-network", null, "video").value).toBeUndefined();
  });

  it("reads a failed or finished post as text, not as a bar that stopped", () => {
    expect(statusAccessibility("failed", 0.4, "photo")).toEqual({
      role: "text",
      label: "Your photograph couldn’t be posted",
      value: undefined,
    });
    expect(statusAccessibility("done", 1, "video")).toMatchObject({ role: "text", value: undefined });
  });
});

describe("announcing a change of state", () => {
  it("says the new state, without its percent, when Home is in front", () => {
    expect(announcement("developing", "uploading", "video", true)).toBe(stateLine("uploading", null, "video"));
    expect(announcement("uploading", "failed", "photo", true)).toBe("Couldn’t post.");
    expect(announcement("saving", "done", "photo", true)).toBe("Posted");
  });

  it("stays quiet while Home is behind another tab or screen", () => {
    for (const [from, to] of [
      ["developing", "uploading"],
      ["uploading", "saving"],
      ["saving", "done"],
      ["uploading", "failed"],
    ] as [PendingState, PendingState][]) {
      expect(announcement(from, to, "video", false)).toBeNull();
    }
  });

  it("says nothing when nothing changed, as when Home comes back to the front", () => {
    expect(announcement("uploading", "uploading", "photo", true)).toBeNull();
    expect(announcement("failed", "failed", "photo", true)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// The card and PostMedia, read from the source
// ---------------------------------------------------------------------------

const root = path.resolve(import.meta.dirname, "..");

/** The source without its comments, so prose that names what is not done is not taken as doing it. */
function code(file: string): string {
  return readFileSync(path.join(root, file), "utf8")
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

describe("the pending card", () => {
  const card = code("src/components/PendingPostCard.tsx");

  it("offers Discard, behind the same confirmation, whenever the post can still be taken back", () => {
    expect(card).toMatch(/const discard = offersDiscard\(pending\)/);
    const button = card.match(/\{discard \? \(\s*<Pressable[\s\S]*?<\/Pressable>/)?.[0] ?? "";
    expect(button).toMatch(/onPress=\{confirmDiscard\}/);
    expect(card).toMatch(/onPress: \(\) => void discardPost\(pending\.id\)/);
    // Discard is never only inside the failed branch again.
    expect(card).not.toMatch(/\{failed \? \(\s*<>/);
  });

  it("keeps Retry for a failure", () => {
    expect(card).toMatch(/const retry = offersRetry\(pending\)/);
    const button = card.match(/\{retry \? \(\s*<Pressable[\s\S]*?<\/Pressable>/)?.[0] ?? "";
    expect(button).toMatch(/retryPost\(pending\.id\)/);
  });

  it("announces only through `announcement`, and takes Home's focus, in front unless told otherwise", () => {
    expect(card).toMatch(/focused = true/);
    expect(card.match(/announceForAccessibility\(/g)).toHaveLength(1);
    expect(card).toMatch(/const words = announcement\(lastState\.current, state, draft\.kind, focused\)/);
    expect(card).toMatch(/accessibilityLiveRegion=\{focused \? "polite" : "none"\}/);
  });

  it("reads its line from `statusAccessibility`, so the percent is said once", () => {
    expect(card).not.toMatch(/accessibilityLine\(/);
    expect(card).toMatch(/accessibilityRole=\{spoken\.role\}/);
    expect(card).toMatch(/accessibilityLabel=\{spoken\.label\}/);
    expect(card).toMatch(/accessibilityValue=\{spoken\.value\}/);
  });

  it("gives PostMedia nothing to like", () => {
    const media = card.match(/<PostMedia[\s\S]*?\/>/)?.[0] ?? "";
    expect(media).not.toMatch(/onDoubleTap/);
    expect(media).toMatch(/clipMayPlay\(state\)/);
  });
});

describe("PostMedia", () => {
  const media = code("src/components/PostMedia.tsx");

  it("blooms the heart only where a double tap likes something", () => {
    const press = media.slice(media.indexOf("const handlePress"), media.indexOf("}, [bloom, onDoubleTap, isVideo]);"));
    expect(press.length).toBeGreaterThan(0);
    expect(press.match(/bloom\(\)/g)).toHaveLength(1);
    expect(press).toMatch(/if \(onDoubleTap\) \{\s*bloom\(\);\s*onDoubleTap\(\);\s*\}/);
    expect(press).not.toMatch(/onDoubleTap\?\.\(\)/);
  });

  it("keys the picture on what the caller says, the path when it says nothing", () => {
    expect(media).toMatch(/const pictureKey = recyclingKey \?\? post\.media_path;/);
    expect(media).toMatch(/recyclingKey=\{pictureKey\}/);
    expect(media).not.toMatch(/recyclingKey=\{post\.media_path\}/);
  });

  it("keeps a clip on the file it started on while the card is the same post and the file is there", () => {
    expect(media).toMatch(/const url = useSteadySource\(fresh, recyclingKey\);/);
    expect(media).toMatch(/useVideoPlayer\(url,/);
    const steady = media.slice(media.indexOf("function useSteadySource"), media.indexOf("function fileStillHere"));
    expect(steady).toMatch(/first\.key !== key/);
    expect(steady).toMatch(/startsWith\("file:"\)/);
    expect(steady).toMatch(/fileStillHere\(first\.uri\) \? first\.uri : fresh/);
    // A failed load is tried again at the post's own address, not the kept file.
    expect(media).toMatch(/player\.replaceAsync\(fresh\)/);
  });

  it("is keyed on the post's id in the feed card", () => {
    const card = code("src/components/PostCard.tsx");
    const media = card.match(/<PostMedia[\s\S]*?\/>/)?.[0] ?? "";
    expect(media).toMatch(/recyclingKey=\{post\.id\}/);
  });
});
