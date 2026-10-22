import type { YearCount } from "@/darkroom/discovery";
import { captionFor, countLabel, fullDate, monthDay, monthName, monthYearWords, shortDay, yearsInWords } from "@/darkroom/labels";
import type { DarkroomMode, DayReach } from "@/darkroom/types";

/**
 * Every word the room says, in one place: chapter names, title cards,
 * the develop states, the placeholders, the word pages and the end pages,
 * and what VoiceOver hears. The copy deck is the spec's (§12), word for
 * word. Words are stored in sentence case; the type sets them in
 * capitals, so VoiceOver reads words and not letters. Typographer's
 * apostrophes and ellipses throughout, and never an exclamation mark.
 *
 * Pure: no React, no native modules, so the tests can read it back.
 */

export const LOOKING = "Looking through your library…";
export const DEVELOP_HINT = "Opens this photograph in the editor, to post.";
export const SET_ASIDE_HINT_OFF = "Keeps it on this iPhone to come back to. Nothing is posted.";
export const SET_ASIDE_HINT_ON = "Double-tap to put it back.";
export const SHELF_FULL = "The shelf is full. Put one back first.";
export const STAGE_LABEL = "Photograph";
export const STAGE_HINT = "Swipe up or down for the next or previous photograph.";
export const CONTENTS_HINT = "Choose a way in, a year or a month.";
export const CHAPTER_HINT = "Opens the contents.";

/** The running head's name for a chapter: "On this day" · "Surprise me" · "2016" · "Set aside". */
export function chapterName(mode: DarkroomMode, year: number | null): string {
  if (mode === "on-this-day") return "On this day";
  if (mode === "surprise") return "Surprise me";
  if (mode === "set-aside") return "Set aside";
  return year != null ? String(year) : "By year";
}

/** Said when the member changes chapter. */
export function chapterAnnouncement(mode: DarkroomMode, year: number | null, now: number): string {
  return mode === "on-this-day" ? `On this day, ${monthDay(now)}` : chapterName(mode, year);
}

/** A chapter's title card, while it is being dealt. Set aside has none: the shelf is always to hand. */
export function titleCardWords(
  mode: DarkroomMode,
  year: number | null,
  month: number,
  now: number,
): { eyebrow: string; title: string; year: boolean } | null {
  if (mode === "on-this-day") return { eyebrow: "On this day", title: monthDay(now), year: false };
  if (mode === "surprise") return { eyebrow: "Surprise me", title: "Any year", year: false };
  if (mode === "year" && year != null) {
    return { eyebrow: month > 0 ? `By year · from ${monthName(month)}` : "By year", title: String(year), year: true };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Develop states (§6.3)
// ---------------------------------------------------------------------------

/** Where a develop has got to, for the print in front of the member. */
export type DevelopState =
  | { kind: "idle" }
  /** Reading from the phone. `slow` once it has taken 400 ms. */
  | { kind: "working"; slow: boolean }
  /** The original lives in iCloud; waiting for the member to say. */
  | { kind: "inCloud"; network: "wifi" | "cellular" }
  /** Coming down from iCloud: a fraction when it can be measured, null when not. */
  | { kind: "downloading"; progress: number | null }
  | { kind: "offline" }
  | { kind: "cloudFailed" }
  | { kind: "missing" }
  | { kind: "unreadable" }
  /** The image itself said the photograph is gone: the plate says so, and DEVELOP follows. */
  | { kind: "gone" };

export type RightAct = "toggle" | "notNow" | "stop" | "remove";
export type BottomAct = "develop" | "download" | "retryLocal" | "retryCloud" | "shareMore" | "none";

export interface StateWords {
  /** In place of the date, or null for the date. */
  line1: string | null;
  /** In place of the phrase, or null for the phrase. */
  line2: string | null;
  /** Line 2 is the progress rule. */
  progress: boolean;
  /** The word at the caption's right, or none. */
  right: { label: string; act: RightAct; inert: boolean } | null;
  /** The word in DEVELOP's place. */
  bottom: {
    label: string;
    act: BottomAct;
    ruled: boolean;
    /** At 0.4. */
    dim: boolean;
    disabled: boolean;
    busy: boolean;
    /** Why it is dimmed, for VoiceOver. */
    reason: string | null;
  };
  /** Said aloud as the state arrives. */
  announce: string | null;
}

export interface StateContext {
  /** The print is on the shelf. */
  setAside: boolean;
  /** The room is showing the Set aside chapter, where the word reads PUT BACK. */
  shelfChapter: boolean;
  limited: boolean;
}

function toggleWord(ctx: StateContext, inert = false): StateWords["right"] {
  return { label: ctx.shelfChapter && ctx.setAside ? "Put back" : "Set aside", act: "toggle", inert };
}

const develop = (over: Partial<StateWords["bottom"]> = {}): StateWords["bottom"] => ({
  label: "Develop",
  act: "develop",
  ruled: true,
  dim: false,
  disabled: false,
  busy: false,
  reason: null,
  ...over,
});

const MISSING = {
  full: { line1: "No longer in your library", line2: "It may have been deleted." },
  limited: { line1: "No longer available", line2: "It may have been deleted, or it’s no longer shared with VINTAGE." },
};

/**
 * The words in the caption and DEVELOP positions for a state. The layout
 * never moves; only these change.
 */
export function stateWords(state: DevelopState, ctx: StateContext): StateWords {
  const base = { line1: null, line2: null, progress: false, announce: null };
  switch (state.kind) {
    case "idle":
      return { ...base, right: toggleWord(ctx), bottom: develop() };
    case "working":
      return state.slow
        ? { ...base, right: null, bottom: develop({ label: "Developing…", act: "none", busy: true }), announce: "Developing" }
        : { ...base, right: toggleWord(ctx, true), bottom: develop({ act: "none", busy: true }) };
    case "inCloud":
      return {
        ...base,
        line1: "Kept in iCloud",
        line2: state.network === "cellular" ? "Developing it will use mobile data." : "Developing it will download it.",
        right: { label: "Not now", act: "notNow", inert: false },
        bottom: develop({ label: "Download and develop", act: "download" }),
        announce: "Kept in iCloud",
      };
    case "downloading":
      return {
        ...base,
        line1: "Bringing it down from iCloud",
        progress: true,
        right: { label: "Stop", act: "stop", inert: false },
        bottom: develop({ label: "Developing…", act: "none", ruled: false, dim: true, busy: true }),
        announce: "Bringing it down from iCloud",
      };
    case "offline":
      return {
        ...base,
        line1: "Kept in iCloud",
        line2: "This iPhone is offline. Set it aside for later.",
        right: toggleWord(ctx),
        bottom: develop({ act: "none", dim: true, disabled: true, reason: "Kept in iCloud; this iPhone is offline." }),
        announce: "Kept in iCloud",
      };
    case "cloudFailed":
      return {
        ...base,
        line1: "iCloud didn’t send it",
        line2: "Try again when the connection is better.",
        right: toggleWord(ctx),
        bottom: develop({ label: "Try again", act: "retryCloud" }),
        announce: "iCloud didn’t send it",
      };
    case "missing":
    case "gone": {
      const words = ctx.limited ? MISSING.limited : MISSING.full;
      const quiet = state.kind === "gone";
      return {
        ...base,
        line1: quiet ? null : words.line1,
        line2: quiet ? null : words.line2,
        right: ctx.setAside ? { label: "Remove", act: "remove", inert: false } : null,
        bottom: ctx.limited
          ? develop({ label: "Share more", act: "shareMore" })
          : develop({ act: "none", dim: true, disabled: true, reason: `${words.line1}.` }),
        announce: quiet ? null : words.line1,
      };
    }
    case "unreadable":
      return {
        ...base,
        line1: "This one wouldn’t open",
        line2: "Try again, or set it aside.",
        right: toggleWord(ctx),
        bottom: develop({ label: "Try again", act: "retryLocal" }),
        announce: "This one wouldn’t open",
      };
  }
}

/**
 * Everything a print's caption says: the date (or a state's line 1), the
 * phrase (or a state's line 2, or the shelf-full line for its three
 * seconds), and the word at the right with its dot. `hold` keeps the
 * plate its size while any of that is not the print's own caption.
 */
export function captionWords(p: {
  takenAt: number;
  now: number;
  mode: DarkroomMode;
  reach: DayReach | null;
  postedAt: number | null;
  state: DevelopState;
  setAside: boolean;
  shelfChapter: boolean;
  limited: boolean;
  shelfFull: boolean;
}): {
  label: string;
  line: string;
  long: boolean;
  progress: boolean;
  word: { label: string; on: boolean; inert: boolean; hint?: string } | null;
  hold: boolean;
} {
  const caption = captionFor(p.takenAt, p.now, p.mode, p.reach, p.postedAt);
  const w = stateWords(p.state, { setAside: p.setAside, shelfChapter: p.shelfChapter, limited: p.limited });
  const toggle = w.right?.act === "toggle";
  return {
    label: w.line1 ?? caption.label,
    line: p.shelfFull ? SHELF_FULL : w.line2 ?? caption.line,
    long: caption.long,
    progress: w.progress,
    word: w.right
      ? {
          label: w.right.label,
          // The gold dot, in every chapter but the shelf, where every print is set aside.
          on: toggle && p.setAside && !p.shelfChapter,
          inert: w.right.inert,
          hint: toggle ? (p.setAside ? SET_ASIDE_HINT_ON : SET_ASIDE_HINT_OFF) : undefined,
        }
      : null,
    hold: p.state.kind !== "idle" || p.shelfFull,
  };
}

/** The stage's custom actions for VoiceOver: develop, the shelf, the caption thread, Contents. */
export function stageActions(takenAt: number | null, setAside: boolean): { name: string; label: string }[] {
  const year = takenAt != null ? new Date(takenAt).getFullYear() : null;
  return [
    { name: "develop", label: "Develop" },
    { name: "setAside", label: setAside ? "Put back" : "Set aside" },
    ...(year != null ? [{ name: "more", label: `More from ${year}` }] : []),
    { name: "contents", label: "Contents" },
  ];
}

// ---------------------------------------------------------------------------
// Placeholder plates (§9.4)
// ---------------------------------------------------------------------------

/** Why a plate shows no photograph: gone from the library, waiting for a connection, or anything else. */
export type PlateTrouble = "missing" | "offline" | "other";

export function placeholderWords(trouble: PlateTrouble, limited: boolean): { line1: string; line2: string } {
  if (trouble === "missing") return limited ? MISSING.limited : MISSING.full;
  if (trouble === "offline") return { line1: "In iCloud", line2: "It will appear when this iPhone is online." };
  return { line1: "Couldn’t show this one", line2: "Try it again later." };
}

// ---------------------------------------------------------------------------
// Word pages (§8, §9)
// ---------------------------------------------------------------------------

export type PageAct =
  | "continue"
  | "enter"
  | "openSettings"
  | "pickOne"
  | "library"
  | "surprise"
  | "chooseYear"
  | "retry"
  | "readOn"
  | "lookThroughYear"
  | "shareMore"
  | "choosePhotographs"
  | "anotherRoll"
  | "moreFrom"
  | "year"
  | "fromJanuary";

export interface PageWord {
  label: string;
  act: PageAct;
  /** For "year" and "lookThroughYear": which. */
  year?: number;
  hint?: string;
}

export interface PageWords {
  eyebrow: string;
  title: string;
  body?: string;
  /** A Settings path, set in folio capitals. */
  path?: string;
  foot?: string;
  /** In order; the first is ruled. */
  words: PageWord[];
  /** The first-visit page, set in the larger title. */
  threshold?: boolean;
}

const LIBRARY: PageWord = { label: "Choose from your library", act: "library" };
const SURPRISE: PageWord = { label: "Surprise me", act: "surprise" };
const CHOOSE_YEAR: PageWord = { label: "Choose a year", act: "chooseYear" };
const SHARE_MORE: PageWord = { label: "Share more photographs", act: "shareMore" };
const ALLOW_ALL: PageWord = { label: "Allow full access in Settings", act: "openSettings" };

export function firstVisitPage(access: "undetermined" | "granted"): PageWords {
  return {
    eyebrow: "The Darkroom",
    title: "One photograph at a time.",
    body: "This day in other years, a year at a time, or one from the back of the drawer.",
    foot: "VINTAGE looks through your library on this iPhone. Nothing leaves it unless you post it.",
    words:
      access === "undetermined"
        ? [{ label: "Continue", act: "continue", hint: "Asks to see your photo library." }]
        : [{ label: "Enter", act: "enter" }],
    threshold: true,
  };
}

/** iOS 18 moved an app's settings under Apps; the path says the way there for the phone in hand. */
export function settingsPath(iosMajor: number): string {
  return iosMajor >= 18 ? "Settings › Apps › VINTAGE › Photos › Full Access" : "Settings › VINTAGE › Photos › Full Access";
}

export function deniedPage(iosMajor: number): PageWords {
  return {
    eyebrow: "The Darkroom",
    title: "The door is shut.",
    body: "VINTAGE isn’t allowed to see your photo library, so there is nothing here to look through. You can let it in from Settings — it only ever reads on this iPhone.",
    path: settingsPath(iosMajor),
    words: [
      { label: "Open Settings", act: "openSettings" },
      { label: "Choose one photograph", act: "pickOne" },
    ],
  };
}

/** Why a chapter, or the room, has nothing to show. */
export type EmptyWhy =
  /** Full access, and no photographs at all. */
  | "library"
  /** Limited access, and the shared selection is empty. */
  | "selection"
  /** Limited access, and fewer than three to show. */
  | "few"
  /** Nothing older than ninety days. */
  | "tooNew"
  /** On this day was chosen, and found nothing even around the date. */
  | "day"
  /** The shelf is empty. */
  | "shelf"
  /** The library would not answer. */
  | "failed"
  /** Surprise has nothing left, even with every rule eased. */
  | "exhausted";

export function emptyPage(why: EmptyWhy, ctx: { now: number; limited: boolean }): PageWords {
  const thisYear = new Date(ctx.now).getFullYear();
  switch (why) {
    case "library":
      return {
        eyebrow: "The Darkroom",
        title: "Nothing to look through yet.",
        body: "There are no photographs in your library on this iPhone. If they live in iCloud, they may still be arriving.",
        words: [LIBRARY],
      };
    case "selection":
      return {
        eyebrow: "The Darkroom",
        title: "VINTAGE can’t see any photographs yet.",
        body: "You chose to share a selection with VINTAGE, and it’s empty.",
        words: [{ label: "Choose photographs", act: "choosePhotographs" }, ALLOW_ALL, LIBRARY],
      };
    case "few":
      return {
        eyebrow: "The Darkroom",
        title: "Only a few photographs to look through.",
        body: "You’ve shared part of your library with VINTAGE. The Darkroom is at its best when it can look through all of it — it still reads only on this iPhone.",
        words: [SHARE_MORE, ALLOW_ALL, LIBRARY],
      };
    case "tooNew":
      return {
        eyebrow: "The Darkroom",
        title: "Nothing old enough yet.",
        body: "Everything in your library is from the last few months. The Darkroom keeps to photographs from before then. Give it a season.",
        words: [
          { label: `Look through ${thisYear}`, act: "lookThroughYear", year: thisYear },
          LIBRARY,
          ...(ctx.limited ? [SHARE_MORE] : []),
        ],
      };
    case "day":
      return {
        eyebrow: "On this day",
        title: `Nothing from ${monthDay(ctx.now)}.`,
        body: "Not in any other year, or in the weeks around it.",
        words: [SURPRISE, CHOOSE_YEAR, LIBRARY],
      };
    case "shelf":
      return {
        eyebrow: "Set aside",
        title: "Nothing set aside.",
        body: "Set a photograph aside to come back to it. It stays on this iPhone and is never posted on its own.",
        words: [SURPRISE, LIBRARY],
      };
    case "failed":
      return {
        eyebrow: "The Darkroom",
        title: "The library didn’t answer.",
        body: "Something on this iPhone kept VINTAGE from reading your photographs just now.",
        words: [{ label: "Try again", act: "retry" }, LIBRARY],
      };
    case "exhausted":
      return exhaustedPage(ctx.limited);
  }
}

function exhaustedPage(limited: boolean): PageWords {
  return {
    eyebrow: "Surprise me",
    title: "You’ve seen everything the Darkroom can find for now.",
    body: "It will have others for you another day.",
    words: [CHOOSE_YEAR, LIBRARY, ...(limited ? [SHARE_MORE] : [])],
  };
}

/** How a chapter ended, which decides its end page. */
export type Ending =
  | { kind: "day"; reach: DayReach | null }
  | { kind: "year"; year: number; smaller: boolean; fromMonth: number; shown: number }
  | { kind: "roll" }
  | { kind: "exhausted" }
  | { kind: "shelf" }
  /** Reading on failed: the trailing page offers to try again. */
  | { kind: "readFailed" };

/** The year after `year` in the index, or, when it is the newest, the one before. */
export function nextYearWord(year: number, years: readonly YearCount[] | null): PageWord | null {
  if (!years || years.length === 0) return null;
  const list = [...years].map((y) => y.year).sort((a, b) => a - b);
  const after = list.find((y) => y > year);
  if (after != null) return { label: `On to ${after}`, act: "year", year: after };
  const before = [...list].reverse().find((y) => y < year);
  return before != null ? { label: `Back to ${before}`, act: "year", year: before } : null;
}

export function endPage(ending: Ending, ctx: { now: number; limited: boolean; years: readonly YearCount[] | null }): PageWords {
  switch (ending.kind) {
    case "day":
      return {
        eyebrow: monthDay(ctx.now),
        title:
          ending.reach === "week"
            ? "That is everything from this week, in other years."
            : ending.reach === "season"
              ? "That is everything from this time of year."
              : "That is everything from this day.",
        body: "There will be another tomorrow.",
        words: [SURPRISE, CHOOSE_YEAR, LIBRARY],
      };
    case "year": {
      const on = nextYearWord(ending.year, ctx.years);
      return {
        eyebrow: String(ending.year),
        title: `The end of ${ending.year}.`,
        body: ending.smaller ? "The Darkroom showed you some of this year, not all of it." : undefined,
        words: [
          // A year that showed nothing has nothing more to show from it.
          ...(ending.shown > 0 ? [{ label: `More from ${ending.year}`, act: "moreFrom" as const, year: ending.year }] : []),
          ...(on ? [on] : []),
          ...(ending.fromMonth > 0 ? [{ label: "From January", act: "fromJanuary" as const, year: ending.year }] : []),
          LIBRARY,
        ],
      };
    }
    case "roll":
      return {
        eyebrow: "Surprise me",
        title: "That is the roll.",
        words: [{ label: "Another roll", act: "anotherRoll" }, CHOOSE_YEAR, LIBRARY, ...(ctx.limited ? [SHARE_MORE] : [])],
      };
    case "exhausted":
      return exhaustedPage(ctx.limited);
    case "shelf":
      return { eyebrow: "Set aside", title: "That is all you set aside.", words: [SURPRISE, LIBRARY] };
    case "readFailed":
      return {
        eyebrow: "The Darkroom",
        title: "The library didn’t answer.",
        body: "Something on this iPhone kept VINTAGE from reading your photographs just now.",
        words: [{ label: "Try again", act: "readOn" }, LIBRARY],
      };
  }
}

// ---------------------------------------------------------------------------
// VoiceOver and Contents
// ---------------------------------------------------------------------------

/** The stage's value: "October 22, 2019. Six years ago today. Set aside. Posted in May 2026." */
export function stageValue(takenAt: number, line: string, setAside: boolean, postedAt: number | null): string {
  let value = `${fullDate(takenAt)}. ${line}.`;
  if (setAside) value += " Set aside.";
  if (postedAt != null) value += ` Posted in ${monthYearWords(postedAt)}.`;
  return value;
}

/** What On this day can say in Contents before and after it has looked. */
export type DayState = "unknown" | DayReach | "none";

export function dayFolio(state: DayState, now: number): string {
  if (state === "week") return "This week";
  if (state === "season") return "Around this time";
  if (state === "none") return "Nothing today";
  return shortDay(now);
}

/** "Set aside, 7 photographs" — one photograph is one. */
export function photographs(n: number): string {
  return n === 1 ? "1 photograph" : `${countLabel(n)} photographs`;
}

/** Said once under the Set aside line after a pruning. */
export function prunedNote(n: number): string | null {
  if (!(n > 0)) return null;
  if (n === 1) return "One you set aside is no longer in your library.";
  return `${yearsInWords(n)} you set aside are no longer in your library.`;
}
