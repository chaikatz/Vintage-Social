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
    // To VoiceOver: opened, Comments; each name an action.
    expect(preview).toMatch(/accessibilityActions=\{\[\{ name: "activate" \}, \.\.\.nameActions\(\[c\.author\.username, \.\.\.mentionedUsernames\(c\.body\)\]\)\]\}/);
    expect(preview).toMatch(/if \(username\) onOpenProfile\(username\);\s*else if \(e\.nativeEvent\.actionName === "activate"\) onOpenComments\(post\);/);
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
  });

  it("on Comments: the caption's name, each comment's face and name, every @name; held, the comment's menu", () => {
    const comments = code("app/comments.tsx");
    expect(comments).not.toMatch(BARE_NAME);
    expect(comments).toMatch(/const openAuthor = useOpenProfile\(\);/);
    expect(comments).toMatch(/<NameLink username=\{post\.author\.username\} onOpenProfile=\{openAuthor\} style=\{styles\.author\} \/>\{" "\}\s*<MentionText text=\{post\.caption\} onOpenProfile=\{openAuthor\} \/>/);
    const row = comments.slice(comments.indexOf("const CommentRow = React.memo("), comments.indexOf("function Composer("));
    expect(row).toMatch(/const hold = \(\) => onLongPress\(comment\);/);
    expect(row).toMatch(/onPress=\{\(\) => onOpenAuthor\(comment\.author\.username\)\}\s*onLongPress=\{hold\}/);
    expect(row).toMatch(/<NameLink username=\{comment\.author\.username\} onOpenProfile=\{onOpenAuthor\} onLongPress=\{hold\} style=\{styles\.author\} \/>/);
    expect(row).toMatch(/<MentionText text=\{comment\.body\} onOpenProfile=\{onOpenAuthor\} onLongPress=\{hold\} \/>/);
    // The row's names for VoiceOver are worked out once per comment, not on every draw.
    expect(row).toMatch(/const actions = useMemo\(/);
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
      expect(preview).toMatch(/accessibilityActions=\{\[\{ name: "activate" \}, \.\.\.nameActions\(/);
    }
  });

  it("a post still going up, on Home, reads as it will once posted", () => {
    const pending = code("src/components/PendingPostCard.tsx");
    expect(pending).toMatch(/<NameLink username=\{draft\.author\.username\} onOpenProfile=\{onOpenProfile\} style=\{styles\.captionAuthor\} \/>/);
    expect(pending).toMatch(/<MentionText text=\{draft\.caption\.trim\(\)\} onOpenProfile=\{onOpenProfile\} \/>/);
    expect(pending).toMatch(/style=\{styles\.headerText\}\s*onPress=\{\(\) => onOpenProfile\?\.\(draft\.author\.username\)\}/);
  });
});

describe("names everywhere else", () => {
  it("a notice's face and name open the member; the rest of it, what it is about", () => {
    const activity = code("app/(tabs)/activity.tsx");
    expect(activity).not.toMatch(BARE_NAME);
    expect(activity).toMatch(/const openMember = useOpenProfile\(\);/);
    expect(activity).toMatch(/<NameLink username=\{item\.actor\.username\} onOpenProfile=\{openMember\} style=\{styles\.actor\} \/>/);
    expect(activity).toMatch(/onPress=\{\(\) => openMember\(item\.actor!\.username\)\}/);
    expect(activity).toMatch(/accessibilityActions=\{\[\{ name: "activate" \}, \.\.\.nameActions\(\[isModeration \? null : item\.actor\?\.username\]\)\]\}/);
  });

  it("the inbox: their face opens their page, the row the conversation", () => {
    const inbox = code("app/messages/index.tsx");
    expect(inbox).toMatch(/onPress=\{\(\) => onOpenProfile\(conversation\.peer\.username\)\}/);
    expect(inbox).toMatch(/onOpenProfile=\{openMember\}/);
    expect(inbox).toMatch(/else if \(e\.nativeEvent\.actionName === "activate"\) onPress\(\);/);
  });

  it("a thread: its title and a photograph's member, gone back to when the thread was opened from their page", () => {
    const thread = code("app/messages/[id].tsx");
    expect(thread).not.toMatch(/router\.push\(`\/user\//);
    expect(thread).toMatch(/<NameLink username=\{shared\.author\.username\} onOpenProfile=\{onOpenProfile\} \/>/);
    expect(thread).toMatch(/<Bubble message=\{item\} mine=\{item\.sender_id === userId\} onOpenPost=\{openPost\} onOpenProfile=\{openMember\} \/>/);
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
    expect(code("app/(tabs)/search.tsx")).toMatch(/router\.push\(`\/user\/\$\{member\.username\}`\);/);
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
    // Post: a target as tall as the field's first line, past iOS's 44 points.
    expect(style("post")).toMatch(/height: FIELD_HEIGHT - 2,/);
    expect(height - 2).toBeGreaterThanOrEqual(44);
    expect(style("send")).toMatch(/color: colors\.accent/);
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
