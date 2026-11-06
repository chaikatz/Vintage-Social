import { readFileSync } from "node:fs";
import path from "node:path";
import { StackActions, StackRouter, type StackNavigationState, type ParamListBase } from "@react-navigation/routers";
import { describe, expect, it } from "vitest";

/**
 * A message thread reaches the member it is with: their profile from the
 * title, and Report member and Block member from a "…" beside it, as on
 * their profile (App Review Guideline 1.2: a way to report and to block
 * from where unwelcome content arrives). The thread had only a title, and
 * a member sent something unwelcome had to leave it, find the sender in
 * Search and open their profile to do either. Seen working in the web
 * demo by e2e/launch-test.mjs.
 */

const read = (file: string) => readFileSync(path.resolve(import.meta.dirname, "..", file), "utf8");
const thread = read("app/messages/[id].tsx");
const profile = read("app/user/[username].tsx");

describe("the thread's header", () => {
  it("has a \"…\" once the member is known, and a title that opens their profile", () => {
    expect(thread).toMatch(/const peer = peerQ\.data \?\? null;/);
    expect(thread).toMatch(
      /headerRight: peer\s*\?\s*\(\) => \(\s*<Pressable onPress=\{threadMenu\} hitSlop=\{10\} accessibilityRole="button" accessibilityLabel="More">\s*<Feather name="more-horizontal" size=\{20\} color=\{colors\.ink\} \/>/,
    );
    expect(thread).toMatch(/headerTitle: peer\s*\?\s*\(\{ children, tintColor \}\) => \(\s*<Pressable onPress=\{openProfile\}[^>]*accessibilityRole="link"/);
    // Drawn as the stack draws a title: its serif at its size, over its own bold.
    expect(thread).toMatch(/<HeaderTitle tintColor=\{tintColor\} style=\{\[(styles\.title|titleStyle),/);
    expect(thread).toMatch(/title: \{ fontFamily: type\.serif, fontSize: 17 \}/);
    expect(read("app/_layout.tsx")).toMatch(/headerTitleStyle: \{ fontFamily: type\.serif, fontSize: 17 \}/);
    expect(thread).toMatch(/const openProfile = useCallback\(\(\) => \{\s*if \(peer\) router\.push\(`\/user\/\$\{peer\.username\}`\);/);
  });

  it("offers View profile, Report member and Block member, as the profile's own menu does", () => {
    const menu = thread.slice(thread.indexOf("const threadMenu = useCallback("), thread.indexOf("const send = useMutation("));
    expect(menu).toMatch(/showAlert\(peer\.username, undefined, \[\s*\{ text: "View profile", onPress: openProfile \},/);
    expect(menu).toMatch(
      /text: "Report member",\s*style: "destructive",\s*onPress: \(\) => router\.push\(\{ pathname: "\/report", params: \{ targetType: "profile", profileId: peer\.id \} \}\),/,
    );
    // The profile screen's words for a block, the same in both.
    const words = /"They won't see your photographs or profile[^"]*"/;
    const said = words.exec(profile)?.[0];
    expect(said).toBeTruthy();
    expect(menu).toContain(said!);
    expect(menu).toMatch(/`Block \$\{peer\.username\}\?`/);
    // Block member asks first: its tap opens the question, and only the
    // question's Block blocks.
    expect(menu).toMatch(
      /\{\s*text: "Block member",\s*style: "destructive",\s*onPress: \(\) =>\s*showAlert\(\s*`Block \$\{peer\.username\}\?`,/,
    );
    expect(menu).toMatch(/\{ text: "Block", style: "destructive", onPress: \(\) => block\.mutate\(peer, \{ onSuccess: leaveThread \}\) \}/);
    // Not while a block is out: a second would leave the thread, then the screen under it.
    expect(menu).toMatch(/^const threadMenu = useCallback\(\(\) => \{\s*if \(!peer\) return;\s*(\/\/[^\n]*\s*)*if \(block\.isPending\) \{\s*showAlert\("Still blocking", block\.isPaused \? "It’s sent once you have a signal again\." : "One moment\."\);\s*return;\s*\}/);
    expect(menu.match(/block\.mutate\(/g)).toHaveLength(1);
    expect(menu).toMatch(/\{ text: "Cancel", style: "cancel" \},\s*\]\);\s*\}, \[/);
  });

  it("blocks through the same call, lets go of what the block changes, and leaves the thread", () => {
    expect(thread).toMatch(/import \{ blockMember \} from "@\/api\/blocks";/);
    const block = thread.slice(thread.indexOf("const block = useMutation("), thread.indexOf("const threadMenu = useCallback("));
    expect(block).toMatch(/mutationFn: \(member: Pick<ProfileRow, "id" \| "username">\) => blockMember\(member\.id\),/);
    // What the profile's own Block lets go of (afterBlockChange), their
    // profile and photographs among it, as this member last read them.
    for (const key of [
      '\\["blocked-ids", userId\\]',
      '\\["blocked", userId\\]',
      '\\["follow-state", userId, member\\.id\\]',
      '\\["profile", member\\.username\\]',
      '\\["user-posts", member\\.id\\]',
      '\\["conversations", userId\\]',
      '\\["feed"\\]',
      '\\["explore"\\]',
      '\\["activity"\\]',
    ]) {
      expect(block).toMatch(new RegExp(`queryClient\\.invalidateQueries\\(\\{ queryKey: ${key} \\}\\);`));
    }
    // The same keys the profile screen reads them under.
    expect(profile).toMatch(/queryKey: \["profile", username\],/);
    expect(profile).toMatch(/queryKey: \["user-posts", profile\?\.id\],/);
    expect(profile).toMatch(/queryClient\.invalidateQueries\(\{ queryKey: \["user-posts", profile\?\.id\] \}\);/);
    // Leaving is the tap's own onSuccess, which react-query drops once the
    // screen has gone; the mutation's would run anyway and go back from
    // wherever the member is by then.
    expect(block).not.toMatch(/router\./);
    // And it takes the thread itself off its stack, not the screen on top.
    expect(thread).toMatch(
      /const leaveThread = useCallback\(\(\) => \{\s*const stack = navigation\.getState\(\);\s*const at = stack \? stack\.routes\.findIndex\(\(r\) => r\.key === route\.key\) : -1;\s*if \(stack && at > 0\) \{\s*navigation\.dispatch\(\{ \.\.\.StackActions\.pop\(\), source: route\.key, target: stack\.key \}\);\s*\} else if \(stack && at === 0\) \{\s*navigation\.dispatch\(\{ \.\.\.StackActions\.replace\("\(tabs\)"\), source: route\.key, target: stack\.key \}\);\s*\} else \{\s*router\.replace\("\/"\);\s*\}\s*\}, \[navigation, route\.key, router\]\);/,
    );
    expect(thread).toMatch(/const navigation = useNavigation\(\);\s*const route = useRoute\(\);/);
    expect(thread).not.toMatch(/router\.back\(\)/);
    expect(block).toMatch(/onError: \(err\) => showAlert\("That didn’t work", errorMessage\(err, "Nothing changed\. Try again in a moment\."\)\)/);
  });

  it("leaves by taking the thread off the stack, so a screen opened from it stays", () => {
    // What the thread dispatches, played on the stack router the app's root stack uses.
    const router = StackRouter({});
    const at = (keys: string[]): StackNavigationState<ParamListBase> => ({
      stale: false,
      type: "stack",
      key: "root",
      index: keys.length - 1,
      preloadedRoutes: [],
      routeNames: ["(tabs)", "messages/[id]", "user/[username]", "post/[id]"],
      routes: keys.map((key) => ({ key, name: key === "tabs" ? "(tabs)" : key === "thread" ? "messages/[id]" : "user/[username]" })),
    });
    const options = { routeNames: at([]).routeNames, routeParamList: {}, routeGetIdList: {} };
    const leave = { ...StackActions.pop(), source: "thread", target: "root" };
    const keys = (state: unknown) => (state as StackNavigationState<ParamListBase>).routes.map((r) => r.key);
    // On the thread: back to what was under it.
    expect(keys(router.getStateForAction(at(["tabs", "thread"]), leave, options))).toEqual(["tabs"]);
    // Their profile opened from the thread's title while the block was out: it stays, the thread goes.
    expect(keys(router.getStateForAction(at(["tabs", "thread", "profile"]), leave, options))).toEqual(["tabs", "profile"]);
    // What router.back() did instead: it took the profile.
    expect(keys(router.getStateForAction(at(["tabs", "thread", "profile"]), StackActions.pop(), options))).toEqual(["tabs", "thread"]);
    // A thread opened first (from a link): the tabs take its place, and a profile opened from it stays.
    const first = { ...StackActions.replace("(tabs)"), source: "thread", target: "root" };
    const names = (state: unknown) => (state as StackNavigationState<ParamListBase>).routes.map((r) => r.name);
    expect(names(router.getStateForAction(at(["thread"]), first, options))).toEqual(["(tabs)"]);
    expect(names(router.getStateForAction(at(["thread", "profile"]), first, options))).toEqual(["(tabs)", "user/[username]"]);
    // There, a pop has nothing under the thread to go back to.
    expect(router.getStateForAction(at(["thread", "profile"]), leave, options)).toBeNull();
  });

  it("the report screen takes a member as its subject", () => {
    expect(read("app/report.tsx")).toMatch(/profileId\?: string;/);
    expect(read("src/types/db.ts")).toMatch(/"post" \| "comment" \| "profile"/);
  });
});
