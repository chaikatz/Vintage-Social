import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { LIKERS_NOTE, LIKES_HINT, NO_LIKES_YET, likesCount, likesLine, seesLikes } from "@/utils/ownLikes";
import { demoCurrentProfile, demoFetchLikers, demoFetchUserPosts, demoLike, demoReset, demoSignIn, demoSignOut } from "@/demo/store";
import { DEMO_IDS } from "@/demo/fixtures";

/**
 * A photograph's likes are its author's: the count under their own
 * photographs, on every surface that shows a photograph's actions, a tap
 * on it opening who liked it; under anyone else's, nothing at all. And
 * 0042, the database's half: a like is read only by the member who made
 * it and the photograph's author. What 0042 does to the database is
 * proven on PostgreSQL by npm run test:rls (supabase/tests/21_likes_0042.sql
 * and verify script 12, row 70); these hold the file to its promises and
 * the app to the rule.
 */

const root = path.resolve(import.meta.dirname, "..");
const read = (f: string) => readFileSync(path.join(root, f), "utf8");
const sqlCode = (sql: string) => sql.replace(/--[^\n]*/g, "");
/** The source without its comments, so prose is not taken for code. */
const code = (file: string) =>
  read(file)
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
const FILE = "supabase/migrations/0042_likes_read_by_the_liker_and_the_author.sql";
const POLICY = "likes: the liker's and the author's";

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(path.join(root, dir))) {
    const rel = path.join(dir, name);
    if (statSync(path.join(root, rel)).isDirectory()) out.push(...sourceFiles(rel));
    else if (/\.(ts|tsx)$/.test(name)) out.push(rel);
  }
  return out;
}
const appFiles = () => [...sourceFiles("app"), ...sourceFiles("src")];

describe("the rule, in one place", () => {
  const ana = { author_id: "ana" };

  it("the author sees the count, and it opens who liked it", () => {
    expect(likesLine(ana, "ana", 1)).toEqual({ text: "1 like", label: "1 like", opens: true });
    expect(likesLine(ana, "ana", 12)).toEqual({ text: "12 likes", label: "12 likes", opens: true });
    expect(likesLine(ana, "ana", 1000)?.text).toBe("1000 likes");
  });

  it("before the first like, the author's line says so quietly, and opens nothing", () => {
    expect(likesLine(ana, "ana", 0)).toEqual({ text: NO_LIKES_YET, label: NO_LIKES_YET, opens: false });
    expect(NO_LIKES_YET).toBe("No likes yet");
    // A count gone below nothing (an unlike still on its way) is none.
    expect(likesLine(ana, "ana", -1)?.opens).toBe(false);
    expect(likesLine(ana, "ana", Number.NaN)?.opens).toBe(false);
  });

  it("anyone else sees nothing, whatever the count", () => {
    for (const n of [0, 1, 2, 57]) {
      expect(likesLine(ana, "ben", n)).toBeNull();
      expect(likesLine(ana, "", n)).toBeNull();
      expect(likesLine(ana, null, n)).toBeNull();
      expect(likesLine(ana, undefined, n)).toBeNull();
    }
    expect(seesLikes(ana, "ana")).toBe(true);
    expect(seesLikes(ana, "ben")).toBe(false);
    // A reader not known yet is nobody's author, even of a row that names nobody.
    expect(seesLikes({ author_id: "" }, "")).toBe(false);
  });

  it("says the count as it is said", () => {
    expect(likesCount(0)).toBe("0 likes");
    expect(likesCount(1)).toBe("1 like");
    expect(likesCount(2)).toBe("2 likes");
    expect(likesCount(2.7)).toBe("2 likes");
    expect(LIKES_HINT).toMatch(/Only you can see this\./);
  });
});

describe("every surface that shows a photograph's actions", () => {
  it("the feed card draws its line from the rule, for the reader it is given, and nothing else", () => {
    const card = code("src/components/PostCard.tsx");
    expect(card).toMatch(/viewerId: string;/);
    expect(card).toMatch(/const likes = likesLine\(post, viewerId, post\.like_count\);/);
    // The count is drawn only from the line, never from the column itself.
    expect(card).not.toMatch(/\{post\.like_count\}/);
    expect(card).not.toMatch(/post\.like_count\s*>\s*0/);
    expect(card).toMatch(/\{likes \? \(\s*likes\.opens \? \(/);
    expect(card).toMatch(/accessibilityLabel=\{likes\.label\}\s*accessibilityHint=\{LIKES_HINT\}/);
    expect(card).toMatch(/<Text style=\{styles\.likes\}>\{likes\.text\}<\/Text>/);
    expect(card).toMatch(/<Text style=\{\[styles\.likes, styles\.noLikes\]\} accessibilityLabel=\{likes\.label\}>/);
  });

  it("the count and 'No likes yet' stand at one height, so the first like moves nothing", () => {
    for (const file of ["src/components/PostCard.tsx", "app/post/[id].tsx"]) {
      const src = code(file);
      expect(src, file).toMatch(/likes: \{[^}]*fontSize: 13,[^}]*lineHeight: 18,/);
      // The quiet line changes the weight and colour only: the secondary ink, which reads at AA on paper
      // and on black (tests/likes-contrast.test.ts).
      expect(src, file).toMatch(/noLikes: \{ fontWeight: "400", color: colors\.inkSoft \},/);
    }
  });

  for (const file of ["app/(tabs)/index.tsx", "app/gallery.tsx"]) {
    it(`a card in ${file} is told who is reading`, () => {
      const screen = code(file);
      // Editorial (Preview): the card is whichever the layout chose (FeedCard), handed the same props.
      const cards = screen.match(/<(?:PostCard|FeedCard)\b[\s\S]*?\/>/g) ?? [];
      expect(cards).toHaveLength(1);
      expect(cards[0]).toMatch(/viewerId=\{userId\}/);
      expect(screen).toMatch(/const userId = session\?\.user\?\.id \?\? "";/);
    });
  }

  it("Home's list draws a card again when the reader changes", () => {
    // Editorial (Preview): after the card the layout chose.
    expect(code("app/(tabs)/index.tsx")).toMatch(/\[(?:FeedCard, )?counted, userId, likeCountFor,/);
  });

  it("a photograph's own page draws the same line from the same rule", () => {
    const page = code("app/post/[id].tsx");
    expect(page).toMatch(/const likesShown = likesLine\(post, userId, likeCountFor\(post\)\);/);
    expect(page).toMatch(/\{likesShown \? \(\s*likesShown\.opens \? \(/);
    expect(page).toMatch(/onPress=\{\(\) => onOpenLikes\(post\)\}/);
    expect(page).toMatch(/accessibilityLabel=\{likesShown\.label\}\s*accessibilityHint=\{LIKES_HINT\}/);
    expect(page).not.toMatch(/\{likes\} \{likes === 1/);
  });

  it("no other file of the app draws a count of likes", () => {
    // Every file that reads a photograph's like_count, and why.
    const allowed = new Set([
      "src/types/db.ts", // the row
      "src/components/PostCard.tsx", // through likesLine
      "src/components/feed/EditorialPostCard.tsx", // Editorial (Preview): through likesLine, as PostCard
      "src/hooks/usePostActions.ts", // likeCountFor: the count with a like on its way
      "src/media/stableCards.ts", // the card's post with that count
      "src/uploads/feedCache.ts", // a new post's row, at nought
      "src/demo/fixtures.ts",
      "src/demo/store.ts",
    ]);
    for (const f of appFiles()) {
      if (/\blike_count\b/.test(code(f))) expect(allowed.has(f), `${f} reads like_count: draw it through likesLine (src/utils/ownLikes.ts)`).toBe(true);
    }
    // Nor spells one out: "N like(s)" is said in one place.
    for (const f of appFiles()) {
      if (f === "src/utils/ownLikes.ts") continue;
      expect(code(f), f).not.toMatch(/=== 1 \? "like" : "likes"/);
    }
  });

  it("who liked it opens only from your own photograph", () => {
    const hook = code("src/hooks/usePostActions.ts");
    expect(hook).toMatch(/const onOpenLikes = useCallback\(\s*\(post: PostWithAuthor\) => \{\s*if \(!seesLikes\(post, userId\)\) return;/);
  });
});

describe("the likers list", () => {
  const screen = code("app/likes.tsx");

  it("refuses a photograph that is not yours, and asks nothing for it", () => {
    expect(screen).toMatch(/const own = Boolean\(postId\) && seesLikes\(\{ author_id: authorId \?\? "" \}, userId\);/);
    expect(screen).toMatch(/enabled: own,/);
    expect(screen).toMatch(/\{!own \? \(\s*<EmptyState title="Only your own"/);
  });

  it("reads a page at a time, newest first, and asks for the next near the end", () => {
    expect(screen).toMatch(/useInfiniteQuery\(\{\s*queryKey: \["likers", postId\],\s*queryFn: \(\{ pageParam \}\) => fetchLikersPage\(postId \?\? "", pageParam\),/);
    expect(screen).toMatch(/getNextPageParam: \(last\) => last\.next,/);
    expect(screen).toMatch(/if \(likers\.hasNextPage && !likers\.isFetchingNextPage && !likers\.isFetchNextPageError\) likers\.fetchNextPage\(\);/);
    expect(screen).toMatch(/<LoadFailed what="the rest" onRetry=\{\(\) => likers\.fetchNextPage\(\)\} \/>/);
  });

  it("says no likes yet only once it has asked, and says who else sees the list", () => {
    expect(screen).toMatch(/likers\.isFetched \? \(\s*<EmptyState title="No likes yet" body=\{LIKERS_NOTE\} \/>/);
    expect(screen).toMatch(/ListHeaderComponent=\{rows\.length > 0 \? <Text style=\{styles\.note\}>\{LIKERS_NOTE\}<\/Text> : null\}/);
    expect(LIKERS_NOTE).toBe("Only you can see who liked your photograph.");
  });

  it("the read asks the likes of one photograph, fifty a page, with only what a row draws", () => {
    const api = code("src/api/posts.ts");
    expect(api).toMatch(/export const LIKERS_PAGE_SIZE = 50;/);
    expect(api).toMatch(/\.select\("created_at, user_id, liker:profiles!likes_user_id_fkey\(id, username, full_name, avatar_url\)"\)\s*\.eq\("post_id", postId\);/);
    expect(api).toMatch(/pageAfter\(query, "created_at", "user_id", before\)\s*\.order\("created_at", \{ ascending: false \}\)\s*\.order\("user_id", \{ ascending: false \}\)\s*\.limit\(LIKERS_PAGE_SIZE\);/);
    // No list of five hundred and then nothing.
    expect(api).not.toMatch(/\.limit\(500\)/);
  });
});

describe("the demo answers as the database does", () => {
  beforeEach(() => demoReset());

  it("the author reads every like on their photograph, newest first; anyone else their own, at most", () => {
    const mine = demoFetchUserPosts(DEMO_IDS.elena)[0];
    const theirs = demoFetchUserPosts(DEMO_IDS.tomas)[0];
    expect(mine && theirs).toBeTruthy();
    demoLike(DEMO_IDS.tomas, mine.id);
    demoLike(DEMO_IDS.june, mine.id);
    demoLike(DEMO_IDS.elena, theirs.id);
    demoLike(DEMO_IDS.june, theirs.id);

    demoSignIn("elena@example.com");
    expect(demoCurrentProfile()?.id).toBe(DEMO_IDS.elena);
    const onMine = demoFetchLikers(mine.id).map((r) => r.liker.id);
    expect(onMine).toEqual(expect.arrayContaining([DEMO_IDS.tomas, DEMO_IDS.june]));
    const times = demoFetchLikers(mine.id).map((r) => r.at);
    expect([...times].sort().reverse()).toEqual(times);
    // On Tomas's: Elena's own like, and not June's.
    expect(demoFetchLikers(theirs.id).map((r) => r.liker.id)).toEqual([DEMO_IDS.elena]);

    demoSignOut();
    expect(demoFetchLikers(mine.id)).toEqual([]);
  });
});

describe("0042, as a file", () => {
  const sql = () => sqlCode(read(FILE));

  it("makes one restrictive read policy, the liker's and the photograph's author's, and nothing else", () => {
    const s = sql();
    expect(s.match(/\bcreate policy\b/gi)).toHaveLength(1);
    expect(s).toContain(
      `drop policy if exists "${POLICY}" on public.likes;\ncreate policy "${POLICY}" on public.likes\n  as restrictive for select using (\n    user_id = (select auth.uid())\n    or exists (\n      select 1 from public.posts p\n      where p.id = post_id and p.author_id = (select auth.uid())\n    )\n  );`,
    );
    // Tightening only: no grant, no revoke, row-level security left on, no other table, no service role.
    expect(s).not.toMatch(/\b(grant|revoke|alter table|disable|service_role|security definer|insert into|update public|delete from|truncate)\b/i);
    expect(s).not.toMatch(/\bpermissive\b/i);
    expect(s).not.toMatch(/\bfor (insert|update|delete|all)\b/i);
  });

  it("waits five seconds at most for a lock, opens no transaction, and says how to undo it", () => {
    const s = sql();
    expect(s.split(";").map((st) => st.trim()).find(Boolean)).toBe("set local lock_timeout = '5s'");
    expect(s).not.toMatch(/^\s*(begin|commit)\s*;/im);
    expect(read(FILE)).toMatch(/^-- Rollback:\n--   drop policy if exists "likes: the liker's and the author's" on public\.likes;$/m);
  });

  it("names every reader of likes it was checked against", () => {
    const header = read(FILE);
    for (const reader of ["fetchLikersPage", "fetchMyLikes", "likePost, unlikePost", "bump_like_count", "notify_like", "delete_my_account", "feed_page", "demoFetchLikers", "verify script 12"]) {
      expect(header, reader).toContain(reader);
    }
  });

  it("is proven by the policy harness after 0041's test, and checked by verify script 12, row 70", () => {
    const runner = read("supabase/tests/run.mjs");
    expect(runner).toMatch(/"20_member_number_0041\.sql",\s+"21_likes_0042\.sql",\s+\]\) \{/);
    expect(runner.match(/rows\.length !== 70/g)).toHaveLength(2);
    const test = read("supabase/tests/21_likes_0042.sql");
    expect(test).toContain(`drop policy "${POLICY}" on public.likes;`);
    expect(test.match(/\\ir \.\.\/migrations\/0042_likes_read_by_the_liker_and_the_author\.sql/g)).toHaveLength(3);
    expect(test.trim().endsWith("rollback;")).toBe(true);
    // 0028's own test asks as the database stood before 0042, and puts it back as it rolls back.
    const rows28 = read("supabase/tests/13_photograph_rows_0028.sql");
    expect(rows28).toContain(`drop policy "${POLICY}" on public.likes;`);
    expect(rows28.trim().endsWith("rollback;")).toBe(true);
    // 08 knows it was made after 0023.
    expect(read("supabase/tests/08_policy_rewrite.sql")).toContain("('likes', 'likes: the liker''s and the author''s')");
    const verify = sqlCode(read("supabase/production/12_policies_read_once_verify.sql"));
    expect(verify).toMatch(/select 70, '0042:/);
    expect(verify).toMatch(/policyname = 'likes: the liker''s and the author''s'/);
    expect(verify).toMatch(/select 4, 'policies on public', count\(\*\)::text, '86'/);
    expect(read("supabase/production/12_policies_read_once_verify.sql").split("\n")[0]).toMatch(/verify 0023-0042 /);
  });
});
