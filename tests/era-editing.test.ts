import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Arranging Eras, read from the source: the controls are on your own page
 * and nowhere else, a member's page shows their arrangement and offers
 * nothing, nothing about the page changes outside arranging but EDIT
 * itself, what VoiceOver hears of it, how a name is asked for, and that
 * the automatic reading underneath is the one it always was. The logic is
 * tested in eraEdits.test.ts and era-edits-api.test.ts.
 */

const root = path.resolve(import.meta.dirname, "..");

/** The source without its comments, so prose that names what is not done is not taken as doing it. */
function code(file: string): string {
  return readFileSync(path.join(root, file), "utf8")
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

const own = code("app/(tabs)/profile.tsx");
const member = code("app/user/[username].tsx");
const list = code("src/components/EraList.tsx");
const sheet = code("src/components/EraMoveSheet.tsx");
const naming = code("src/components/eraName.ts");
const hook = code("src/hooks/useEraEdits.ts");
const eras = (screen: string) => screen.match(/view === "eras"[^?]*\? \(\s*<EraList[\s\S]*?\/>/)?.[0] ?? "";

describe("who may arrange Eras", () => {
  it("is you, on your own page, once your arrangement has been read", () => {
    expect(own).toMatch(/const eraEdits = useEraEdits\(userId\);/);
    expect(own).toMatch(/const eraEditor = useEraEditor\(userId, posts\.data\);/);
    expect(eras(own)).toMatch(/edits=\{eraEdits\.data\?\.edits\}/);
    expect(eras(own)).toMatch(/editor=\{eraEditor\}/);
    // No editor until the row has been read and there is somewhere to keep a change.
    expect(hook).toMatch(/const ready = edits\.data\?\.ready === true;/);
    expect(hook).toMatch(/if \(!ready \|\| !userId \|\| !posts\) return undefined;/);
  });

  it("is nobody on a member's page, which shows their arrangement and offers nothing", () => {
    const branch = eras(member);
    expect(branch).toMatch(/edits=\{eraEdits\.data\?\.edits\}/);
    expect(branch).not.toMatch(/editor=/);
    expect(member).not.toMatch(/useEraEditor|changeEraEdits|saveEraEdits/);
    // Read only where the photographs may be: never on a locked page.
    expect(member).toMatch(/const eraEdits = useEraEdits\(profile\?\.id, !locked\);/);
  });

  it("waits for the arrangement before drawing either page, so a name never changes under the reader", () => {
    expect(eras(own)).toMatch(/loading=\{!posts\.isFetched \|\| !eraEdits\.isFetched\}/);
    expect(eras(member)).toMatch(/loading=\{!postsQ\.isFetched \|\| !eraEdits\.isFetched\}/);
  });

  it("tells the member, in our words, when a change does not save", () => {
    expect(hook).toMatch(/showAlert\(ERA_SAVE_FAILED\.title, errorMessage\(err, ERA_SAVE_FAILED\.body\)\)/);
    // Each over the member's photographs, so what no longer applies is let go as it saves.
    expect(hook).toMatch(/rename: \(key, title\) => void arrange\(\(e\) => renameEra\(e, key, title, posts\)\)/);
    expect(hook).toMatch(/const change = \(e: EraEdits\) => moveToEra\(e, posts, post\.id, key\);/);
    expect(hook).toMatch(/void arrange\(change\);\s*return true;/);
  });

  it("says whether a move was made, so the page announces only a real one", () => {
    expect(hook).toMatch(/move: \(post: PostRow, key: string\) => boolean;/);
    expect(hook).toMatch(/if \(!shown\?\.ready \|\| sameEdits\(change\(shown\.edits\), shown\.edits\)\) return false;/);
    expect(hook).toMatch(/return useMemo\(\(\) => \{\s*if \(!ready \|\| !userId \|\| !posts\) return undefined;\s*return eraEditor\(queryClient, userId, posts\);/);
  });
});

describe("the Eras view outside arranging", () => {
  it("offers EDIT only to an editor, and only over eras that are there", () => {
    expect(list).toMatch(/\{editor && !loading && summary\.eras\.length > 0 \? \([\s\S]{0,400}?<View ref=\{bar\} collapsable=\{false\}>\s*<View style=\{\[styles\.bar, arranging && styles\.barOn\]\}>/);
    expect(list).toMatch(/const arranging = editing && editor != null && summary\.eras\.length > 0;/);
    expect(list).toMatch(/\{editor \? <EraMoveSheet /);
  });

  it("opens the gallery from a print, as it always has", () => {
    expect(list).toMatch(/onOpen=\{\(post\) => \(arranging \? setMoving\(post\) : onOpenPost\(post, era\.key\)\)\}/);
    expect(list.match(/onOpenPost\(/g)).toHaveLength(1);
  });

  it("lays out the prints, the strip and Show all as before", () => {
    expect(list).toMatch(/const strip = eraStrip\(era, expanded \|\| arranging\);/);
    expect(list).toMatch(/const more = arranging \? null : eraMore\(era, expanded\);/);
    // A print is the tile in a plain view, with nothing else in it.
    expect(list).toMatch(/return \(\s*<View>\s*\{children\}\s*\{arranging \? \(\s*<View style=\{styles\.mark\}[^>]*>[\s\S]*?\) : null\}\s*<\/View>\s*\);/);
    expect(list).toMatch(/const hint = arranging \? "Moves it to another era\." : undefined;/);
  });

  it("draws nothing afresh on EDIT or DONE: the same view holds each print, and the page's children keep their places", () => {
    // Print has one shape: the tile is never handed back bare.
    const print = list.match(/function Print\([\s\S]*?\n\}/)?.[0] ?? "";
    expect(print).not.toMatch(/return children;/);
    expect(print.match(/return /g)).toHaveLength(1);
    // A list either way: on the web an absent one gives the header and chapters new keys.
    expect(list).toMatch(/stickyHeaderIndices=\{arranging \? \[barIndex\] : \[\]\}/);
    expect(list).not.toMatch(/stickyHeaderIndices=\{[^}]*undefined/);
  });

  it("leaves the reader on the chapter they were at when EDIT or DONE lays the page out again", () => {
    // Where the view begins, under the bar while it holds to the top, and the chapter there, by key.
    expect(list).toMatch(/onPress=\{\(\) => arrange\(!arranging\)\}/);
    expect(list).not.toMatch(/setEditing\(!arranging\)/);
    expect(list).toMatch(/const anchor = useRef<ChapterPlace \| null>\(null\);/);
    expect(list).toMatch(/<ScrollView\s+ref=\{scroller\}/);
    expect(list).toMatch(/<View ref=\{pageRef\} style=\{\[styles\.chapter, first && styles\.chapterFirst\]\} onLayout=\{onLayout\}>/);
    expect(list).toMatch(/if \(node\) pages\.current\.set\(era\.key, node\);\s*else pages\.current\.delete\(era\.key\);/);
    // Once laid out again, that chapter is measured where it now lies and put back at the top, at once.
    expect(list).toMatch(/useLayoutEffect\(\(\) => \{\s*const place = anchor\.current;\s*anchor\.current = null;/);
    // As far into it as they were where it lays every photograph out (depthAfter), judged by what it lays out, not by a height.
    expect(list).toMatch(/const whole = arranging \|\| eraWhole\(era, open\.has\(era\.key\)\);/);
    expect(list).toMatch(
      /page\.measureLayout\(book, \(_x, top, _width, tall\) =>\s*scroller\.current\?\.scrollTo\(\{ y: Math\.max\(0, top \+ depthAfter\(place, tall, whole\) - under\), animated: false \}\),\s*\);\s*\}, \[arranging\]\);/,
    );
  });

  it("measures the first chapter's top afresh as the reader taps, as the web leaves the one it reported out of date", () => {
    const arrange = list.match(/const arrange = \(on: boolean\) => \{[\s\S]*?\n  \};/)?.[0] ?? "";
    expect(arrange).toMatch(/const keys = summary\.eras\.map\(\(era\) => era\.key\);\s*const first = pages\.current\.get\(keys\[0\]\);\s*const book = innerView\(scroller\.current\);/);
    expect(arrange).toMatch(/first\.measureLayout\(book, \(_x, top\) => hold\(top\), \(\) => hold\(\)\);/);
    expect(arrange).toMatch(/anchor\.current = top == null \? null : chapterAt\(keys, spans\.current, top, offset\.current \+ under\);\s*setEditing\(on\);/);
    // Never from a top a chapter reported.
    expect(list).not.toMatch(/spans\.current\.get\(/);
    expect(list.match(/chapterAt\(/g)).toHaveLength(1);
  });

  it("measures the bar where it holds to the top, at the height arranging gives it, never as it last said", () => {
    // In both places, and asked before the chapter, so its answer is in hand by the chapter's.
    const under = /let under = 0;\s*(?:let held = false;[\s\S]*?)?if \(arranging\) bar\.current\?\.measureLayout\(book, \(_x, _y, _width, tall\) => \(under = tall\)\);/g;
    expect(list.match(under)).toHaveLength(2);
    const effect = list.match(/useLayoutEffect\(\(\) => \{\s*const place = anchor\.current;[\s\S]*?\}, \[arranging\]\);/)?.[0] ?? "";
    expect(effect.indexOf("bar.current?.measureLayout(")).toBeGreaterThan(-1);
    expect(effect.indexOf("bar.current?.measureLayout(")).toBeLessThan(effect.indexOf("page.measureLayout("));
    const arrange = list.match(/const arrange = \(on: boolean\) => \{[\s\S]*?\n  \};/)?.[0] ?? "";
    expect(arrange.indexOf("bar.current?.measureLayout(")).toBeGreaterThan(-1);
    expect(arrange.indexOf("bar.current?.measureLayout(")).toBeLessThan(arrange.indexOf("first.measureLayout("));
    // Nothing kept of what the bar said of itself.
    expect(list).not.toMatch(/barTall/);
    // The view measured is the one that holds to the top, and carries no style of its own:
    // React Native's sticky holder takes the child's style (padding, rule) onto itself and
    // leaves the child flex: 1, so a styled child would measure short of the bar by its padding.
    expect(list).toMatch(/<View ref=\{bar\} collapsable=\{false\}>/);
    expect(list).not.toMatch(/<View ref=\{bar\}[^>]*style=/);
    expect(list).toMatch(/const bar = useRef<View>\(null\);/);
  });

  it("never loses the tap to a measure left unanswered", () => {
    expect(list).toMatch(/const hold = \(top\?: number\) => \{\s*if \(held\) return;\s*held = true;/);
    expect(list).toMatch(/if \(!first \|\| !book\) return hold\(\);/);
    expect(list).toMatch(/first\.measureLayout\(book, \(_x, top\) => hold\(top\), \(\) => hold\(\)\);\s*setTimeout\(\(\) => hold\(\), 0\);/);
    expect(list.match(/setEditing\(/g)).toHaveLength(1);
  });

  it("shows RENAME only while arranging, and only where a name can be asked for", () => {
    expect(list).toMatch(/\{arranging && canNameEras \? \(\s*<Pressable\s+onPress=\{onRename\}/);
    expect(list.match(/onPress=\{onRename\}/g)).toHaveLength(1);
  });
});

describe("arranging, as VoiceOver hears it", () => {
  it("names EDIT and DONE for what they do", () => {
    expect(list).toMatch(/accessibilityLabel=\{arranging \? "Done arranging eras" : "Edit eras"\}/);
    expect(list).toMatch(/accessibilityHint=\{arranging \? undefined : "Rename your eras, and move photographs from one to another\."\}/);
  });

  it("names RENAME by its era, and says what it goes back to", () => {
    expect(list).toMatch(/accessibilityLabel=\{`Rename \$\{era\.title\}`\}/);
    expect(list).toMatch(/accessibilityHint=\{era\.renamed \? `Its automatic name is \$\{era\.key\}\.` : "Gives this era a name of your own\."\}/);
  });

  it("gives every print the hint that a tap moves it, and announces where it went", () => {
    expect(list.match(/accessibilityHint=\{hint\}/g)).toHaveLength(2);
    expect(list).toMatch(/AccessibilityInfo\.announceForAccessibility\(words\)/);
  });

  it("says a photograph moved, by note, touch and voice, only when the editor moved it", () => {
    expect(list).toMatch(/if \(editor\.move\(post, key\)\) say\(`Moved to \$\{to\.title\}`\);/);
    expect(list.match(/\bsay\(/g)).toHaveLength(1);
    expect(list.match(/editor\.move\(/g)).toHaveLength(1);
  });

  it("does not stop on MOVE, which the print's hint already says", () => {
    // aria-hidden for the web, which reads neither of the others.
    expect(list).toMatch(
      /<View style=\{styles\.mark\} pointerEvents="none" aria-hidden accessibilityElementsHidden importantForAccessibility="no-hide-descendants">\s*<Text style=\{styles\.markText\}>Move<\/Text>/,
    );
  });

  it("says moves and names aloud on the web too, where announceForAccessibility does nothing", () => {
    expect(list).toMatch(/const announce = \(words: string\) => \{\s*AccessibilityInfo\.announceForAccessibility\(words\);\s*if \(Platform\.OS === "web"\) setSpoken\(\{ words, at: Date\.now\(\) \}\);\s*\};/);
    expect(list).toMatch(/const say = \(words: string\) => \{[\s\S]{0,200}?announce\(words\);\s*\};/);
    expect(list).toMatch(/announce\(`Named \$\{cleanEraTitle\(title \?\? ""\) \|\| era\.key\}`\);/);
    expect(list.match(/AccessibilityInfo\.announceForAccessibility\(/g)).toHaveLength(1);
    // Always on the page while there is an editor, so a screen reader is listening before the words come.
    expect(list).toMatch(/\{editor && Platform\.OS === "web" \? \(\s*<View style=\{styles\.spoken\} aria-live="polite">[\s\S]*?\{spoken \? <Text key=\{spoken\.at\}>\{spoken\.words\}<\/Text> : null\}/);
  });

  it("does not read out the note of where a photograph went, which it announces itself", () => {
    expect(list).toMatch(
      /<Animated\.View\s+pointerEvents="none"\s+style=\{\[styles\.note, [^\n]*\]\}\s+aria-hidden\s+accessibilityElementsHidden\s+importantForAccessibility="no-hide-descendants"\s*>/,
    );
  });

  it("names each era in the sheet with its count, and the one it is in as where it is now", () => {
    expect(sheet).toMatch(/accessibilityLabel=\{`\$\{choice\.title\}, \$\{count\} \$\{count === 1 \? "photograph" : "photographs"\}\$\{choice\.here \? ", where it is now" : ""\}`\}/);
    expect(sheet).toMatch(/accessibilityState=\{\{ disabled: choice\.here, selected: choice\.here \}\}/);
    expect(sheet).toMatch(/disabled=\{choice\.here\}/);
    expect(sheet).toMatch(/onAccessibilityEscape=\{onClose\}/);
  });
});

describe("the sheet a move is chosen in", () => {
  it("is iOS's own page sheet, open while there is a photograph to move", () => {
    expect(sheet).toMatch(/<Modal visible=\{post != null\} animationType="slide" presentationStyle="pageSheet" onRequestClose=\{onClose\}>/);
  });

  it("lists every era it can go to, an emptied one too, and moves it with one tap", () => {
    expect(list).toMatch(/moveChoices\(posts, arranged, moving\.id\)/);
    expect(sheet).toMatch(/onPress=\{\(\) => choose\(choice\.key\)\}/);
    expect(sheet).toMatch(/choice\.era \? eraMeta\(choice\.era\) : "No photographs now"/);
  });

  it("keeps the photograph and its eras on it while it slides away, and shows a new one at once", () => {
    // Open, what it is given; closing, the last it was given while open.
    expect(sheet).toMatch(/if \(post && \(kept\?\.post !== post \|\| kept\.choices !== choices\)\) setKept\(\{ post, choices \}\);/);
    expect(sheet).toMatch(/const shown: Shown \| null = post \? \{ post, choices \} : kept;/);
    // Everything on it is drawn from that; whether it is up, from `post` alone.
    expect(sheet).toMatch(/\{shown \? \(/);
    expect(sheet).toMatch(/\{\(shown\?\.choices \?\? \[\]\)\.map\(\(choice\) => \{/);
    expect(sheet).toMatch(/const from = shown\?\.choices\.find\(\(c\) => c\.here\);/);
    const drawn = sheet.slice(sheet.indexOf("<Modal "), sheet.indexOf("</Modal>"));
    expect(drawn.match(/(?<![.\w])post\b(?!=)[^}]*/g)).toEqual(["post != null"]);
    expect(drawn.match(/(?<![.\w])choices\b/g)).toBeNull();
    expect(drawn).toMatch(/<PhotoTile post=\{shown\.post\} size=\{SUBJECT\}/);
  });

  it("takes one choice each time it opens, so a second tap on the way down moves nothing", () => {
    expect(sheet).toMatch(/const choose = \(key: string\) => \{\s*if \(!post \|\| chosen\.current\) return;\s*chosen\.current = true;\s*onChoose\(key\);\s*\};/);
    expect(sheet).toMatch(/useEffect\(\(\) => \{\s*if \(post\) chosen\.current = false;\s*\}, \[post\]\);/);
    expect(sheet.match(/onChoose\(/g)).toHaveLength(1);
    // And the page moves nothing once the sheet has let the photograph go.
    expect(list).toMatch(/const post = moving;\s*const to = choices\.find\(\(c\) => c\.key === key\);\s*setMoving\(null\);\s*if \(!post \|\| !to \|\| !editor\) return;/);
  });

  it("draws its photographs with the grid's own tile, never pressable on their own", () => {
    expect(sheet).toMatch(/import \{ PhotoTile \} from "\.\/PhotoGrid"/);
    expect(sheet.match(/<View pointerEvents="none"[^>]*>\s*(\{lead \? )?<PhotoTile/g)).toHaveLength(2);
  });
});

describe("asking for a name", () => {
  it("is iOS's own text alert, holding the name the era shows", () => {
    expect(naming).toMatch(/Alert\.prompt\(\s*ERA_NAME_TITLE,\s*message,/);
    expect(naming).toMatch(/"plain-text",\s*era\.title,\s*\)/);
    expect(naming).toMatch(/\{ text: "Save", onPress: \(value\?: string\) => onName\(value \?\? ""\) \}/);
  });

  it("offers the automatic name back only once the era has another", () => {
    expect(naming).toMatch(/\.\.\.\(era\.renamed \? \[\{ text: "Use the automatic name", onPress: \(\) => onName\(null\) \}\] : \[\]\)/);
  });

  it("is the browser's prompt where the demo runs, and is not offered where there is no text alert", () => {
    expect(naming).toMatch(/window\.prompt\(`\$\{ERA_NAME_TITLE\}\\n\\n\$\{message\} Leave it empty to use it\.`, era\.title\)/);
    expect(naming).toMatch(/export const canNameEras = Platform\.OS !== "android";/);
  });
});

describe("the words", () => {
  it("are the house's: plain, no exclamation marks, the typographer's apostrophe", () => {
    for (const [file, src] of [
      ["EraList", list],
      ["EraMoveSheet", sheet],
      ["eraName", naming],
    ] as const) {
      expect(src, file).not.toMatch(/"[^"\n]*![^"\n]*"|`[^`\n]*![^=`\n][^`\n]*`/);
      expect(src, file).not.toMatch(/"[^"\n]*\w'\w[^"\n]*"|>[^<{]*\w'\w[^<{]*</);
    }
    expect(list).toMatch(/>\{arranging \? "Done" : "Edit"\}</);
    expect(sheet).toMatch(/>\s*Move to\s*</);
    expect(naming).toMatch(/export const ERA_NAME_TITLE = "Rename this era";/);
    expect(naming).toMatch(/`Its automatic name is “\$\{automatic\}”\. Up to \$\{ERA_TITLE_MAX\} characters\.`/);
  });
});

describe("the automatic reading underneath", () => {
  const memories = code("src/utils/memories.ts");
  const eraEdits = code("src/utils/eraEdits.ts");

  it("is groupEras, as it was where no zone is given, and knows nothing of anyone's changes", () => {
    expect(memories).toMatch(
      /export function groupEras<T extends Pick<PostRow, "taken_at" \| "created_at" \| "location">>\(\s*posts: T\[\],\s*minSize = 2,\s*zone\?: string,\s*\): Era<T>\[\] \{/,
    );
    expect(memories).toMatch(/\.filter\(\(e\) => e\.posts\.length >= minSize\)/);
    // No zone, no calendar: the phone's own getters, as before.
    expect(memories).toMatch(/const calendar = zone \? calendarIn\(zone\) : null;/);
    expect(memories).toMatch(/return \{ year: taken\.getFullYear\(\), season: seasonOf\(taken\) \};/);
    expect(memories).not.toMatch(/eraEdits|EraEdits|edits/);
  });

  it("is where every arrangement starts, read once, in the arrangement's zone, never a second reading of its own", () => {
    expect(eraEdits).toMatch(/const automatic = groupEras\(posts, 1, edits\.zone\);/);
    expect(eraEdits.match(/groupEras\([^)]*\)/g)).toEqual(["groupEras(posts, 1, edits.zone)"]);
    expect(eraEdits).not.toMatch(/seasonOf|SEASONS|getFullYear/);
  });

  it("is read without the phone's random source, which only making an era reaches for", () => {
    expect(eraEdits).not.toMatch(/expo-crypto|^import[^\n]*newEraKey/m);
    expect(eraEdits.match(/require\(/g)).toHaveLength(1);
    const create = eraEdits.match(/export function createEra\([\s\S]*?\n\}/)?.[0] ?? "";
    expect(create).toMatch(/const key = \(makeId \?\? \(require\("\.\/newEraKey"\) as typeof import\("\.\/newEraKey"\)\)\.newEraKey\)\(\);/);
  });

  it("feeds On this day, which shows the member's names and arrangement too, once they have been read", () => {
    const day = code("app/memories.tsx");
    expect(day).toMatch(
      /const eras = useMemo\(\s*\(\) => \(eraEdits\.isFetched \? editEras\(posts\.data \?\? \[\], eraEdits\.data\?\.edits\) : \[\]\),\s*\[posts\.data, eraEdits\.data, eraEdits\.isFetched\],\s*\);/,
    );
    // Nor is "nothing" said before then.
    expect(day).toMatch(/const nothing =\s*posts\.isFetched &&\s*eraEdits\.isFetched &&/);
    expect(day).toMatch(/<View key=\{era\.key\} style=\{styles\.era\}>/);
    expect(day).not.toMatch(/groupEras\(/);
  });
});
