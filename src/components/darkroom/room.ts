import { Platform, useColorScheme, type TextStyle } from "react-native";
import { dark, light, type } from "@/theme";

/**
 * The Memory Room is printed on the app's own page: the light print when
 * the app is light, the dark print when it is dark, and it changes with
 * the appearance setting as the rest of the app does. Its marks are the
 * theme's accent in either print. The room reads plain strings, not the
 * dynamic `colors.*`, because it hands them to the Animated views and
 * to its own measures of contrast; `useScheme` says which print to read,
 * by the same rule the theme's dynamic colours follow. None of the shared
 * components (GateButton, Button, EmptyState, Bone, Screen) are used
 * here; `Word`, `Plate` and `PrintPage` stand in for them.
 *
 *   page        the room itself: the app's paper, so the room is the
 *               page the member came from.
 *   well        the fill a plate sits in before its pixels arrive: a
 *               step into the paper on the light print, a step up off
 *               the page on the dark one.
 *   sheet       the Contents sheet, the theme's raised paper, as a sheet
 *               lies on the page it opens over.
 *   ink, soft, faint
 *               the three inks type is set in.
 *   accent      the room's marks: the date, a chapter's name over a
 *               title card, the dot of a print set aside, where you are
 *               in Contents, and the CONTENTS tab until it is first
 *               opened.
 *   line        the plate's hairline, felt more than seen.
 *   lineStrong  the print's rule: the signature line under a plate, the
 *               rules in Contents, and the plate's hairline under
 *               Increase Contrast.
 *   lineFirm    the theme's faintest ink, as a line that is plainly
 *               there: the edge of the CONTENTS tab, and the signature
 *               line under Increase Contrast (`signatureInks` says what
 *               a download is drawn in along it).
 *
 * Every ink the room sets type in reaches WCAG AA (4.5:1) on every ground
 * it is set on, in both prints. Where the theme's ink does not, the room
 * sets that type one ink stronger: the light print's faint ink is too
 * pale for the room's small capitals on paper, so on the light print
 * the room's faintest type is its soft ink. `accentDeep` and
 * `borderStrong` are never used for type.
 */
export interface Room {
  page: string;
  well: string;
  sheet: string;
  ink: string;
  soft: string;
  faint: string;
  accent: string;
  line: string;
  lineStrong: string;
  lineFirm: string;
}

export type Scheme = "light" | "dark";

/** WCAG's AA for body text. */
export const AA = 4.5;

/** A colour's relative luminance, as WCAG 2 defines it; `#RRGGBB` only. */
export function luminance(hex: string): number {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return 0;
  const n = parseInt(m[1], 16);
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
}

/** The contrast ratio between two colours, 1 to 21. */
export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const legible = (ink: string, grounds: readonly string[]) => grounds.every((g) => contrastRatio(ink, g) >= AA);

/** The room as printed in one appearance, from that print's tokens. */
export function roomFor(scheme: Scheme): Room {
  const p = scheme === "dark" ? dark : light;
  const page = p.paper;
  const well = scheme === "dark" ? p.paperRaised : p.paperSunken;
  const sheet = p.paperRaised;
  // Type is set on the page, in the well (a plate that says why it has no
  // photograph) and on the sheet; the accent only on the page and the sheet.
  const grounds = [page, well, sheet];
  const ink = p.ink;
  const soft = legible(p.inkSoft, grounds) ? p.inkSoft : ink;
  const faint = legible(p.inkFaint, grounds) ? p.inkFaint : soft;
  const accent = legible(p.accent, [page, sheet]) ? p.accent : ink;
  return {
    page,
    well,
    sheet,
    ink,
    soft,
    faint,
    accent,
    line: p.border,
    lineStrong: p.borderStrong,
    lineFirm: p.inkFaint,
  };
}

/** Both prints of the room, made once. */
export const rooms: Record<Scheme, Room> = { light: roomFor("light"), dark: roomFor("dark") };

/**
 * Which print the app is showing, as the theme decides it: on the iPhone,
 * the appearance (the phone's, or the member's choice over it in
 * Settings); elsewhere the light print, which is all the theme's colours
 * show there. Kept current: the room changes print the moment the
 * appearance does.
 */
export function useScheme(): Scheme {
  const scheme = useColorScheme();
  return Platform.OS === "ios" && scheme === "dark" ? "dark" : "light";
}

/** WCAG's 3:1 for what is not type: a line, a fill, the state of a control. */
export const NON_TEXT = 3;

/**
 * The signature line's two inks: the line, and a download drawn along it
 * (`Signature` in Caption.tsx).
 *
 * The line is the print's strong line, and its firm line under Increase
 * Contrast, so the line is plainly there. A download is drawn in the
 * accent wherever the accent stands 3:1 off the line it runs along;
 * otherwise in the ink. On the light print under Increase Contrast, burnt
 * sienna on the firm line is 1.65:1 and the ink is 4.88:1, so the download
 * is drawn in the ink there and Increase Contrast raises it rather than
 * lowering it. Only where not even the ink stands 3:1 off the firm line
 * does the line keep its strong line while a download is drawn, the ink
 * along it. So in either print, Increase Contrast or not, how far a
 * download has come is 3:1 or better against the rest of the line.
 */
export function signatureInks(room: Room, contrast: boolean, drawing: boolean): { line: string; drawn: string } {
  const line = contrast ? room.lineFirm : room.lineStrong;
  if (!drawing) return { line, drawn: room.accent };
  const pairs: readonly (readonly [string, string])[] = contrast
    ? [
        [line, room.accent],
        [line, room.ink],
        [room.lineStrong, room.ink],
        [room.lineStrong, room.accent],
      ]
    : [
        [line, room.accent],
        [line, room.ink],
      ];
  const [l, d] =
    pairs.find(([a, b]) => contrastRatio(a, b) >= NON_TEXT) ??
    pairs.reduce((best, p) => (contrastRatio(p[0], p[1]) > contrastRatio(best[0], best[1]) ? p : best));
  return { line: l, drawn: d };
}

/** The signed rule under a word sits at this opacity; Increase Contrast takes it to 1. */
export const RULE_OPACITY = 0.8;

/** Tracked capitals carry their trailing space; this takes it back so a rule beneath centres on the letters. */
export function untrack(letterSpacing: number): Pick<TextStyle, "letterSpacing" | "marginRight"> {
  return { letterSpacing, marginRight: -letterSpacing };
}

/** The four inks type can be set in. Faint becomes soft under Increase Contrast. */
export type Tone = "ink" | "soft" | "faint" | "accent";

const mono = type.mono;
const serif = type.serif;
const caps = { textTransform: "uppercase" as const };

/**
 * The room's type, by role. Each role carries its face, size, leading and
 * tracking (always with the trailing space taken back), and the ink it is
 * set in unless a caller says otherwise. Words are stored in sentence
 * case and set in capitals by `textTransform`, so VoiceOver reads them as
 * words rather than letters.
 */
export const roles = {
  eyebrow: { style: { fontFamily: mono, fontSize: 10, ...untrack(2.4), ...caps }, tone: "faint" },
  head: { style: { fontFamily: mono, fontSize: 10, ...untrack(2.4), ...caps }, tone: "soft" },
  /** CONTENTS in its tab at the head of the room: a step up from the head, in the full ink. */
  tab: { style: { fontFamily: mono, fontSize: 11, lineHeight: 14, ...untrack(2.2), ...caps }, tone: "ink" },
  dateLabel: { style: { fontFamily: mono, fontSize: 11, lineHeight: 14, ...untrack(2.2), ...caps }, tone: "accent" },
  small: { style: { fontFamily: mono, fontSize: 10, ...untrack(2.2), ...caps }, tone: "faint" },
  wordPrimary: { style: { fontFamily: mono, fontSize: 12, ...untrack(3), ...caps }, tone: "ink" },
  word: { style: { fontFamily: mono, fontSize: 10.5, ...untrack(2.2), ...caps }, tone: "soft" },
  folio: { style: { fontFamily: mono, fontSize: 10, ...untrack(1.6), ...caps }, tone: "faint" },
  /** A year's count in Contents: figures, lightly tracked. */
  count: { style: { fontFamily: mono, fontSize: 11, ...untrack(0.6) }, tone: "faint" },
  month: { style: { fontFamily: mono, fontSize: 10, ...untrack(1.6), ...caps }, tone: "soft" },
  line: { style: { fontFamily: serif, fontStyle: "italic", fontSize: 15, lineHeight: 20 }, tone: "soft" },
  plateTitle: { style: { fontFamily: serif, fontSize: 26, lineHeight: 34 }, tone: "ink" },
  thresholdTitle: { style: { fontFamily: serif, fontSize: 32, lineHeight: 40, letterSpacing: 0.3 }, tone: "ink" },
  cardTitle: { style: { fontFamily: serif, fontSize: 40, lineHeight: 48 }, tone: "ink" },
  cardYear: { style: { fontFamily: serif, fontSize: 64, lineHeight: 72, fontVariant: ["oldstyle-nums"] }, tone: "ink" },
  /** "Looking through your library…" under a title card. */
  slow: { style: { fontFamily: serif, fontStyle: "italic", fontSize: 14, lineHeight: 20 }, tone: "faint" },
  body: { style: { fontFamily: serif, fontStyle: "italic", fontSize: 15, lineHeight: 22 }, tone: "soft" },
  foot: { style: { fontFamily: serif, fontStyle: "italic", fontSize: 13, lineHeight: 19 }, tone: "faint" },
  contentsLine: { style: { fontFamily: serif, fontSize: 21, lineHeight: 28 }, tone: "ink" },
  contentsYear: { style: { fontFamily: serif, fontSize: 21, lineHeight: 28, fontVariant: ["oldstyle-nums"] }, tone: "ink" },
} satisfies Record<string, { style: TextStyle; tone: Tone }>;

export type Role = keyof typeof roles;

/** The colour of a tone in a print of the room, with Increase Contrast's lift for the faintest. */
export function toneColor(room: Room, tone: Tone, contrast: boolean): string {
  if (tone === "faint") return contrast ? room.soft : room.faint;
  return room[tone];
}
