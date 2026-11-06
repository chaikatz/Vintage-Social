import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { describeSlugProblem, slugFromInput } from "@/utils/inviteLink";
import { code, hooksAfterFirstReturn } from "./helpers/screenSource";

/**
 * The two review blockers at the door, read from the source (nothing here
 * can render a screen).
 *
 * A (Guideline 5.1.1(v)): an account the app made can be deleted in the
 * app. An applicant who is waiting or was not accepted, and a suspended
 * member, see only the waiting screen; Settings is out of their reach.
 *
 * B (Guideline 1.2): the invitation, which makes an account as the
 * application does, says what is agreed to before it is made.
 */

describe("A · the waiting screen deletes the account", () => {
  const src = code("app/(gate)/pending.tsx");

  it("has a quiet Delete my account under Sign out", () => {
    expect(src).toMatch(
      /<GateButton title="Sign out" variant="quiet"[^>]*\/>\s*<GateButton title="Delete my account" variant="quiet" onPress=\{confirmDelete\} loading=\{deleting\}/,
    );
    // Outside every condition: waiting, not accepted, suspended, no application.
    const actions = src.slice(src.indexOf("<View style={styles.actions}>"));
    expect(actions.slice(actions.lastIndexOf(": null}"), actions.indexOf('title="Delete my account"'))).not.toMatch(/\?\s*\(/);
  });

  it("asks the same two questions as Settings, and Cancel or Keep my account leaves it as it was", () => {
    const settings = code("app/settings.tsx");
    for (const words of ['"Delete your account?"', 'text: "Delete account"', '"Are you sure?"', '"This is the last step. Everything is deleted now."', 'text: "Yes, delete everything"', 'text: "Keep my account", style: "cancel"', 'text: "Cancel", style: "cancel"']) {
      expect(settings, words).toContain(words);
      expect(src, words).toContain(words);
    }
    // The second question is asked from the first's destructive answer, and the deletion from the second's.
    expect(src).toMatch(
      /text: "Delete account",\s*style: "destructive",\s*onPress: \(\) =>\s*showAlert\("Are you sure\?"[^[]*\[\s*\{\s*text: "Yes, delete everything",\s*style: "destructive",\s*onPress: async \(\) => \{/,
    );
  });

  it("deletes, forgets what the phone held, then leaves through Sign out", () => {
    expect(src).toMatch(/await deleteMyAccount\(userId\);\s*queryClient\.clear\(\);\s*await signOut\(\);/);
    expect(src).toContain('import { deleteMyAccount } from "@/api/account";');
  });

  it("says honestly what a failure may have left, and that trying again finishes it", () => {
    const failure = src.slice(src.indexOf("await signOut();"), src.indexOf('{ text: "Keep my account"'));
    expect(failure).toMatch(/catch \(err\) \{\s*setDeleting\(false\);/);
    expect(failure).toContain('"Couldn’t delete the account"');
    expect(failure).toMatch(/errorMessage\(\s*err,/);
    expect(failure).toContain("may already have been removed");
    expect(failure).toContain("Try again to finish deleting it.");
    // Never the database's words, never "[object Object]".
    expect(failure).not.toMatch(/err\.message|String\(err\)/);
  });

  it("while it deletes, no other button on the screen can be pressed", () => {
    // A redeem or a refresh started mid-deletion would ask about an account that is going.
    const buttons = src.match(/<GateButton\b[^>]*\/>/g) ?? [];
    expect(buttons.length).toBeGreaterThanOrEqual(4);
    for (const button of buttons) {
      expect(button).toMatch(/\b(disabled|loading)=\{deleting\}/);
    }
  });

  it("calls every hook before its redirect", () => {
    expect(src).toMatch(/const \[deleting, setDeleting\] = React\.useState\(false\);[\s\S]*if \(session === null\) return <Redirect/);
    expect(hooksAfterFirstReturn(src)).toEqual([]);
  });
});

describe("B · the invitation says what is agreed to", () => {
  const src = code("app/(gate)/invite.tsx");
  const apply = code("app/(gate)/apply.tsx");

  it("under Accept the invitation, with both documents a tap away, as the application does", () => {
    const after = src.slice(src.indexOf('<GateButton title="Accept the invitation"'));
    expect(after).toMatch(
      /^<GateButton title="Accept the invitation"[^>]*\/>\s*<Text style=\{styles\.agree\}>\s*By accepting you agree to the\{" "\}\s*<Text style=\{styles\.agreeLink\} onPress=\{\(\) => router\.push\("\/legal\/terms"\)\}[^>]*>\s*Terms of Use\s*<\/Text>\{" "\}\s*and\{" "\}\s*<Text style=\{styles\.agreeLink\} onPress=\{\(\) => router\.push\("\/legal\/privacy"\)\}[^>]*>\s*Privacy Policy\s*<\/Text>/,
    );
    expect(apply).toContain("By applying you agree to the");
    expect(apply).toContain('router.push("/legal/terms")');
  });

  it("every Terms and Privacy link at the door is announced as a link", () => {
    // VoiceOver reads a Text with onPress as plain words unless it is told it is a link.
    for (const file of ["app/(gate)/apply.tsx", "app/(gate)/invite.tsx", "app/(gate)/landing.tsx"]) {
      const links = code(file).match(/<(?:Text|Pressable)\b.*router\.push\("\/legal\/(?:terms|privacy)"\).*$/gm) ?? [];
      expect(links.length, file).toBe(2);
      for (const link of links) expect(link, file).toContain('accessibilityRole="link"');
    }
  });

  it("in the application's own type", () => {
    const style = (s: string, name: string) => s.match(new RegExp(`\\n  ${name}: \\{[^}]*\\}`))?.[0].replace(/\s+/g, " ").replace(`${name}:`, "") ?? "";
    expect(style(src, "agree")).toBe(style(apply, "footnote"));
    expect(style(src, "agreeLink")).toBe(style(apply, "footLink"));
    expect(style(src, "agree")).not.toBe("");
  });
});

/**
 * The invitation as App Review first sees it. The review notes send Apple
 * to "I have an invitation", which opens the card with the field empty.
 * Asked about an empty code, invite_link_owner('') answers that nobody owns
 * it, and the card opened on "That invitation isn’t one we know" before a
 * letter was typed; it said the same at every keystroke from the third.
 *
 * The lookup is the screen's own effect, run here as written (its source,
 * with the screen's helpers and state setters handed in), because nothing
 * here can render a screen.
 */
describe("the invitation opens on its welcome, not on a refusal", () => {
  const src = code("app/(gate)/invite.tsx");
  const start = src.indexOf("useEffect(() => {\n    const slug = slugFromInput(code);");
  const end = src.indexOf("}, [code, arrivedWith]);", start);
  const body = src.slice(src.indexOf("{", start) + 1, end);
  const pause = Number(src.match(/const TYPING_PAUSE_MS = (\d+);/)?.[1]);

  type Owner = { inviter: string | null; open: boolean };
  type Said = { inviter: string | null; closed: boolean; unknown: boolean };
  function run(
    typed: string,
    arrivedWith = "",
    owners: Record<string, Owner> = {},
    state: Said = { inviter: null, closed: false, unknown: false },
  ) {
    const asked: string[] = [];
    const effect = new Function(
      "code",
      "arrivedWith",
      "slugFromInput",
      "describeSlugProblem",
      "fetchInviteOwner",
      "setInviter",
      "setClosed",
      "setUnknown",
      "TYPING_PAUSE_MS",
      body,
    ) as (...args: unknown[]) => (() => void) | undefined;
    const cleanup = effect(
      typed,
      arrivedWith,
      slugFromInput,
      describeSlugProblem,
      (slug: string) => {
        asked.push(slug);
        return Promise.resolve(owners[slug] ?? { inviter: null, open: false });
      },
      (v: string | null) => (state.inviter = v),
      (v: boolean) => (state.closed = v),
      (v: boolean) => (state.unknown = v),
      pause,
    );
    return { asked, state, cleanup };
  }

  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("is the screen's own effect that runs here", () => {
    expect(start).toBeGreaterThan(0);
    expect(end).toBeGreaterThan(start);
    expect(body).toContain("fetchInviteOwner(slug)");
    expect(pause).toBeGreaterThan(0);
    // Why the screen has to ask itself whether there is a code at all: the
    // field's own rule says nothing about an empty one, on purpose.
    expect(slugFromInput("")).toBe("");
    expect(describeSlugProblem("")).toBeNull();
  });

  it("an empty field asks nothing and is not called unknown", async () => {
    for (const typed of ["", "   ", "https://vintagesocial.app/i/"]) {
      const { asked, state } = run(typed);
      await vi.runAllTimersAsync();
      expect(asked, JSON.stringify(typed)).toEqual([]);
      expect(state.unknown, JSON.stringify(typed)).toBe(false);
    }
  });

  it("a code being typed is asked about once the typing pauses, not at every letter", async () => {
    const early = run("app");
    await vi.advanceTimersByTimeAsync(pause - 1);
    expect(early.asked).toEqual([]);
    early.cleanup?.(); // the next letter arrives before the pause is over
    await vi.runAllTimersAsync();
    expect(early.asked).toEqual([]);
    expect(early.state.unknown).toBe(false);

    const typed = run("applereview", "", { applereview: { inviter: "Elena", open: true } });
    await vi.advanceTimersByTimeAsync(pause);
    expect(typed.asked).toEqual(["applereview"]);
    expect(typed.state).toEqual({ inviter: "Elena", closed: false, unknown: false });
  });

  it("a code nobody owns is called unknown, once asked", async () => {
    const { asked, state } = run("not-a-real-code");
    await vi.runAllTimersAsync();
    expect(asked).toEqual(["not-a-real-code"]);
    expect(state.unknown).toBe(true);
  });

  it("what was said of the last code is not left standing while the next is typed", () => {
    for (const typed of ["", "ap", "applerevie"]) {
      for (const before of [
        { inviter: "Elena", closed: true, unknown: false },
        { inviter: null, closed: false, unknown: true },
      ]) {
        const { state } = run(typed, "", {}, { ...before });
        expect(state, `${JSON.stringify(typed)} after ${JSON.stringify(before)}`).toEqual({ inviter: null, closed: false, unknown: false });
      }
    }
  });

  it("a code that came with the link is asked about at once", async () => {
    const { asked, state } = run("chai", "chai", { chai: { inviter: "Chai", open: false } });
    await vi.advanceTimersByTimeAsync(0);
    expect(asked).toEqual(["chai"]);
    expect(state).toEqual({ inviter: "Chai", closed: true, unknown: false });
  });
});
