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
    expect(hook).toMatch(/rename: \(key, title\) => void arrange\(\(e\) => renameEra\(e, key, title\)\)/);
    expect(hook).toMatch(/move: \(post, key\) => void arrange\(\(e\) => moveToEra\(e, posts, post\.id, key\)\)/);
  });
});

describe("the Eras view outside arranging", () => {
  it("offers EDIT only to an editor, and only over eras that are there", () => {
    expect(list).toMatch(/\{editor && !loading && summary\.eras\.length > 0 \? \(\s*<View style=\{\[styles\.bar, arranging && styles\.barOn\]\}>/);
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
    // A print is the tile itself, with nothing around it.
    expect(list).toMatch(/if \(!arranging\) return children;/);
    expect(list).toMatch(/const hint = arranging \? "Moves it to another era\." : undefined;/);
    expect(list).toMatch(/stickyHeaderIndices=\{arranging \? \[barIndex\] : undefined\}/);
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
    expect(list).toMatch(/say\(`Moved to \$\{to\.title\}`\)/);
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
    expect(sheet).toMatch(/onPress=\{\(\) => onChoose\(choice\.key\)\}/);
    expect(sheet).toMatch(/choice\.era \? eraMeta\(choice\.era\) : "No photographs now"/);
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

  it("is groupEras, untouched, and knows nothing of anyone's changes", () => {
    expect(memories).toMatch(
      /export function groupEras<T extends Pick<PostRow, "taken_at" \| "created_at" \| "location">>\(\s*posts: T\[\],\s*minSize = 2,\s*\): Era<T>\[\] \{/,
    );
    expect(memories).toMatch(/\.filter\(\(e\) => e\.posts\.length >= minSize\)/);
    expect(memories).not.toMatch(/eraEdits|EraEdits|edits/);
  });

  it("is where every arrangement starts, never a second reading of its own", () => {
    expect(eraEdits).toMatch(/const automatic = groupEras\(posts\);/);
    expect(eraEdits).not.toMatch(/seasonOf|SEASONS|getFullYear/);
  });

  it("feeds On this day, which shows the member's names and arrangement too", () => {
    const day = code("app/memories.tsx");
    expect(day).toMatch(/const eras = useMemo\(\(\) => editEras\(posts\.data \?\? \[\], eraEdits\.data\?\.edits\), \[posts\.data, eraEdits\.data\]\);/);
    expect(day).toMatch(/<View key=\{era\.key\} style=\{styles\.era\}>/);
    expect(day).not.toMatch(/groupEras\(/);
  });
});
