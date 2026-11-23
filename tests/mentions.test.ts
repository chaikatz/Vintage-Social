import { describe, expect, it } from "vitest";
import {
  activeMention,
  insertAtCaret,
  insertMention,
  MENTION_SUGGESTIONS,
  mentionedUsernames,
  parseMentions,
  rankMentionSuggestions,
  type MentionCandidate,
  type MentionPart,
} from "@/utils/mentions";
import { MAX_CAPTION_LENGTH, MAX_COMMENT_LENGTH } from "@/utils/validation";

/** The names found, as they were written and as they link. */
const names = (text: string) =>
  parseMentions(text)
    .filter((p): p is Extract<MentionPart, { kind: "mention" }> => p.kind === "mention")
    .map((p) => [p.text, p.username]);
const joined = (parts: MentionPart[]) => parts.map((p) => p.text).join("");

describe("@names in what members write", () => {
  it("links a name to the member, in lowercase, drawn as it was typed", () => {
    expect(parseMentions("with @ansel today")).toEqual([
      { kind: "text", text: "with " },
      { kind: "mention", text: "@ansel", username: "ansel" },
      { kind: "text", text: " today" },
    ]);
    expect(names("@Ansel.Adams_1")).toEqual([["@Ansel.Adams_1", "ansel.adams_1"]]);
  });

  it("keeps the words exactly as they were, whatever is in them", () => {
    for (const text of [
      "",
      "no names here",
      "@ansel",
      "mail me@example.com, @ansel.",
      "🔥@marta and @josé (@dorothea) — @ab @a_b_c…",
      "@@ansel @.ansel @ansel@example.com",
    ]) {
      expect(joined(parseMentions(text))).toBe(text);
    }
    expect(parseMentions("")).toEqual([]);
    expect(parseMentions("plain words")).toEqual([{ kind: "text", text: "plain words" }]);
  });

  it("never links an @ inside an address or a word", () => {
    expect(names("write to ansel@example.com")).toEqual([]);
    expect(names("me@ansel")).toEqual([]);
    expect(names("café@noon")).toEqual([]);
    expect(names("x_@ansel")).toEqual([]);
    expect(names("a.@ansel")).toEqual([]);
    expect(names("@@ansel")).toEqual([]);
    // An address written with an @ in front is still an address.
    expect(names("@ansel@example.com")).toEqual([]);
    // Letters in any script make it a word, not the start of a name.
    expect(names("写真@ansel")).toEqual([]);
  });

  it("leaves a sentence's punctuation out of the name", () => {
    expect(names("thanks @ansel.")).toEqual([["@ansel", "ansel"]]);
    expect(names("thanks @ansel...")).toEqual([["@ansel", "ansel"]]);
    expect(names("@ansel, @marta! @dorothea? (@vivian) “@helen” @berenice:")).toEqual([
      ["@ansel", "ansel"],
      ["@marta", "marta"],
      ["@dorothea", "dorothea"],
      ["@vivian", "vivian"],
      ["@helen", "helen"],
      ["@berenice", "berenice"],
    ]);
    expect(names("@ansel's print and @marta’s")).toEqual([
      ["@ansel", "ansel"],
      ["@marta", "marta"],
    ]);
    // A dot inside a name is the name's; one at its end is the sentence's.
    expect(names("by @ansel.adams.")).toEqual([["@ansel.adams", "ansel.adams"]]);
    // An underscore at the end is allowed in a username, so it stays.
    expect(names("@ansel_ ok")).toEqual([["@ansel_", "ansel_"]]);
  });

  it("reads emoji and other scripts around a name correctly", () => {
    expect(names("🔥@marta")).toEqual([["@marta", "marta"]]);
    expect(names("@marta🔥")).toEqual([["@marta", "marta"]]);
    expect(names("❤️ @marta ❤️")).toEqual([["@marta", "marta"]]);
    // A name that runs on into a letter no username can hold is not a name, nor the part before it.
    expect(names("@josé")).toEqual([]);
    expect(names("@josé")).toEqual([]);
    expect(names("@marta写真")).toEqual([]);
    // Text after the name in another script, past a space, is only text.
    expect(names("@marta 写真")).toEqual([["@marta", "marta"]]);
  });

  it("starts a name straight after an emoji's picture selector, as after any emoji", () => {
    // The heart reaction is U+2764 U+FE0F; U+FE0F is a mark, but it belongs to the heart, not to a word.
    const heart = "\u2764\uFE0F";
    expect(names(`${heart}@ansel`)).toEqual([["@ansel", "ansel"]]);
    expect(joined(parseMentions(`${heart}@ansel`))).toBe(`${heart}@ansel`);
    expect(names(`${heart}${heart}@ansel and @marta`)).toEqual([
      ["@ansel", "ansel"],
      ["@marta", "marta"],
    ]);
    // A family emoji ends on an emoji, not its joiner; a stray joiner is looked past too.
    expect(names("\u{1F468}\u200D\u{1F469}\u200D\u{1F467}@ansel")).toEqual([["@ansel", "ansel"]]);
    expect(names("\u{1F525}\u200D@ansel")).toEqual([["@ansel", "ansel"]]);
    // A letter under the selector is still a letter: the @ is inside a word.
    expect(names("a\uFE0F@ansel")).toEqual([]);
    expect(names("me\uFE0F@example.com")).toEqual([]);
    // Other marks still join, as an accent on a letter does.
    expect(names("cafe\u0301@noon")).toEqual([]);
  });

  it("holds a name to the rules every username is held to", () => {
    // Three to twenty-four characters.
    expect(names("@ab")).toEqual([]);
    expect(names("@abc")).toEqual([["@abc", "abc"]]);
    expect(names(`@${"a".repeat(24)}`)).toEqual([[`@${"a".repeat(24)}`, "a".repeat(24)]]);
    expect(names(`@${"a".repeat(25)}`)).toEqual([]);
    // Never starting with a dot.
    expect(names("@.ansel")).toEqual([]);
    expect(names("@")).toEqual([]);
    expect(names("@ alone")).toEqual([]);
    expect(names("@...")).toEqual([]);
  });

  it("finds every name, in order, and each member once", () => {
    const text = "@ansel and @marta, then @ANSEL again with @dorothea.";
    expect(names(text).map(([, u]) => u)).toEqual(["ansel", "marta", "ansel", "dorothea"]);
    expect(mentionedUsernames(text)).toEqual(["ansel", "marta", "dorothea"]);
    expect(mentionedUsernames("no one")).toEqual([]);
    expect(mentionedUsernames("me@example.com")).toEqual([]);
  });

  it("starts a name at the start of the words and after a line break", () => {
    expect(names("@ansel\n@marta")).toEqual([
      ["@ansel", "ansel"],
      ["@marta", "marta"],
    ]);
  });
});

describe("the name being written", () => {
  it("is the @ before the caret and what is typed after it, a bare @ included", () => {
    expect(activeMention("@", 1)).toEqual({ start: 0, end: 1, query: "" });
    expect(activeMention("hi @an", 6)).toEqual({ start: 3, end: 6, query: "an" });
    expect(activeMention("hi @An", 6)).toEqual({ start: 3, end: 6, query: "An" });
    // The caret inside the name: what is typed up to it, and the name ends where it ends.
    expect(activeMention("hi @ansel there", 6)).toEqual({ start: 3, end: 9, query: "an" });
  });

  it("is nothing away from a name, inside an address, or past a space", () => {
    expect(activeMention("", 0)).toBeNull();
    expect(activeMention("hello", 5)).toBeNull();
    expect(activeMention("me@exa", 6)).toBeNull();
    expect(activeMention("@ansel ", 7)).toBeNull();
    expect(activeMention("@ansel nice", 11)).toBeNull();
    expect(activeMention("@.an", 4)).toBeNull();
    expect(activeMention(`@${"a".repeat(25)}`, 26)).toBeNull();
    // A caret before the @ is not in the name.
    expect(activeMention("@ansel", 0)).toBeNull();
  });

  it("is offered straight after the heart reaction, as after any other", () => {
    const heart = "\u2764\uFE0F";
    expect(activeMention(`${heart}@`, 3)).toEqual({ start: 2, end: 3, query: "" });
    expect(activeMention(`${heart}@to`, 5)).toEqual({ start: 2, end: 5, query: "to" });
    expect(activeMention("\u{1F525}@to", 5)).toEqual({ start: 2, end: 5, query: "to" });
    expect(activeMention("a\uFE0F@to", 5)).toBeNull();
  });

  it("holds a caret beyond the words to their end", () => {
    expect(activeMention("@an", 99)).toEqual({ start: 0, end: 3, query: "an" });
    expect(activeMention("@an", -4)).toBeNull();
  });
});

describe("choosing a member", () => {
  it("writes @username and a space in place of what was typed, and puts the caret after it", () => {
    const text = "lovely @an";
    const at = activeMention(text, text.length)!;
    expect(insertMention(text, at, "ansel", MAX_COMMENT_LENGTH)).toEqual({ text: "lovely @ansel ", caret: 14 });
  });

  it("replaces the whole name when the caret is inside it, and keeps the words after it", () => {
    const text = "@anxx is here";
    const at = activeMention(text, 3)!;
    const next = insertMention(text, at, "ansel", MAX_COMMENT_LENGTH)!;
    // The space already there is used, not doubled.
    expect(next.text).toBe("@ansel is here");
    expect(next.caret).toBe("@ansel ".length);
  });

  it("writes the username in lowercase, as usernames are kept", () => {
    const at = activeMention("@AN", 3)!;
    expect(insertMention("@AN", at, "Ansel", MAX_COMMENT_LENGTH)?.text).toBe("@ansel ");
  });

  it("writes nothing when the words would then be too long for the field", () => {
    const text = `${"x".repeat(MAX_CAPTION_LENGTH - 4)} @an`;
    const at = activeMention(text, text.length)!;
    expect(insertMention(text, at, "anselmo", MAX_CAPTION_LENGTH)).toBeNull();
    expect(insertMention(text, at, "an", MAX_CAPTION_LENGTH)).toBeNull();
    const fits = `${"x".repeat(MAX_CAPTION_LENGTH - 10)} @an`;
    expect(insertMention(fits, activeMention(fits, fits.length)!, "ansel", MAX_CAPTION_LENGTH)?.text.length).toBeLessThanOrEqual(MAX_CAPTION_LENGTH);
  });

  it("a member chosen is then a link in the words", () => {
    const text = "with @ma";
    const next = insertMention(text, activeMention(text, text.length)!, "marta", MAX_COMMENT_LENGTH)!;
    expect(mentionedUsernames(next.text)).toEqual(["marta"]);
    // And no name is being written any more.
    expect(activeMention(next.text, next.caret)).toBeNull();
  });
});

describe("a quick reaction", () => {
  it("goes in at the caret, and the caret after it", () => {
    expect(insertAtCaret("", 0, "🔥", MAX_COMMENT_LENGTH)).toEqual({ text: "🔥", caret: 2 });
    expect(insertAtCaret("great shot", 5, "🔥", MAX_COMMENT_LENGTH)).toEqual({ text: "great🔥 shot", caret: 7 });
    expect(insertAtCaret("ok", 99, "👏", MAX_COMMENT_LENGTH)).toEqual({ text: "ok👏", caret: 4 });
  });

  it("is never cut to fit, and never half an emoji", () => {
    const full = "x".repeat(MAX_COMMENT_LENGTH - 1);
    expect(insertAtCaret(full, full.length, "🔥", MAX_COMMENT_LENGTH)).toBeNull();
    expect(insertAtCaret("x".repeat(MAX_COMMENT_LENGTH - 2), 0, "🔥", MAX_COMMENT_LENGTH)?.text.length).toBe(MAX_COMMENT_LENGTH);
  });
});

describe("the members offered for a name", () => {
  const m = (id: string, username: string, full_name: string | null = null): MentionCandidate => ({ id, username, full_name, avatar_url: null });
  const followed = [m("1", "marta"), m("2", "ansel", "Ansel Adams"), m("3", "dorothea", "Dorothea Lange"), m("4", "maria")];
  const found = [m("5", "mark"), m("2", "ansel", "Ansel Adams"), m("6", "amadeus"), m("me", "manon")];

  it("offers whom the writer follows first, then anyone a search found, never twice and never the writer", () => {
    const ids = rankMentionSuggestions("ma", followed, found, "me").map((x) => x.id);
    expect(ids).toEqual(["1", "4", "5", "6"]);
  });

  it("puts a username that starts with what is typed before a name that does, before one that only holds it", () => {
    const people = [m("a", "lamar"), m("b", "zed", "Mara Zed"), m("c", "marcel")];
    expect(rankMentionSuggestions("mar", people, [], "me").map((x) => x.username)).toEqual(["marcel", "zed", "lamar"]);
  });

  it("matches whatever the case", () => {
    expect(rankMentionSuggestions("ANS", followed, [], "me").map((x) => x.username)).toEqual(["ansel"]);
    expect(rankMentionSuggestions("lange", followed, [], "me").map((x) => x.username)).toEqual(["dorothea"]);
  });

  it("with nothing typed, offers the members the writer follows, in their order", () => {
    expect(rankMentionSuggestions("", followed, [], "me").map((x) => x.id)).toEqual(["1", "2", "3", "4"]);
  });

  it("leaves out a search's results that no longer match what is typed", () => {
    // The last search's answer stays up while the next is asked.
    expect(rankMentionSuggestions("dor", [], [m("5", "mark")], "me")).toEqual([]);
  });

  it("offers a handful at most", () => {
    const many = Array.from({ length: 40 }, (_, i) => m(String(i), `member${i}`));
    expect(rankMentionSuggestions("mem", many, many, "me")).toHaveLength(MENTION_SUGGESTIONS);
    expect(MENTION_SUGGESTIONS).toBeLessThanOrEqual(6);
    expect(rankMentionSuggestions("mem", many, [], "me", 2)).toHaveLength(2);
  });
});
