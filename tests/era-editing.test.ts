import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Arranging Eras, read from the source: the controls are on your own page
 * and nowhere else, a member's page shows their arrangement and offers
 * nothing, nothing about the page changes outside arranging but EDIT
 * itself, what VoiceOver hears of it, how a name is asked for, and that
 * the automatic reading underneath is the one it always was. Then ADD,
 * NEW ERA, the way out of an era and the deleting of one, "Add to an
 * era…" from a photograph's options anywhere it is shown, and a print
 * dragged to another era. The logic is tested in eraEdits.test.ts,
 * era-making.test.ts, era-edits-api.test.ts, era-sheet.test.ts and
 * eraDrag.test.ts.
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
const gather = code("src/components/EraGather.tsx");
const sheetLogic = code("src/components/eraSheet.ts");
const naming = code("src/components/eraName.ts");
const route = code("app/era-move.tsx");
const actions = code("src/hooks/usePostActions.ts");
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
    expect(hook).toMatch(/move: \(post, key\) => changes\(\(e\) => moveToEra\(e, posts, post\.id, key\)\),/);
    expect(hook).toMatch(/void arrange\(change\);\s*return true;/);
  });

  it("adds, makes, takes out and deletes as one change each, through the one door that says whether it changed anything", () => {
    expect(hook).toMatch(/add: \(key: string, photoIds: string\[\]\) => boolean;/);
    expect(hook).toMatch(/create: \(name: string, photoIds: string\[\]\) => string \| null;/);
    expect(hook).toMatch(/takeOut: \(post: PostRow\) => boolean;/);
    expect(hook).toMatch(/deleteEra: \(key: string\) => boolean;/);
    expect(hook).toMatch(/add: \(key, photoIds\) => changes\(\(e\) => addToEra\(e, posts, key, photoIds\)\),/);
    expect(hook).toMatch(/takeOut: \(post\) => changes\(\(e\) => takeOut\(e, posts, post\.id\)\),/);
    expect(hook).toMatch(/deleteEra: \(key\) => changes\(\(e\) => deleteEra\(e, posts, key\)\),/);
    // Every change but a rename goes through `changes`, which arranges only a real one.
    expect(hook.match(/void arrange\(/g)).toHaveLength(2);
    expect(hook.match(/\bchanges\(\(e\) =>/g)).toHaveLength(5);
  });

  it("draws a new era's key once, from the phone's secure source, outside the change that may be made again", () => {
    expect(hook).toMatch(/import \{ newEraKey \} from "@\/utils\/newEraKey";/);
    expect(hook).toMatch(/makeKey: \(\) => string = newEraKey,/);
    expect(hook).toMatch(/const key = makeKey\(\);\s*return changes\(\(e\) => createEra\(e, posts, name, photoIds, \(\) => key\)\.edits\) \? key : null;/);
    expect(hook.match(/makeKey\(\)/g)).toHaveLength(1);
    const keys = code("src/utils/newEraKey.ts");
    expect(keys).toMatch(/import \{ getRandomBytes \} from "expo-crypto";/);
    expect(keys).toMatch(/const key = eraKeyFrom\(getRandomBytes\(ERA_KEY_BYTES\)\);/);
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
    expect(list).toMatch(/\{editor \? \(\s*<EraMoveSheet\s/);
  });

  it("opens the gallery from a print, as it always has", () => {
    expect(list).toMatch(/onOpen=\{\(post\) => \(arranging \? setSheet\(\{ kind: "move", post \}\) : onOpenPost\(post, era\.key\)\)\}/);
    expect(list.match(/onOpenPost\(/g)).toHaveLength(1);
  });

  it("lays out the prints, the strip and Show all as before", () => {
    expect(list).toMatch(/const strip = eraStrip\(era, expanded \|\| arranging\);/);
    expect(list).toMatch(/const more = arranging \? null : eraMore\(era, expanded\);/);
    // A print is the tile in a view of its own, with nothing else in it but MOVE while arranging;
    // the view only ever dims, while the print is lifted.
    expect(list).toMatch(
      /return \(\s*<View ref=\{self\} collapsable=\{false\} style=\{dim && styles\.left\}>\s*<PhotoTile\b[\s\S]*?\/>\s*\{arranging \? \(\s*<View style=\{styles\.mark\}[^>]*>[\s\S]*?\) : null\}\s*<\/View>\s*\);/,
    );
    expect(list).toMatch(/left: \{ opacity: 0\.3 \},/);
    expect(list).toMatch(/const hint = arranging \? "Moves it to another era\." : undefined;/);
    // Every print, the lead and the strip alike, is one Print, the lead alone given `full`.
    expect(list).toMatch(/<Print post=\{lead\} size=\{leadSize\.width\} height=\{leadSize\.height\} full=\{near\} dim=\{lifted === lead\.id\} \{\.\.\.print\} \/>/);
    expect(list).toMatch(/<Print key=\{post\.id\} post=\{post\} size=\{cell\} dim=\{lifted === post\.id\} \{\.\.\.print\} \/>/);
  });

  it("draws nothing afresh on EDIT or DONE: the same view holds each print, and the page's children keep their places", () => {
    // Print has one shape: the tile is never handed back bare.
    const print = list.match(/function Print\([\s\S]*?\n\}\n/)?.[0] ?? "";
    expect(print).toMatch(/<PhotoTile\b/);
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
    expect(list).toMatch(/accessibilityHint=\{arranging \? undefined : "Rename your eras, make new ones, and move photographs between them\."\}/);
  });

  it("names RENAME by its era, and says what it goes back to, or, for an era of the member's own, that it can be deleted", () => {
    expect(list).toMatch(/accessibilityLabel=\{`Rename \$\{era\.title\}`\}/);
    expect(list).toMatch(
      /accessibilityHint=\{\s*era\.made \? "Renames this era of yours, or deletes it\." : era\.renamed \? `Its automatic name is \$\{era\.key\}\.` : "Gives this era a name of your own\."\s*\}/,
    );
  });

  it("gives every print the hint that a tap moves it, and announces where it went", () => {
    // One Print draws every print, lead and strip alike.
    expect(list.match(/accessibilityHint=\{hint\}/g)).toHaveLength(1);
    expect(list.match(/<Print\b/g)).toHaveLength(2);
    expect(list).toMatch(/AccessibilityInfo\.announceForAccessibility\(words\)/);
  });

  it("says a change, by note, touch and voice, only when the editor made it", () => {
    // A move, from the sheet or a print let go over another era, through the one door.
    expect(list).toMatch(
      /const moveTo = \(post: PostRow, key: string, title: string\): boolean => \{\s*if \(!editor\?\.move\(post, key\)\) return false;\s*say\(movedNote\(title\)\);\s*return true;\s*\};/,
    );
    expect(list).toMatch(/if \(!to\) return;\s*moveTo\(shown\.post, key, to\.title\);/);
    expect(list).toMatch(/if \(editor\.takeOut\(shown\.post\)\) say\(takenOutNote\(shown\.out\)\);/);
    expect(list).toMatch(/if \(editor\.add\(shown\.key, photoIds\)\) say\(addedNote\(photoIds\.length, shown\.title\)\);/);
    expect(list).toMatch(/if \(editor\?\.create\(name, photoIds\)\) say\(madeNote\(name\)\);/);
    expect(list).toMatch(/if \(editor\?\.deleteEra\(era\.key\)\) say\(deletedNote\(era\.title\)\);/);
    // Five changes, each said once, each from the editor's own answer.
    expect(list.match(/\bsay\(/g)).toHaveLength(5);
    for (const change of ["move", "takeOut", "add", "create", "deleteEra"]) {
      expect(list.match(new RegExp(`editor\\??\\.${change}\\(`, "g")), change).toHaveLength(1);
    }
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
    expect(list).toMatch(/announce\(`Named \$\{cleanEraTitle\(title \?\? ""\) \|\| \(era\.made \? era\.title : era\.key\)\}`\);/);
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
  it("is iOS's own page sheet, open while there is something to show on it", () => {
    expect(sheet).toMatch(/<Modal visible=\{open\} animationType="slide" presentationStyle="pageSheet" onRequestClose=\{actions\.onClose\}>/);
    expect(sheet).toMatch(/const open = view != null;/);
    expect(sheet.match(/<Modal\b/g)).toHaveLength(1);
  });

  it("lists every era it can go to, an emptied one too, New era… last, and moves it with one tap", () => {
    expect(sheetLogic).toMatch(/const choices = moveChoices\(posts, edits, sheet\.post\.id, \{ newEra: true \}\);/);
    expect(list).toMatch(/const view = useMemo\(\(\) => eraSheetView\(posts, arranged, sheet\), \[sheet, posts, arranged\]\);/);
    expect(sheet).toMatch(/onPress=\{\(\) => onChoose\(choice\.key\)\}/);
    expect(sheet).toMatch(/choice\.era \? eraMeta\(choice\.era\) : "No photographs now"/);
  });

  it("keeps what was on it while it slides away, shows a new one at once, and draws each opening afresh", () => {
    // Open, what it is given; closing, the last it was given while open.
    expect(sheet).toMatch(/if \(view && kept !== view\) setKept\(view\);\s*const shown = view \?\? kept;/);
    // Counted each time it opens, and the body keyed by it, so nothing chosen or named lingers.
    expect(sheet).toMatch(/if \(round\.open !== open\) setRound\(\{ open, n: open \? round\.n \+ 1 : round\.n \}\);/);
    expect(sheet).toMatch(/\{shown \? <EraSheetBody key=\{round\.n\} view=\{shown\} live=\{open\} \{\.\.\.actions\} \/> : null\}/);
    const drawn = sheet.slice(sheet.indexOf("<Modal "), sheet.indexOf("</Modal>"));
    expect(drawn.match(/(?<![.\w])view\b(?!=)/g)).toBeNull();
  });

  it("takes one change each time it opens, and none on the way down, so a second tap changes nothing", () => {
    expect(sheet).toMatch(/const once =\s*<A extends unknown\[\]>\(act: \(\.\.\.args: A\) => void\) =>\s*\(\.\.\.args: A\) => \{\s*if \(!live \|\| done\.current\) return;\s*done\.current = true;\s*act\(\.\.\.args\);\s*\};/);
    expect(sheet).toMatch(/onChoose=\{once\(onMove\)\}/);
    expect(sheet).toMatch(/onTakeOut=\{once\(onTakeOut\)\}/);
    expect(sheet).toMatch(/onAdd=\{once\(onAdd\)\} onCreate=\{once\(onCreate\)\}/);
    // Turning to a new era is no change, but not on the way down either, nor after one.
    expect(sheet).toMatch(/onNewEra=\{\(\) => \{\s*if \(live && !done\.current\) onNewEra\(\);\s*\}\}/);
    // And the page changes nothing once the sheet has let go: each change reads the sheet as shown, then closes it.
    for (const change of ["move = (key: string)", "takeOut = ()", "add = (photoIds: string[])"]) {
      const body = list.slice(list.indexOf(`const ${change} => {`));
      expect(body, change).toMatch(/^const [^\n]+\{\s*const shown = view;\s*setSheet\(null\);\s*if \(shown\?\.kind !== "(move|add)"/);
    }
    expect(list).toMatch(/const create = \(name: string, photoIds: string\[\]\) => \{\s*setSheet\(null\);/);
  });

  it("draws its photographs with the grid's own tile, never pressable on their own", () => {
    expect(sheet).toMatch(/import \{ PhotoTile \} from "\.\/PhotoGrid"/);
    expect(sheet.match(/<View pointerEvents="none"[^>]*>\s*(\{lead \? )?<PhotoTile/g)).toHaveLength(2);
    expect(gather).toMatch(/import \{ PhotoTile \} from "\.\/PhotoGrid"/);
    expect(gather.match(/<View pointerEvents="none"[^>]*>\s*<PhotoTile/g)).toHaveLength(1);
    expect(gather.match(/<PhotoTile\b/g)).toHaveLength(1);
  });
});

describe("New era… and the way out, on Move to", () => {
  it("offers New era… as a button of its own, which turns the sheet and is never moved into", () => {
    expect(sheet).toMatch(/if \(choice\.newEra\) \{\s*return \(\s*<Pressable\s+key=\{choice\.key\}\s+onPress=\{onNewEra\}/);
    expect(sheet).toMatch(/accessibilityLabel="New era"\s+accessibilityHint="Begins a new era with this photograph\. You name it next\."/);
    // The page turns only Move to, and over to the new era with this photograph chosen.
    expect(list).toMatch(/const newEra = \(\) => setSheet\(\(now\) => \(now\?\.kind === "move" \? \{ kind: "new", chosen: \[now\.post\.id\] \} : now\)\);/);
    expect(list).toMatch(/const to = shown\.choices\.find\(\(c\) => c\.key === key && !c\.newEra\);/);
  });

  it("offers a photograph a move put where it is the way back, by name", () => {
    expect(sheetLogic).toMatch(/const out = takeOutChoice\(posts, edits, sheet\.post\.id\);/);
    expect(sheet).toMatch(/\{out \? \(\s*<Pressable\s+onPress=\{onTakeOut\}/);
    expect(sheet).toMatch(/accessibilityLabel=\{`\$\{takeOutTitle\(out\)\}\. \$\{takeOutMeta\(out\)\}\.`\}/);
  });
});

describe("ADD and NEW ERA", () => {
  const chapter = list.match(/function Chapter\([\s\S]*?\n\}\n/)?.[0] ?? "";

  it("puts ADD beside RENAME on every era while arranging, named by its era, and opens it for that era", () => {
    expect(chapter).toMatch(
      /\{arranging \? \(\s*<Pressable\s+onPress=\{onAdd\}\s+hitSlop=\{12\}\s+style=\{\(\{ pressed \}\) => \[styles\.rename, pressed && styles\.pressed\]\}\s+accessibilityRole="button"\s+accessibilityLabel=\{`Add to \$\{era\.title\}`\}\s+accessibilityHint="Choose photographs of yours to add to this era\."\s*>\s*<Text style=\{styles\.renameText\}>Add<\/Text>/,
    );
    expect(chapter.indexOf("onPress={onRename}")).toBeLessThan(chapter.indexOf("onPress={onAdd}"));
    expect(list).toMatch(/onAdd=\{\(\) => setSheet\(\{ kind: "add", key: era\.key \}\)\}/);
  });

  it("puts NEW ERA in the bar while arranging, beside DONE, inside the bar's own padding", () => {
    const bar = list.slice(list.indexOf("<View ref={bar} collapsable={false}>"), list.indexOf('testID="eras-edit"'));
    expect(bar).toMatch(
      /<View style=\{styles\.barRule\} \/>\s*\{arranging \? \(\s*<Pressable\s+onPress=\{\(\) => setSheet\(\{ kind: "new", chosen: \[\] \}\)\}[\s\S]*?accessibilityRole="button"\s+accessibilityLabel="New era"\s+accessibilityHint="Name an era of your own, and choose its photographs\."[\s\S]*?<Text style=\{styles\.barAction\}>New era<\/Text>\s*<\/Pressable>\s*\) : null\}\s*<Pressable\s+onPress=\{\(\) => arrange\(!arranging\)\}/,
    );
    // The view measured is still the bare one around it.
    expect(bar).toMatch(/^<View ref=\{bar\} collapsable=\{false\}>\s*<View style=\{\[styles\.bar, arranging && styles\.barOn\]\}>/);
  });

  it("lets an era of the member's own be deleted where its name cannot be asked for", () => {
    expect(chapter).toMatch(/\{arranging && !canNameEras && era\.made \? \(\s*<Pressable\s+onPress=\{onDelete\}[\s\S]*?accessibilityRole="button"\s+accessibilityLabel=\{`Delete \$\{era\.title\}`\}/);
    expect(list).toMatch(/onDelete=\{\(\) => confirmDeleteEra\(era\.title, \(\) => remove\(era\)\)\}/);
  });

  it("chooses photographs as checkboxes, says which are chosen, and on the web too", () => {
    expect(gather).toMatch(/accessibilityRole="checkbox"\s+accessibilityLabel=\{printLabel\(post\)\}\s+accessibilityState=\{\{ checked: on \}\}\s+aria-checked=\{on\}/);
    expect(gather).toMatch(/onPress=\{\(\) => toggle\(post\.id\)\}/);
    expect(gather).toMatch(/<Text style=\{styles\.groupTitle\} accessibilityRole="header"/);
  });

  it("does nothing until it can: Add with how many once one is chosen, Create once there is a name and a photograph", () => {
    expect(gather).toMatch(/const ready = making \? canCreate\(name, picked\) : picked\.length > 0;/);
    expect(gather).toMatch(/const label = making \? CREATE : addConfirm\(picked\.length\);/);
    expect(gather).toMatch(
      /onPress=\{confirm\}\s+disabled=\{!ready\}[\s\S]*?accessibilityRole="button"\s+accessibilityLabel=\{label\}\s+accessibilityState=\{\{ disabled: !ready \}\}/,
    );
    expect(sheetLogic).toMatch(/return cleanEraTitle\(name\) !== "" && chosen\.length > 0;/);
  });

  it("makes one change for the lot, from what is still offered", () => {
    expect(gather).toMatch(/const confirm = \(\) => \{\s*if \(!ready\) return;\s*if \(making\) onCreate\(name, picked\);\s*else onAdd\(picked\);\s*\};/);
    expect(gather).toMatch(/const picked = chosen\.filter\(\(id\) => offered\.has\(id\)\);/);
    expect(gather.match(/\bonAdd\(/g)).toHaveLength(1);
    expect(gather.match(/\bonCreate\(/g)).toHaveLength(1);
  });

  it("asks a new era's name in a field of its own, so it is asked the same way on every phone", () => {
    expect(gather).toMatch(/\{making \? \(\s*<View style=\{styles\.naming\}>[\s\S]*?<TextInput\s+value=\{name\}\s+onChangeText=\{setName\}\s+maxLength=\{ERA_TITLE_MAX\}/);
    expect(gather).toMatch(/accessibilityLabel="The new era’s name"/);
    expect(gather).not.toMatch(/Alert\.prompt|window\.prompt|canNameEras/);
  });

  it("offers what addChoices offers: every photograph not in that era, those in none first", () => {
    expect(sheetLogic).toMatch(/groups: addChoices\(posts, edits, era\.key\)/);
    expect(sheetLogic).toMatch(/return \{ kind: "new", groups: addChoices\(posts, edits, null\), chosen: sheet\.chosen \};/);
    // An era gone from the page takes its sheet with it.
    expect(list).toMatch(/useEffect\(\(\) => \{\s*if \(sheet && !view\) setSheet\(null\);\s*\}, \[sheet, view\]\);/);
  });
});

describe("Add to an era…, from a photograph's options", () => {
  it("is offered on your own photographs only, and only once your arrangement can be saved", () => {
    expect(actions).toMatch(/const erasReady = useEraEdits\(userId\)\.data\?\.ready === true;/);
    const own = actions.slice(actions.indexOf("if (post.author_id === userId) {"), actions.indexOf("} else {", actions.indexOf("if (post.author_id === userId) {")));
    expect(own).toMatch(
      /\.\.\.\(erasReady\s*\? \[\{ text: "Add to an era…", onPress: \(\) => router\.push\(\{ pathname: "\/era-move", params: \{ postId: post\.id \} \}\) \}\]\s*: \[\]\)/,
    );
    expect(actions.match(/Add to an era…/g)).toHaveLength(1);
    expect(actions).toMatch(/\[userId, router, queryClient, seed, deletePost, erasReady\]/);
  });

  it("opens over the screen it came from, as a sheet with its own head", () => {
    const layout = code("app/_layout.tsx");
    expect(layout).toMatch(/<Stack\.Screen name="era-move" options=\{\{ presentation: "modal", headerShown: false, title: "Add to an era" \}\} \/>/);
  });

  it("reads your photographs and arrangement where your page does, and changes them with the same editor", () => {
    expect(route).toMatch(/queryKey: \["user-posts", userId\],\s*queryFn: \(\) => fetchUserPosts\(userId\),/);
    expect(route).toMatch(/const eraEdits = useEraEdits\(userId\);/);
    expect(route).toMatch(/const editor = useEraEditor\(userId, posts\.data\);/);
    expect(route).toMatch(/eraSheetView\(posts\.data \?\? \[\], eraEdits\.data\?\.edits \?\? NO_EDITS, sheet\)/);
    expect(route).not.toMatch(/changeEraEdits|saveEraEdits|setQueryData/);
  });

  it("opens on the photograph as Move to, turns to a new era with it chosen, and closes after one change", () => {
    expect(route).toMatch(/turned \?\? \(post \? \{ kind: "move", post \} : null\)/);
    expect(route).toMatch(/onNewEra=\{\(\) => setTurned\(\(now\) => now \?\? \{ kind: "new", chosen: \[post\.id\] \}\)\}/);
    expect(route).toMatch(/<EraSheetBody\s+view=\{view\}\s+live\s/);
    expect(route).toMatch(/after\(to && editor\.move\(post, key\) \? movedNote\(to\.title\) : null\);/);
    expect(route).toMatch(/after\(out && editor\.takeOut\(post\) \? takenOutNote\(out\) : null\);/);
    expect(route).toMatch(/onCreate=\{\(name, photoIds\) => after\(editor\.create\(name, photoIds\) \? madeNote\(name\) : null\)\}/);
    expect(route).toMatch(/const after = \(words: string \| null\) => \{\s*if \(words\) AccessibilityInfo\.announceForAccessibility\(words\);\s*close\(\);\s*\};/);
  });

  it("says plainly when the photograph is not yours any more, or the eras cannot be changed", () => {
    expect(route).toMatch(/if \(!post \|\| !editor \|\| !view\) \{/);
    expect(route).toMatch(/accessibilityRole="button" accessibilityLabel="Close"/);
  });
});

describe("dragging a print to another era", () => {
  const print = list.match(/function Print\([\s\S]*?\n\}\n/)?.[0] ?? "";
  const lift = list.match(/const lift = \(held: Held, from: string, e: GestureResponderEvent\) => \{[\s\S]*?\n  \};/)?.[0] ?? "";
  const responder = list.match(/const responder = useMemo\([\s\S]*?\n  \);/)?.[0] ?? "";

  it("lifts a print only while arranging, held for LIFT_MS, from the print's own press, so a tap still opens the sheet", () => {
    expect(print).toMatch(
      /onPress=\{\(\) => onOpen\(post\)\}\s*onLongPress=\{arranging \? \(e\) => onLift\(\{ post, view: self\.current, width: size, height: height \?\? size, full: full === true \}, e\) : undefined\}\s*delayLongPress=\{LIFT_MS\}\s*onPressOut=\{arranging \? onLetGo : undefined\}/,
    );
    expect(lift).toMatch(/if \(!arranging \|\| drag\.current \|\| !print \|\| !book \|\| !page\) return;/);
    // The tile hands the hold to its own Pressable, counted from the touch in the browser too.
    const tile = code("src/components/PhotoGrid.tsx");
    expect(tile).toMatch(/onPress=\{onPress\}\s*onLongPress=\{onLongPress\}\s*delayLongPress=\{delayLongPress\}/);
    expect(tile).toMatch(/\{\.\.\.\(onLongPress && Platform\.OS === "web" \? \(\{ delayPressIn: 0 \} as object\) : null\)\}\s*onPressOut=\{onPressOut\}/);
  });

  it("takes the gesture from the print only once it has lifted, on the first move, and never a touch or a scroll", () => {
    expect(list).toMatch(/<View ref=\{root\} collapsable=\{false\} style=\{styles\.root\} \{\.\.\.responder\.panHandlers\}>/);
    expect(responder).toMatch(
      /onMoveShouldSetPanResponderCapture: \(\) => \{\s*const d = drag\.current;\s*if \(!d \|\| d\.claimed\) return false;\s*d\.claimed = true;\s*return true;\s*\},/,
    );
    // Nothing asks for a touch as it starts, nor for a move it was not lifted for.
    expect(responder).not.toMatch(/onStartShouldSetPanResponder|onMoveShouldSetPanResponder:/);
    expect(responder).toMatch(/onPanResponderTerminationRequest: \(\) => false,/);
    expect(responder).toMatch(/onPanResponderReject: \(\) => \{\s*if \(drag\.current\) drag\.current\.claimed = false;\s*\},/);
    // Made once: it reads the drag from refs, never from what a render closed over.
    expect(responder).toMatch(/\}\),\n    \[\],\n  \);$/);
  });

  it("holds the page and the tabs still while a print is dragged, and gives them back after", () => {
    expect(list).toMatch(/scrollEnabled=\{!dragging\}/);
    expect(list).toMatch(/useEffect\(\(\) => \(dragging \? holdTabSwipe\(\) : undefined\), \[dragging\]\);/);
    expect(lift).toMatch(/setDragging\(true\);/);
    expect(list).toMatch(/drag\.current = null;\s*if \(d\.frame != null\) cancelAnimationFrame\(d\.frame\);\s*setDragging\(false\);\s*setOver\(null\);/);
    expect(list.match(/setDragging\(/g)).toHaveLength(2);
  });

  it("measures where the chapters and the bar lie as the print lifts, against the page's own view, never as they last said", () => {
    expect(lift).toMatch(/const book = innerView\(scroller\.current\);/);
    // The bar first, so its height is in hand by the first chapter's answer, and laid just above that chapter.
    expect(lift).toMatch(
      /let under = 0;\s*bar\.current\?\.measureLayout\(book, \(_x, _y, _width, tall\) => \(under = tall\)\);\s*keys\.forEach\(\(key, i\) =>\s*pages\.current\.get\(key\)\?\.measureLayout\(book, \(_x, top, _width, tall\) => \{\s*if \(drag\.current !== d\) return;\s*d\.chapters\.set\(key, \{ key, top, height: tall \}\);\s*if \(i === 0\) d\.bar = \{ top: top - under, height: under \};/,
    );
    // The view and the print on the screen, the copy at the tile's own size.
    expect(lift).toMatch(/page\.measureInWindow\(\(x, y, _width, tall\) => \{\s*if \(drag\.current !== d\) return;\s*d\.view = \{ y, height: tall \};/);
    expect(lift).toMatch(/const \{ post, full, width: w, height: h \} = held;/);
  });

  it("finds the era under the finger and runs the page on near its edges by the tested arithmetic, with the page's own scroll", () => {
    expect(list).toMatch(/const to = dropTarget\(d\.from, eraUnderFinger\(pageOf\(d\), d\.finger\.y - d\.view\.y\)\);/);
    expect(list).toMatch(/const speed = edgeSpeed\(d\.finger\.y - d\.view\.y, \{ top: d\.bar\?\.height \?\? 0, bottom: d\.view\.height \}\);/);
    expect(list).toMatch(/const next = scrolledTo\(d\.offset, speed, ms, contentTall\.current - d\.view\.height\);/);
    expect(list).toMatch(/d\.offset = next;\s*scroller\.current\?\.scrollTo\(\{ y: next, animated: false \}\);\s*aim\(\);/);
    expect(list).toMatch(/onContentSizeChange=\{\(_width, tall\) => \(contentTall\.current = tall\)\}/);
    // The frames run once the page has the gesture, and stop with it, or with the page.
    expect(list).toMatch(/onPanResponderGrant: \(\) => act\.current\.take\(\),/);
    expect(list).toMatch(/if \(d\.frame == null\) d\.frame = requestAnimationFrame\(run\);/);
    expect(list.match(/cancelAnimationFrame\(d\.frame\)/g)).toHaveLength(2);
  });

  it("moves a print let go over another era by the sheet's own change, said as the sheet says it", () => {
    expect(list).toMatch(/onPanResponderRelease: \(\) => act\.current\.drop\(\),/);
    expect(list).toMatch(
      /const era = d\.over \? summary\.eras\.find\(\(e\) => e\.key === d\.over\) : undefined;\s*release\(\);\s*if \(era && moveTo\(d\.post, era\.key, era\.title\)\) setLifted\(\(now\) => \(now\?\.id === d\.id \? null : now\)\);\s*else putBack\(d\);/,
    );
    // Over its own era, there is nowhere to go.
    expect(code("src/components/eraDrag.ts")).toMatch(/return under != null && under !== from \? under : null;/);
  });

  it("puts the print back on anything else: another finger, the phone taking the touch, a hold let go, arranging over", () => {
    expect(responder).toMatch(/onPanResponderStart: \(_e, g\) => \{\s*if \(g\.numberActiveTouches > 1\) act\.current\.cancel\(\);\s*\},/);
    expect(responder).toMatch(/onPanResponderMove: \(_e, g\) => \{\s*if \(g\.numberActiveTouches > 1\) act\.current\.cancel\(\);\s*else act\.current\.follow\(g\.moveX, g\.moveY\);\s*\},/);
    expect(responder).toMatch(/onPanResponderTerminate: \(\) => act\.current\.cancel\(\),/);
    expect(list).toMatch(/const letGo = \(\) => \{\s*if \(drag\.current && !drag\.current\.claimed\) cancel\(\);\s*\};/);
    expect(list).toMatch(/useEffect\(\(\) => \{\s*if \(!arranging\) act\.current\.cancel\(\);\s*\}, \[arranging\]\);/);
    // Back to the print wherever the page has carried it.
    expect(list).toMatch(/Animated\.spring\(pan, \{ \.\.\.spring, toValue: \{ x: 0, y: d\.liftedAt - d\.offset \}/);
  });

  it("lifts and puts back at once under Reduce Motion, and lifts with a light touch on a phone", () => {
    expect(lift).toMatch(/if \(reducedMotion\.get\(\)\) raise\.setValue\(LIFT_SCALE\);\s*else \{/);
    expect(list).toMatch(/const gone = \(\) => setLifted\(\(now\) => \(now\?\.id === d\.id \? null : now\)\);\s*if \(reducedMotion\.get\(\)\) return gone\(\);/);
    expect(lift).toMatch(/if \(Platform\.OS !== "web"\) Haptics\.impactAsync\(Haptics\.ImpactFeedbackStyle\.Light\)/);
  });

  it("is for the eye and hand alone: nothing it draws is heard, touched or focused, and it adds no control", () => {
    const hidden = /pointerEvents="none"[\s\S]{0,400}?aria-hidden\s+accessibilityElementsHidden\s+importantForAccessibility="no-hide-descendants"\s+testID="(era-drag-print|era-drag-slip|era-drop-target)"/g;
    expect([...list.matchAll(hidden)].map((m) => m[1]).sort()).toEqual(["era-drag-print", "era-drag-slip", "era-drop-target"]);
    // Drawn over the page, so none of it moves a chapter under the finger.
    for (const style of ["lifted", "slipRow", "target"]) {
      expect(list, style).toMatch(new RegExp(`\\n  ${style}: \\{\\s*position: "absolute",`));
    }
    // The controls are those arranging already had: NEW ERA, EDIT and DONE, RENAME, DELETE, ADD, and Show all.
    expect(list.match(/<Pressable\b/g)).toHaveLength(6);
    expect(list.match(/accessibilityRole=/g)).toHaveLength(7);
  });

  it("keeps the browser from dragging a photograph away itself while arranging", () => {
    expect(list).toMatch(
      /if \(Platform\.OS !== "web" \|\| !arranging\) return;[\s\S]*?if \(!page\?\.contains\?\.\(e\.target\)\) return;\s*e\.preventDefault\(\);\s*e\.stopPropagation\(\);\s*\};\s*window\.addEventListener\("dragstart", keep, true\);\s*return \(\) => window\.removeEventListener\("dragstart", keep, true\);/,
    );
  });

  it("says in the bar that a photograph can be held and dragged", () => {
    expect(list).toMatch(/"Rename an era or add to it\. Tap a photograph to move it, or hold it and drag\."/);
    expect(list).toMatch(/"Add to an era\. Tap a photograph to move it, or hold it and drag\."/);
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

  it("offers an era of the member's own Delete era in its place, asked once more", () => {
    expect(naming).toMatch(
      /\.\.\.\(era\.made \? \[\{ text: "Delete era", style: "destructive" as const, onPress: \(\) => confirmDeleteEra\(era\.title, onDelete\) \}\] : \[\]\)/,
    );
    expect(naming).toMatch(/const message = era\.made \? MADE_ERA_NAME_MESSAGE : eraNameMessage\(era\.key\);/);
    expect(naming).toMatch(/export const MADE_ERA_NAME_MESSAGE = `An era of your own\. Up to \$\{ERA_TITLE_MAX\} characters\.`;/);
    const confirm = naming.match(/export function confirmDeleteEra\([\s\S]*?\n\}/)?.[0] ?? "";
    expect(confirm).toMatch(/showAlert\(`Delete “\$\{title\}”\?`, "Its photographs go back where they were\. None of them is deleted\.", \[/);
    expect(confirm).toMatch(/\{ text: "Delete era", style: "destructive", onPress: onDelete \},\s*\{ text: "Cancel", style: "cancel" \},/);
    // Deleted from EraList only through the editor, from this question.
    expect(list).toMatch(/\(\) => remove\(era\),\s*\);/);
  });

  it("asks in the browser too: an empty name deletes an era of the member's own, once asked", () => {
    expect(naming).toMatch(
      /if \(era\.made\) \{\s*const value = window\.prompt\(`\$\{ERA_NAME_TITLE\}\\n\\n\$\{message\} Leave it empty to delete it\.`, era\.title\);\s*if \(value === null\) return;\s*if \(cleanEraTitle\(value\)\) onName\(value\);\s*else confirmDeleteEra\(era\.title, onDelete\);\s*return;\s*\}/,
    );
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
      ["EraGather", gather],
      ["eraSheet", sheetLogic],
      ["era-move", route],
      ["eraName", naming],
      ["eraDrag", code("src/components/eraDrag.ts")],
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
