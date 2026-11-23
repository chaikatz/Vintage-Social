import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { QUICK_REACTIONS } from "@/utils/commentReactions";

/**
 * Every member's name the app draws opens that member's page, and every
 * @name in a caption or a comment does too. Writing a comment, a caption
 * or an edited caption, an @ offers the members it could be. The comment
 * field is a tall, rounded one with the member's own face beside it and
 * the quick reactions over it.
 */
const root = path.resolve(import.meta.dirname, "..");
const read = (file: string) => readFileSync(path.resolve(root, file), "utf8");
/** The code without its comments, so a sentence about a name is not taken for one drawn. */
const code = (file: string) =>
  read(file)
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");

/** A name drawn as plain bold words: the way every name was drawn before it was a link. */
const BARE_NAME = /<Text style=\{styles\.(captionAuthor|author|actor)\}>\{[^}]*username\}/;

/**
 * A link's style: the place's own, or, where the build has the Editorial
 * layout's names (tests/editorial-names.test.ts), that and the names' face.
 */
const linkStyle = (own: string) => `style=\\{(?:${own}|\\[${own}, face\\])\\}`;

describe("a name in a line of words", () => {
  const text = code("src/components/MemberText.tsx");

  it("is a link to the member's page, read as a link, that does what holding the line does when held", () => {
    expect(text).toMatch(/onPress=\{\(\) => onOpenProfile\(username\)\}\s*onLongPress=\{onLongPress\}\s*accessibilityRole="link"/);
  });

  it("an @name in the words is one too, and the words are read for names only when they change", () => {
    expect(text).toMatch(/export const MentionText = React\.memo\(function MentionText\(/);
    expect(text).toMatch(/const parts = useMemo\(\(\) => parseMentions\(text\), \[text\]\);/);
    expect(text).toMatch(/<NameLink\s+key=\{i\}\s+username=\{part\.username\}\s+onOpenProfile=\{onOpenProfile\}\s+onLongPress=\{onLongPress\}/);
  });
});

describe("the names under a photograph", () => {
  it("in the feed and a member's gallery (PostCard): the caption's name, the comments' names, and every @name", () => {
    const card = code("src/components/PostCard.tsx");
    expect(card).not.toMatch(BARE_NAME);
    expect(card).toMatch(/<NameLink username=\{post\.author\.username\} onOpenProfile=\{onOpenProfile\} style=\{styles\.captionAuthor\} \/>\{" "\}\s*<MentionText text=\{post\.caption\} onOpenProfile=\{onOpenProfile\} \/>/);
    const preview = card.match(/\{preview\.map\(\(c\) => \(\s*<Pressable\b[\s\S]*?<\/Pressable>/)?.[0] ?? "";
    expect(preview).toMatch(/<NameLink\s+username=\{c\.author\.username\}\s+onOpenProfile=\{onOpenProfile\}\s+onLongPress=\{onCommentLongPress \? \(\) => onCommentLongPress\(c\) : undefined\}/);
    expect(preview).toMatch(/<MentionText\s+text=\{c\.body\}\s+onOpenProfile=\{onOpenProfile\}\s+onLongPress=\{onCommentLongPress \? \(\) => onCommentLongPress\(c\) : undefined\}/);
    // To VoiceOver: a double tap opens Comments, never a name under the middle of the line; each name an action.
    expect(preview).toMatch(/onAccessibilityTap=\{\(\) => onOpenComments\(post\)\}\s*accessibilityActions=\{nameActions\(\[c\.author\.username, \.\.\.mentionedUsernames\(c\.body\)\]\)\}/);
    expect(preview).toMatch(/const username = nameFromAction\(e\.nativeEvent\.actionName\);\s*if \(username\) onOpenProfile\(username\);\s*\}\}/);
  });

  it("on a photograph's own page: the same, the tags, and the one it was opened from gone back to", () => {
    const page = code("app/post/[id].tsx");
    expect(page).not.toMatch(BARE_NAME);
    expect(page).not.toMatch(/router\.push\(`\/user\//);
    expect(page).toMatch(/const openMember = useOpenProfile\(\);/);
    expect(page.indexOf("const openMember = useOpenProfile();")).toBeLessThan(page.indexOf("if (!post || !authorShown(post))"));
    expect(page).toMatch(/<NameLink username=\{post\.author\.username\} onOpenProfile=\{openMember\} style=\{styles\.captionAuthor\} \/>\{" "\}\s*<MentionText text=\{post\.caption\} onOpenProfile=\{openMember\} \/>/);
    expect(page).toMatch(/<NameLink\s+username=\{c\.author\.username\}\s+onOpenProfile=\{openMember\}\s+onLongPress=\{\(\) => onCommentLongPress\(c\)\}/);
    expect(page).toMatch(/<MentionText text=\{c\.body\} onOpenProfile=\{openMember\} onLongPress=\{\(\) => onCommentLongPress\(c\)\} \/>/);
    expect(page).toMatch(/onPress=\{\(\) => openMember\(t\.member\.username\)\}\s*accessibilityRole="link"/);
    expect(page).toMatch(/onAccessibilityTap=\{\(\) => onOpenComments\(post\)\}\s*accessibilityActions=\{nameActions\(\[c\.author\.username, \.\.\.mentionedUsernames\(c\.body\)\]\)\}/);
  });

  it("on Comments: the caption's name, each comment's face and name, every @name; held, the comment's menu", () => {
    const comments = code("app/comments.tsx");
    expect(comments).not.toMatch(BARE_NAME);
    expect(comments).toMatch(/const openAuthor = useOpenProfile\(\);/);
    expect(comments).toMatch(
      new RegExp(`<NameLink username=\\{post\\.author\\.username\\} onOpenProfile=\\{openAuthor\\} ${linkStyle("styles\\.author")} \\/>\\{" "\\}\\s*<MentionText text=\\{post\\.caption\\} onOpenProfile=\\{openAuthor\\} \\/>`),
    );
    const row = comments.slice(comments.indexOf("const CommentRow = React.memo("), comments.indexOf("function Composer("));
    expect(row).toMatch(/const hold = \(\) => onLongPress\(comment\);/);
    expect(row).toMatch(/onPress=\{\(\) => onOpenAuthor\(comment\.author\.username\)\}\s*onLongPress=\{hold\}/);
    expect(row).toMatch(new RegExp(`<NameLink username=\\{comment\\.author\\.username\\} onOpenProfile=\\{onOpenAuthor\\} onLongPress=\\{hold\\} ${linkStyle("styles\\.author")} \\/>`));
    expect(row).toMatch(/<MentionText text=\{comment\.body\} onOpenProfile=\{onOpenAuthor\} onLongPress=\{hold\} \/>/);
    // The row's names for VoiceOver are worked out once per comment, not on every draw.
    expect(row).toMatch(/const actions = useMemo\(\s*\(\) => nameActions\(\[comment\.author\.username, \.\.\.mentionedUsernames\(comment\.body\)\]\),/);
    // VoiceOver's double tap opens the comment's menu, as a hold does: the row has no press of its own.
    expect(row).toMatch(/onLongPress=\{\(\) => onLongPress\(comment\)\}\s*onAccessibilityTap=\{hold\}\s*accessibilityActions=\{actions\}\s*onAccessibilityAction=\{onAction\}\s*accessibilityHint="Opens the comment’s options"/);
  });

  it("in the Editorial layout's card too, where the build has it: the same names and @names as PostCard", () => {
    // It takes PostCard's props and draws its own caption and previews; they must link as PostCard's do.
    const file = "src/components/feed/EditorialPostCard.tsx";
    if (!existsSync(path.resolve(root, file))) return;
    const card = code(file);
    expect(card).not.toMatch(BARE_NAME);
    expect(card).toMatch(/<NameLink username=\{post\.author\.username\} onOpenProfile=\{onOpenProfile\}/);
    expect(card).toMatch(/<MentionText text=\{post\.caption\} onOpenProfile=\{onOpenProfile\} \/>/);
    const previews = card.match(/\{preview\.map\(\(c\) => \(\s*<Pressable\b[\s\S]*?<\/Pressable>/g) ?? [];
    expect(previews.length).toBeGreaterThan(0);
    for (const preview of previews) {
      expect(preview).toMatch(/<NameLink\s+username=\{c\.author\.username\}\s+onOpenProfile=\{onOpenProfile\}/);
      expect(preview).toMatch(/<MentionText\s+text=\{c\.body\}\s+onOpenProfile=\{onOpenProfile\}/);
      expect(preview).toMatch(/onAccessibilityTap=\{\(\) => onOpenComments\(post\)\}\s*accessibilityActions=\{nameActions\(/);
      expect(preview).not.toMatch(/"activate"/);
    }
  });

  it("a post still going up, on Home, reads as it will once posted", () => {
    const pending = code("src/components/PendingPostCard.tsx");
    expect(pending).toMatch(new RegExp(`<NameLink username=\\{draft\\.author\\.username\\} onOpenProfile=\\{onOpenProfile\\} ${linkStyle("styles\\.captionAuthor")} \\/>`));
    expect(pending).toMatch(/<MentionText text=\{draft\.caption\.trim\(\)\} onOpenProfile=\{onOpenProfile\} \/>/);
    expect(pending).toMatch(/style=\{styles\.headerText\}\s*onPress=\{\(\) => onOpenProfile\?\.\(draft\.author\.username\)\}/);
  });
});

describe("a row's names, as VoiceOver reaches them", () => {
  const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap((f) => {
      const p = path.join(dir, f);
      return statSync(p).isDirectory() ? walk(p) : /\.tsx?$/.test(f) ? [p] : [];
    });
  const rows = [...walk(path.join(root, "app")), ...walk(path.join(root, "src"))]
    .map((p) => path.relative(root, p))
    .filter((f) => f !== "src/utils/nameActions.ts" && code(f).includes("nameActions("));

  it("are on every row that draws a name inside it", () => {
    expect(rows.sort()).toEqual([
      "app/(tabs)/activity.tsx",
      "app/comments.tsx",
      "app/messages/[id].tsx",
      "app/messages/index.tsx",
      "app/post/[id].tsx",
      "src/components/PostCard.tsx",
      "src/components/feed/EditorialPostCard.tsx",
    ]);
  });

  it("never as an action named activate, which the new architecture lists as one and never sends on a double tap", () => {
    for (const f of rows) {
      expect(code(f), f).not.toMatch(/"activate"/);
    }
  });

  it("leave the row's double tap to the row, on each row that offers them", () => {
    for (const f of rows) {
      const src = code(f);
      const offered = (src.match(/accessibilityActions=\{(nameActions\(|actions\})/g) ?? []).length;
      expect(offered, f).toBeGreaterThan(0);
      expect((src.match(/onAccessibilityTap=\{/g) ?? []).length, f).toBe(offered);
    }
  });
});

describe("names everywhere else", () => {
  it("a notice's face and name open the member; the rest of it, what it is about", () => {
    const activity = code("app/(tabs)/activity.tsx");
    expect(activity).not.toMatch(BARE_NAME);
    expect(activity).toMatch(/const openMember = useOpenProfile\(\);/);
    expect(activity).toMatch(new RegExp(`<NameLink username=\\{item\\.actor\\.username\\} onOpenProfile=\\{openMember\\} ${linkStyle("styles\\.actor")} \\/>`));
    expect(activity).toMatch(/onPress=\{\(\) => openMember\(item\.actor!\.username\)\}/);
    expect(activity).toMatch(/onAccessibilityTap=\{\(\) => open\(item\)\}\s*accessibilityActions=\{nameActions\(\[isModeration \? null : item\.actor\?\.username\]\)\}/);
  });

  it("the inbox: their face opens their page, the row the conversation", () => {
    const inbox = code("app/messages/index.tsx");
    expect(inbox).toMatch(/onPress=\{\(\) => onOpenProfile\(conversation\.peer\.username\)\}/);
    expect(inbox).toMatch(/onOpenProfile=\{openMember\}/);
    expect(inbox).toMatch(/onAccessibilityTap=\{onPress\}\s*accessibilityActions=\{nameActions\(\[conversation\.peer\.username\]\)\}/);
  });

  it("a thread: its title and a photograph's member, gone back to when the thread was opened from their page", () => {
    const thread = code("app/messages/[id].tsx");
    expect(thread).not.toMatch(/router\.push\(`\/user\//);
    // The line around it sets its type and ink; the name itself has no style of its own but, where the build has it, the names' face.
    expect(thread).toMatch(/<NameLink username=\{shared\.author\.username\} onOpenProfile=\{onOpenProfile\}(?: style=\{face\})? \/>/);
    expect(thread).toMatch(/<Bubble message=\{item\} mine=\{item\.sender_id === userId\} onOpenPost=\{openPost\} onOpenProfile=\{openMember\} \/>/);
    expect(thread).toMatch(/onAccessibilityTap=\{\(\) => onOpenPost\(shared\.id\)\}\s*accessibilityActions=\{nameActions\(\[shared\.author\?\.username\]\)\}/);
  });

  it("the gallery's cards, gone back to their member's page when opened from it", () => {
    expect(code("app/gallery.tsx")).toMatch(/const openProfile = useOpenProfile\(\);/);
    expect(code("app/gallery.tsx")).not.toMatch(/router\.push\(`\/user\//);
  });

  it("the members you blocked, and the names on a report", () => {
    const blocked = code("app/blocked.tsx");
    expect(blocked).toMatch(/onPress=\{\(\) => openMember\(item\.username\)\}\s*accessibilityRole="button"\s*accessibilityLabel=\{memberLabel\(item\.username, item\.full_name\)\}/);
    // Unblock stands beside the member, not inside the part that opens them.
    expect(blocked.indexOf("</Pressable>")).toBeLessThan(blocked.indexOf("accessibilityLabel={`Unblock ${item.username}`}"));
    const reports = code("app/admin/reports.tsx");
    expect(reports.match(/\{nameOf\(/g)).toHaveLength(3);
  });

  it("every list of members already opens each one", () => {
    for (const file of ["app/likes.tsx", "app/follows.tsx", "app/requests.tsx", "app/admin/members.tsx"]) {
      expect(code(file), file).toMatch(/onPress=\{\(\) => router\.push\(`\/user\/\$\{item\.username\}`\)\}/);
    }
    // Search opens a result through openMember, which also files it in Recent.
    const search = code("app/(tabs)/search.tsx");
    expect(search).toMatch(/const openMember = useCallback\([\s\S]*?router\.push\(`\/user\/\$\{username\}`\);/);
    expect(search).toMatch(/<SearchResult member=\{item\} onOpen=\{openMember\} \/>/);
    expect(search).toMatch(/onPress=\{\(\) => onOpen\(member\)\}/);
    expect(search).toMatch(/onPress=\{\(\) => openMember\(item\)\}/);
  });
});

describe("the comment field", () => {
  const comments = code("app/comments.tsx");
  const composer = comments.slice(comments.indexOf("function Composer("), comments.indexOf("function useKeyboardShown("));
  const style = (name: string) => comments.match(new RegExp(`^ {2}${name}: \\{[\\s\\S]*?\\n {2}\\},`, "m"))?.[0] ?? comments.match(new RegExp(`^ {2}${name}: \\{.*\\},$`, "m"))?.[0] ?? "";

  it("has the eight quick reactions the owner asked for, in Instagram's order, read by name", () => {
    expect(QUICK_REACTIONS.map((r) => r.emoji)).toEqual(["❤️", "\u{1F64C}", "\u{1F525}", "\u{1F44F}", "\u{1F622}", "\u{1F60D}", "\u{1F62E}", "\u{1F602}"]);
    expect(QUICK_REACTIONS.map((r) => r.name)).toEqual(["Heart", "Raised hands", "Fire", "Clapping", "Crying", "Heart eyes", "Surprised", "Tears of joy"]);
    expect(comments).toMatch(/const Reactions = React\.memo\(function Reactions\(/);
    expect(comments).toMatch(/onPress=\{\(\) => onReact\(r\.emoji\)\}/);
    expect(comments).toMatch(/accessibilityLabel=\{`Add \$\{r\.name\.toLowerCase\(\)\}`\}/);
  });

  it("puts a reaction in at the caret, held to the length a comment can be, and leaves the field ready", () => {
    expect(composer).toMatch(/const next = insertAtCaret\(latest\.current, caretAt\(\), emoji, MAX_COMMENT_LENGTH\);\s*if \(!next\) return;/);
    expect(composer).toMatch(/input\.current\?\.focus\(\);/);
  });

  it("is the member's own face beside a tall, rounded field, with Post at its end", () => {
    expect(composer).toMatch(/<Avatar path=\{profile\?\.avatar_url\} username=\{profile\?\.username \?\? "\?"\} size=\{34\} \/>/);
    const height = Number(comments.match(/const FIELD_HEIGHT = (\d+);/)?.[1]);
    expect(height).toBeGreaterThanOrEqual(44);
    expect(style("field")).toMatch(/minHeight: FIELD_HEIGHT,/);
    expect(style("field")).toMatch(/borderRadius: FIELD_HEIGHT \/ 2,/);
    // Post: a target as tall as the field's first line, past iOS's 44 points, taller if its word needs it.
    expect(style("post")).toMatch(/minHeight: FIELD_HEIGHT - 2,/);
    expect(style("post")).not.toMatch(/\n\s*height:/);
    expect(height - 2).toBeGreaterThanOrEqual(44);
    expect(style("send")).toMatch(/color: colors\.accent/);
    // Its word grows with the reader's text size only so far: at the largest sizes it would outgrow the field.
    expect(composer).toMatch(/<Text style=\{\[styles\.send, !ready && styles\.sendDisabled\]\} maxFontSizeMultiplier=\{POST_TYPE_CAP\}>/);
    const cap = Number(comments.match(/const POST_TYPE_CAP = ([\d.]+);/)?.[1]);
    expect(cap).toBeGreaterThan(1);
    // A line of 15-point type at that size, about 1.2 of its size tall, still fits the target.
    expect(15 * cap * 1.2).toBeLessThanOrEqual(height - 2);
  });

  it("shares the row among the eight reactions, so the last is not cut off on a 320-point phone", () => {
    const reaction = style("reaction");
    expect(reaction).toMatch(/flex: 1,/);
    expect(reaction).toMatch(/maxWidth: REACTION_MAX,/);
    expect(reaction).not.toMatch(/\n\s*width:/);
    expect(style("reactions")).toMatch(/justifyContent: "space-between",/);
    expect(style("composer")).toMatch(/paddingHorizontal: spacing\.md,/);
    const margins = 2 * 12; // spacing.md either side of the bar
    const max = Number(comments.match(/const REACTION_MAX = (\d+);/)?.[1]);
    const each = (screen: number) => Math.min(max, (screen - margins) / QUICK_REACTIONS.length);
    // The narrowest phone this build runs on (src/components/gate/GateButton.tsx): the eight and the margins fit.
    expect(each(320) * QUICK_REACTIONS.length + margins).toBeLessThanOrEqual(320);
    // At a fixed 40 they did not: 344 points on a 320-point screen.
    expect(40 * QUICK_REACTIONS.length + margins).toBeGreaterThan(320);
    // Each still holds its emoji, drawn at 24 points and not scaled, about 30 wide.
    expect(style("reactionText")).toMatch(/fontSize: 24/);
    expect(comments).toMatch(/<Text style=\{styles\.reactionText\} allowFontScaling=\{false\}>/);
    expect(each(320)).toBeGreaterThanOrEqual(32);
    // On a larger phone, a full target each.
    expect(max).toBeGreaterThanOrEqual(44);
    expect(each(390)).toBe(max);
  });

  it("keeps the field still as the reactions and the members offered take each other's place", () => {
    expect(style("reactions")).toMatch(/minHeight: MENTION_ROW_HEIGHT,/);
    const chips = code("src/components/MentionSuggestions.tsx");
    expect(chips).toMatch(/export const MENTION_ROW_HEIGHT = CHIP_HEIGHT \+ spacing\.xs \* 2;/);
    expect(chips).toMatch(/content: \{ gap: spacing\.sm, paddingVertical: spacing\.xs \},/);
    expect(chips).toMatch(/minHeight: CHIP_HEIGHT,/);
    expect(chips).toMatch(/<Avatar path=\{m\.avatar_url\} username=\{m\.username\} size=\{26\} \/>/);
    const chip = Number(chips.match(/const CHIP_HEIGHT = (\d+);/)?.[1]);
    // Each reaction's target fits the row it shares with nothing else.
    expect(Number(style("reaction").match(/height: (\d+),/)?.[1])).toBeLessThanOrEqual(chip + 2 * 4);
  });

  it("does all the old field did: the length held, Post only with words and not while sending, our words on failure", () => {
    expect(composer).toMatch(/onChangeText=\{\(t\) => setDraft\(t\.slice\(0, MAX_COMMENT_LENGTH\)\)\}/);
    expect(composer).toMatch(/inputAccessoryViewID=\{KEYBOARD_DONE\}/);
    expect(composer).toMatch(/const ready = Boolean\(draft\.trim\(\)\) && !send\.isPending;/);
    expect(composer).toMatch(/disabled=\{!ready\}\s*onPress=\{\(\) => send\.mutate\(draft\)\}/);
    expect(composer).toMatch(/accessibilityLabel="Post comment"\s*accessibilityState=\{\{ disabled: !ready, busy: send\.isPending \}\}/);
    expect(composer).toMatch(/showAlert\("Couldn’t post the comment", errorMessage\(err, "Your words are still here\. Try again in a moment\."\)\)/);
    expect(composer).toMatch(/setDraft\(""\);\s*onPosted\(\);/);
  });

  it("sits over the keyboard while it is up, and clear of the home indicator with room to spare without it", () => {
    expect(comments).toMatch(/keyboardVerticalOffset=\{headerHeight\}/);
    expect(composer).toMatch(/paddingBottom: keyboardShown \? spacing\.sm : insets\.bottom \+ spacing\.sm/);
  });

  it("keeps the words in the bar, so typing draws the bar again and not the comments", () => {
    expect(composer).toMatch(/const \[draft, setDraft\] = useState\(""\);/);
    const screen = comments.slice(comments.indexOf("export default function Comments("), comments.indexOf("const CommentRow = React.memo("));
    expect(screen).not.toMatch(/useState\(/);
    expect(screen).toMatch(/<Composer postId=\{postId \?\? ""\} userId=\{userId\} onPosted=\{onPosted\} \/>/);
  });

  it("swaps the reactions for the members a name could be while one is written", () => {
    expect(composer).toMatch(/const field = useMentionField\(draft, setDraft, MAX_COMMENT_LENGTH\);/);
    expect(composer).toMatch(/<MentionSuggestions\s+mention=\{field\.mention\}\s+myId=\{userId\}\s+onPick=\{choose\}\s+fallback=\{<Reactions onReact=\{react\} \/>\}/);
    expect(composer).toMatch(/pick\(username\);\s*input\.current\?\.focus\(\);/);
    expect(composer).toMatch(/onSelectionChange=\{field\.onSelectionChange\}\s*onFocus=\{field\.onFocus\}\s*onBlur=\{field\.onBlur\}/);
  });
});

describe("@names while a caption is written", () => {
  for (const [file, setter] of [
    ["app/compose.tsx", "setCaption"],
    ["app/edit-caption.tsx", "setDraft"],
  ] as const) {
    it(`${file} offers the members an @name could be, and writes the one chosen`, () => {
      const src = code(file);
      expect(src).toMatch(new RegExp(`const captionField = useMentionField\\(caption, ${setter}, MAX_CAPTION_LENGTH\\);`));
      expect(src).toMatch(/onSelectionChange=\{captionField\.onSelectionChange\}\s*onFocus=\{captionField\.onFocus\}\s*onBlur=\{captionField\.onBlur\}/);
      expect(src).toMatch(/<MentionSuggestions\s+mention=\{captionField\.mention\}\s+myId=\{session\?\.user\?\.id \?\? ""\}\s+onPick=\{captionField\.pick\}/);
    });
  }
});

describe("the members offered while a caption is written, over the keyboard", () => {
  it("compose: told the header's height, the publish bar and the names over it clear the keyboard, as Comments' bar does", () => {
    // KeyboardAvoidingView measures the page from under its header and the keyboard from the top of the window.
    const compose = code("app/compose.tsx");
    expect(compose).toMatch(/import \{ useHeaderHeight \} from "@react-navigation\/elements";/);
    expect(compose).toMatch(/const headerHeight = useHeaderHeight\(\);/);
    expect(compose.indexOf("const headerHeight = useHeaderHeight();")).toBeLessThan(compose.indexOf("return ("));
    expect(compose).toMatch(/<KeyboardAvoidingView\s+style=\{styles\.root\}\s+behavior=\{Platform\.OS === "ios" \? "padding" : undefined\}\s+keyboardVerticalOffset=\{headerHeight\}\s*>/);
    expect(compose.match(/<KeyboardAvoidingView\b/g)).toHaveLength(1);
    // The names are in the bar at the foot, inside the view that rises.
    const bar = compose.slice(compose.indexOf("<View style={styles.footer}>"), compose.indexOf("</KeyboardAvoidingView>"));
    expect(bar).toMatch(/<MentionSuggestions\s+mention=\{captionField\.mention\}/);
  });

  it("Edit caption: the sheet rises by as far as the keyboard comes up, so the names, Cancel and Save sit just above it", () => {
    // A page sheet's KeyboardAvoidingView measured from the sheet's own top and left its foot under the keyboard.
    const sheet = code("app/edit-caption.tsx");
    expect(sheet).not.toMatch(/KeyboardAvoidingView/);
    expect(sheet).toMatch(/const lift = useSheetKeyboardLift\(\);/);
    const view = sheet.slice(sheet.indexOf("<View style={[styles.root, { paddingBottom: lift }]}>"));
    expect(view.length).toBeLessThan(sheet.length);
    const at = (s: string) => view.indexOf(s);
    expect(at("<View style={styles.body}>")).toBeGreaterThan(0);
    expect(at("<MentionSuggestions")).toBeGreaterThan(at("<View style={styles.body}>"));
    expect(at("<View style={styles.footer}>")).toBeGreaterThan(at("<MentionSuggestions"));
    // A long caption scrolls in its own space rather than running on under them.
    expect(sheet).toMatch(/minHeight: 140,\s*flexShrink: 1,/);

    const hook = code("src/hooks/useSheetKeyboardLift.ts");
    expect(hook).toMatch(/useLayoutEffect\(\(\) => \{\s*if \(Platform\.OS !== "ios"\) return;/);
    expect(hook).toMatch(/Keyboard\.addListener\("keyboardWillShow", \(e\) =>\s*move\(e, keyboardLift\(e\.endCoordinates\.screenY, Dimensions\.get\("window"\)\.height\)\),\s*\);/);
    expect(hook).toMatch(/Keyboard\.addListener\("keyboardWillHide", \(e\) => move\(e, 0\)\);/);
    expect(hook).toMatch(/return \(\) => \{\s*shown\.remove\(\);\s*hidden\.remove\(\);\s*\};\s*\}, \[\]\);/);
    expect(hook).toMatch(/import \{ keyboardLift \} from "@\/components\/eraSheet";/);
  });
});

describe("the members offered", () => {
  const hook = code("src/hooks/useMentionField.ts");

  it("are read only once a name is started: whom the writer follows, from the list Who was there reads", () => {
    expect(hook).toMatch(/queryKey: \["following-list", myId, "pages"\],/);
    expect(hook).toMatch(/enabled: open && Boolean\(myId\),/);
    // Its first page; never every page of it.
    expect(hook).not.toMatch(/fetchNextPage/);
    expect(code("src/components/TagPicker.tsx")).toMatch(/queryKey: \["following-list", myId, "pages"\],/);
  });

  it("then a search a beat after typing rests, through the search the Search tab uses, once two letters are typed", () => {
    expect(hook).toMatch(/const settled = useDebounced\(query, SEARCH_AFTER_MS\)\.trim\(\);/);
    expect(hook).toMatch(/queryFn: \(\) => searchProfiles\(settled\),\s*enabled: open && settled\.length >= 2,/);
    expect(hook).toMatch(/rankMentionSuggestions\(query, /);
  });

  it("follow the caret without drawing the screen again for every letter", () => {
    expect(hook).toMatch(/const caret = useRef\(value\.length\);/);
    expect(hook).toMatch(/if \(mentionKey\(inUse \? activeMention\(words, caret\.current\) : null\) !== key\) redraw\(\);/);
    expect(hook).not.toMatch(/useState\(value\.length\)/);
  });

  it("are chips a tap chooses with the keyboard up", () => {
    const chips = code("src/components/MentionSuggestions.tsx");
    expect(chips).toMatch(/keyboardShouldPersistTaps="always"/);
    expect(chips).toMatch(/onPress=\{\(\) => onPick\(m\.username\)\}/);
    expect(chips).toMatch(/accessibilityLabel=\{memberLabel\(m\.username, m\.full_name\)\}/);
    expect(chips).toMatch(/if \(members\.length === 0\) return fallback;/);
  });
});

describe("emoji", () => {
  const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap((f) => {
      const p = path.join(dir, f);
      return statSync(p).isDirectory() ? walk(p) : /\.tsx?$/.test(f) ? [p] : [];
    });

  it("VINTAGE writes none in its own words: the reactions are written as escapes, in one file", () => {
    const drawn = [...walk(path.join(root, "app")), ...walk(path.join(root, "src"))].filter((p) =>
      /\p{Extended_Pictographic}/u.test(readFileSync(p, "utf8")),
    );
    expect(drawn.map((p) => path.relative(root, p))).toEqual([]);
    const users = [...walk(path.join(root, "app")), ...walk(path.join(root, "src"))].filter((p) => readFileSync(p, "utf8").includes("QUICK_REACTIONS"));
    expect(users.map((p) => path.relative(root, p)).sort()).toEqual(["app/comments.tsx", "src/utils/commentReactions.ts"]);
  });
});
