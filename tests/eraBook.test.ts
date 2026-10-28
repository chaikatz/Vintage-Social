import { describe, expect, it } from "vitest";
import {
  ERA_RULE,
  ERA_STRIP,
  LANDSCAPE_LEAD,
  PRINT_GAP,
  eraHeading,
  eraMeta,
  eraMore,
  eraSpan,
  eraSpanSpoken,
  eraStrip,
  erasEmpty,
  erasFootnote,
  leadPrint,
  printLabel,
} from "@/components/eraBook";
import { eraSummary, groupEras, type Era } from "@/utils/memories";

/**
 * A profile read as eras, in words and measures: what a chapter says
 * under its name, how big its lead print is, what opens it in place, what
 * the foot of the page counts, and what is said when there are no eras.
 * Dates are local-time strings, so none of this depends on the zone.
 */

const post = (id: string, taken: string | null, location: string | null = null, extra: Record<string, unknown> = {}) => ({
  id,
  taken_at: taken,
  created_at: "2026-09-01T12:00:00",
  location,
  media_type: "photo",
  caption: "",
  ...extra,
});
type P = ReturnType<typeof post>;

const era = (posts: P[]): Era<P> => groupEras(posts)[0];

const lisbon = era([
  post("1", "2023-05-02T12:00:00", "Lisbon"),
  post("2", "2023-05-20T12:00:00", "Lisbon"),
  post("3", "2023-06-11T12:00:00", "Lisbon"),
  post("4", "2023-06-12T12:00:00", "Lisbon"),
  post("5", "2023-06-13T12:00:00", "Lisbon"),
  post("6", "2023-06-14T12:00:00", "Lisbon"),
  post("7", "2023-06-15T12:00:00", "Lisbon"),
]);

describe("a chapter's lines", () => {
  it("say when the era ran and how many it holds", () => {
    expect(eraSpan(lisbon)).toBe("May – Jun 2023");
    expect(eraMeta(lisbon)).toBe("May – Jun 2023 · 7 photographs");
    expect(eraSpanSpoken(lisbon)).toBe("May to June 2023");
  });

  it("name one month once", () => {
    const one = era([post("a", "2021-07-10T12:00:00"), post("b", "2021-07-20T12:00:00")]);
    expect(one.title).toBe("Summer 2021");
    expect(eraSpan(one)).toBe("Jul 2021");
    expect(eraSpanSpoken(one)).toBe("July 2021");
  });

  it("are heard as a heading with its count", () => {
    expect(eraHeading(lisbon)).toBe("Lisbon 2023, 7 photographs");
  });
});

describe("a chapter's prints", () => {
  it("lead with the newest, then a short strip", () => {
    expect(lisbon.posts[0].id).toBe("7");
    expect(eraStrip(lisbon, false).map((p) => p.id)).toEqual(["6", "5", "4", "3"]);
    expect(eraStrip(lisbon, false)).toHaveLength(ERA_STRIP);
  });

  it("open in place to all of them, and close again", () => {
    expect(eraStrip(lisbon, true).map((p) => p.id)).toEqual(["6", "5", "4", "3", "2", "1"]);
    expect(eraMore(lisbon, false)).toEqual({ text: "Show all 7", label: "Show all 7 photographs from Lisbon 2023" });
    expect(eraMore(lisbon, true)).toEqual({ text: "Show fewer", label: "Show fewer photographs from Lisbon 2023" });
  });

  it("offer nothing to open when the strip already holds them all", () => {
    const five = era(Array.from({ length: 1 + ERA_STRIP }, (_, i) => post(`k${i}`, `2022-06-0${i + 1}T12:00:00`, "Kyoto")));
    expect(eraMore(five, false)).toBeNull();
    expect(eraStrip(five, false)).toHaveLength(ERA_STRIP);
  });

  it("set a portrait or square lead three squares wide, a landscape the whole width", () => {
    const cell = 86.5;
    const three = cell * 3 + PRINT_GAP * 2;
    const four = cell * 4 + PRINT_GAP * 3;
    expect(leadPrint(0.8, cell)).toEqual({ width: Math.round(three), height: Math.round(three / 0.8) });
    expect(leadPrint(1, cell)).toEqual({ width: Math.round(three), height: Math.round(three) });
    expect(leadPrint(LANDSCAPE_LEAD, cell).width).toBe(Math.round(four));
    expect(leadPrint(1.5, cell)).toEqual({ width: Math.round(four), height: Math.round(four / 1.5) });
  });

  it("make the lead larger than every square in the strip", () => {
    for (const ratio of [0.8, 1, 1.24, 1.25, 1.5, 1.91]) {
      const lead = leadPrint(ratio, 70);
      expect(lead.width).toBeGreaterThan(70);
      expect(lead.width * lead.height).toBeGreaterThan(70 * 70);
    }
  });

  it("are named for VoiceOver by kind, date and caption", () => {
    expect(printLabel(post("a", "2026-10-26T18:00:00", null, { caption: "Last ferry of the evening." }))).toBe(
      "Photograph, Oct 26, 2026. Last ferry of the evening.",
    );
    expect(printLabel(post("b", "2026-10-26T18:00:00", null, { media_type: "video", caption: "  " }))).toBe("Film, Oct 26, 2026");
  });
});

describe("the foot of the eras", () => {
  it("says what they leave out", () => {
    expect(erasFootnote({ undated: 12, apart: 5 })).toBe("12 without a date  ·  5 on their own");
    expect(erasFootnote({ undated: 0, apart: 1 })).toBe("1 on its own");
    expect(erasFootnote({ undated: 3, apart: 0 })).toBe("3 without a date");
  });

  it("says nothing when they leave nothing out", () => {
    expect(erasFootnote({ undated: 0, apart: 0 })).toBeNull();
  });

  it("defines an era in the house's voice", () => {
    expect(ERA_RULE).toBe("An era is two or more photographs from one place, or one season, in the same year.");
  });
});

describe("no eras", () => {
  it("is not said when there are eras", () => {
    expect(erasEmpty(eraSummary(lisbon.posts))).toBeNull();
  });

  it("on a page with no photographs of their own", () => {
    const none = eraSummary([]);
    expect(erasEmpty(none)).toMatchObject({ kind: "none", title: "No eras yet" });
    expect(erasEmpty(none)?.body).toMatch(/tagged in stay in the grid/);
    expect(erasEmpty(none, "tomas.lindqvist")?.body).toBe("tomas.lindqvist hasn’t posted a photograph yet.");
  });

  it("when none says when it was taken", () => {
    const undated = eraSummary([post("a", null), post("b", null)]);
    expect(erasEmpty(undated)).toMatchObject({ kind: "undated" });
    expect(erasEmpty(undated)?.body).toMatch(/none of yours carries that date\.$/);
    expect(erasEmpty(undated, "june.nakamura")?.body).toMatch(/none of june\.nakamura’s carries that date\.$/);
  });

  it("when dated photographs share no place or season and year", () => {
    const scattered = eraSummary([post("a", "2021-07-10T12:00:00", "Bar Pitti"), post("b", "2022-01-10T12:00:00"), post("c", null)]);
    expect(erasEmpty(scattered)).toMatchObject({ kind: "scattered" });
    expect(erasEmpty(scattered)?.body.startsWith(ERA_RULE)).toBe(true);
    expect(erasEmpty(scattered)?.body).toMatch(/Write the same place/);
    expect(erasEmpty(scattered, "sam.okafor")?.body).toMatch(/None of sam\.okafor’s photographs make one yet\.$/);
  });

  it("is written with the typographer's apostrophe and no exclamation", () => {
    const all = [
      eraSummary([]),
      eraSummary([post("a", null)]),
      eraSummary([post("a", "2021-07-10T12:00:00", "X")]),
    ].flatMap((s) => [erasEmpty(s), erasEmpty(s, "m")]);
    for (const e of all) {
      expect(e?.body).not.toMatch(/'|!/);
      expect(e?.title).not.toMatch(/'|!/);
    }
  });
});
