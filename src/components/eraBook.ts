import type { Era, EraSummary } from "@/utils/memories";
import { shortDate } from "@/utils/time";

/**
 * The words and measures of a profile read as eras (EraList), kept apart
 * from the component so they can be read, and tested, without a phone.
 */

/** How many small prints follow an era's lead before the rest is a tap away; also the strip's width in squares. */
export const ERA_STRIP = 4;
/** Between prints. Twice the grid's hairline gap: these are prints laid on a page, not a contact sheet. */
export const PRINT_GAP = 4;

/** What "on their own" means, said once at the foot of the eras. */
export const ERA_RULE = "An era is two or more photographs from one place, or one season, in the same year.";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTHS_LONG = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function photographs(n: number): string {
  return `${n} ${n === 1 ? "photograph" : "photographs"}`;
}

type Dated = { taken_at: string | null; created_at: string };

/** The first and last months of an era, and its year; an era never crosses a year, its title says which. */
function months(era: Era<Dated>): { first: number; last: number; year: number } {
  const times = era.posts.map((p) => new Date(p.taken_at ?? p.created_at).getTime());
  const first = new Date(Math.min(...times));
  const last = new Date(Math.max(...times));
  return { first: first.getMonth(), last: last.getMonth(), year: last.getFullYear() };
}

/** `May – Jun 2023`, or `May 2023` when every photograph is from one month. */
export function eraSpan(era: Era<Dated>): string {
  const { first, last, year } = months(era);
  return first === last ? `${MONTHS[first]} ${year}` : `${MONTHS[first]} – ${MONTHS[last]} ${year}`;
}

/** The span as VoiceOver says it: `May to June 2023`. */
export function eraSpanSpoken(era: Era<Dated>): string {
  const { first, last, year } = months(era);
  return first === last ? `${MONTHS_LONG[first]} ${year}` : `${MONTHS_LONG[first]} to ${MONTHS_LONG[last]} ${year}`;
}

/** The quiet line under an era's name: `May – Jun 2023 · 7 photographs`, set in upper-case mono. */
export function eraMeta(era: Era<Dated>): string {
  return `${eraSpan(era)} · ${photographs(era.posts.length)}`;
}

/** The era's name as a heading is heard: `Lisbon 2023, 7 photographs`. */
export function eraHeading(era: Era<unknown>): string {
  return `${era.title}, ${photographs(era.posts.length)}`;
}

/** The small prints after the lead: a short strip, or all of them once opened. */
export function eraStrip<T>(era: Era<T>, expanded: boolean): T[] {
  return expanded ? era.posts.slice(1) : era.posts.slice(1, 1 + ERA_STRIP);
}

/** The control that opens an era in place, or closes it again; null when the strip already holds them all. */
export function eraMore(era: Era<unknown>, expanded: boolean): { text: string; label: string } | null {
  const n = era.posts.length;
  if (n <= 1 + ERA_STRIP) return null;
  return expanded
    ? { text: "Show fewer", label: `Show fewer photographs from ${era.title}` }
    : { text: `Show all ${n}`, label: `Show all ${n} photographs from ${era.title}` };
}

/** From this ratio up a lead is a landscape, and takes the page's whole width. */
export const LANDSCAPE_LEAD = 1.25;

/**
 * The lead print's size, at its own proportions (already clamped as the
 * feed clamps them, so never taller than 4:5). A portrait or a square is
 * three of the strip's squares wide, with the fourth column left as a
 * margin beside it; a landscape takes all four. It is drawn from the same
 * 480 px copy as the squares, a little enlarged, as the photograph at the
 * top of On this day is.
 */
export function leadPrint(ratio: number, cell: number): { width: number; height: number } {
  const columns = ratio >= LANDSCAPE_LEAD ? ERA_STRIP : ERA_STRIP - 1;
  const width = cell * columns + PRINT_GAP * (columns - 1);
  return { width: Math.round(width), height: Math.round(width / ratio) };
}

/** `12 without a date · 5 on their own`: what the eras leave out, or null when they leave nothing. */
export function erasFootnote(summary: Pick<EraSummary<unknown>, "undated" | "apart">): string | null {
  const parts: string[] = [];
  if (summary.undated > 0) parts.push(`${summary.undated} without a date`);
  if (summary.apart > 0) parts.push(`${summary.apart} on ${summary.apart === 1 ? "its" : "their"} own`);
  return parts.length > 0 ? parts.join("  ·  ") : null;
}

export type ErasEmpty = {
  /** none: no photographs of their own; undated: none carries a capture date; scattered: dated, but none share an era. */
  kind: "none" | "undated" | "scattered";
  title: string;
  body: string;
};

/**
 * What the page says when there are no eras, and why: there are no
 * photographs of the member's own (the ones they were tagged in are not
 * theirs to gather), none says when it was taken, or none shares its
 * place or season and year with another. `member` is whose page it is;
 * omitted on your own. Null when there are eras to show.
 */
export function erasEmpty(summary: EraSummary<unknown>, member?: string): ErasEmpty | null {
  if (summary.eras.length > 0) return null;
  const title = "No eras yet";
  if (summary.undated + summary.apart === 0) {
    return {
      kind: "none",
      title,
      body: member
        ? `${member} hasn’t posted a photograph yet.`
        : "Eras gather the photographs you post. The ones you’re tagged in stay in the grid.",
    };
  }
  if (summary.apart === 0) {
    return {
      kind: "undated",
      title,
      body: member
        ? `Eras are read from the day each photograph was taken, and none of ${member}’s carries that date.`
        : "Eras are read from the day each photograph was taken, and none of yours carries that date.",
    };
  }
  return {
    kind: "scattered",
    title,
    body: member
      ? `${ERA_RULE} None of ${member}’s photographs make one yet.`
      : `${ERA_RULE} Write the same place on the photographs from one trip and they gather here.`,
  };
}

/** A print as VoiceOver names it: `Photograph, Oct 26, 2026. Last ferry of the evening.` */
export function printLabel(post: { media_type: string; taken_at: string | null; created_at: string; caption?: string | null }): string {
  const kind = post.media_type === "video" ? "Film" : "Photograph";
  const caption = post.caption?.trim();
  const when = `${kind}, ${shortDate(post.taken_at ?? post.created_at)}`;
  return caption ? `${when}. ${caption}` : when;
}
