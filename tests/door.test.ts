import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { backFromDoor, shouldGoIn } from "@/components/gate/door";

/**
 * The door's ways out: a signed-in visitor never stays on the invitation
 * card (a join refused after its account was made, or a member who opened
 * a link), and the back mark always leads somewhere, even when the card
 * is the first screen the app opened on.
 */

const root = path.resolve(import.meta.dirname, "..");
function code(file: string): string {
  return readFileSync(path.join(root, file), "utf8")
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

describe("a signed-in visitor at the door", () => {
  it("goes in once nothing is being sent", () => {
    expect(shouldGoIn(true, false, false)).toBe(true);
  });
  it("waits while a join is being sent, and goes in once it settles, even when it failed", () => {
    expect(shouldGoIn(true, true, false)).toBe(false);
    expect(shouldGoIn(true, false, false)).toBe(true);
  });
  it("is sent in once only", () => {
    expect(shouldGoIn(true, false, true)).toBe(false);
  });
  it("stays when nobody is signed in", () => {
    expect(shouldGoIn(false, false, false)).toBe(false);
  });
});

describe("the back mark", () => {
  it("goes back when there is a screen behind", () => {
    const router = { canGoBack: () => true, back: vi.fn(), replace: vi.fn() };
    backFromDoor(router);
    expect(router.back).toHaveBeenCalledTimes(1);
    expect(router.replace).not.toHaveBeenCalled();
  });
  it("goes to the root when the card is the first screen", () => {
    const router = { canGoBack: () => false, back: vi.fn(), replace: vi.fn() };
    backFromDoor(router);
    expect(router.back).not.toHaveBeenCalled();
    expect(router.replace).toHaveBeenCalledWith("/");
  });
});

describe("the screens use them", () => {
  const invite = code("app/(gate)/invite.tsx");
  const layout = code("src/components/gate/GateLayout.tsx");
  const hook = code("src/components/gate/useDoor.ts");

  it("the invitation card goes in through the door's hook, and only through it", () => {
    expect(invite).toMatch(/const goIn = useDoorClosesBehind\(busy\);/);
    expect(invite).toMatch(/await refreshProfile\(\);\s*await goIn\(\);/);
    expect(invite).not.toMatch(/enterApp/);
  });

  it("the application goes in through the same hook once sent, and a failed try keeps the filled-in form", () => {
    // A try can fail after the account was made (the portrait, the
    // application itself). Submit again carries on with that account
    // (submitApplication), so the form is where the applicant belongs: the
    // waiting room takes an invitation, not an application. Sent off to it
    // instead, the applicant could finish only by deleting the account.
    const apply = code("app/(gate)/apply.tsx");
    expect(apply).toMatch(/const \[tried, setTried\] = useState\(false\);/);
    expect(apply).toMatch(/const goIn = useDoorClosesBehind\(busy \|\| tried\);/);
    expect(apply).toMatch(/setTried\(true\);\s*setBusy\(true\);\s*try \{/);
    expect(apply).toMatch(/await submitApplication\(\{[\s\S]*?\}\);\s*await goIn\(\);\s*\} catch \(err\) \{/);
    const failure = apply.slice(apply.indexOf("} catch (err) {"), apply.indexOf("} finally {"));
    expect(failure).not.toMatch(/goIn|enterApp|router\./);
    expect(apply).not.toMatch(/router\.replace\("\/\(gate\)\/pending"\)|enterApp/);
    // The rule the hook asks: held by a try, the signed-in applicant stays.
    expect(shouldGoIn(true, false || true, false)).toBe(false);
  });

  it("an account whose application never arrived is told how to apply after all", () => {
    // Its username is its own profile's, so a new application starts from a new account.
    const pending = code("app/(gate)/pending.tsx");
    expect(pending).toContain("To apply instead, delete this account and apply again.");
    expect(pending).toMatch(/<GateButton title="Delete my account"/);
  });

  it("the hook waits on busy, asks the rule, and enters the app", () => {
    expect(hook).toMatch(/if \(shouldGoIn\(signedIn, busy, gone\.current\)\) void goIn\(\);/);
    expect(hook).toMatch(/\[signedIn, busy, goIn\]/);
    expect(hook).toMatch(/gone\.current = true;\s*await enterApp\(\);/);
  });

  it("every back mark at the door has a way out", () => {
    expect(invite).toMatch(/onPress=\{\(\) => backFromDoor\(router\)\}/);
    expect(layout).toMatch(/onPress=\{\(\) => backFromDoor\(router\)\}/);
    expect(invite).not.toMatch(/router\.back\(\)/);
    expect(layout).not.toMatch(/router\.back\(\)/);
    // VoiceOver says what it is: "Back, button", as the Memory Room's back mark does.
    for (const src of [invite, layout]) {
      const marks = src.match(/<Pressable\b[^>]*onPress=\{\(\) => backFromDoor\(router\)\}[^>]*>/g) ?? [];
      expect(marks).toHaveLength(1);
      for (const mark of marks) expect(mark).toMatch(/accessibilityRole="button"\s+accessibilityLabel="Back"/);
    }
  });
});

/**
 * A page at the door that breaks while it is drawn. Without a boundary of
 * its own, the whole app's took over (RecoverApp), and its Try again
 * opened the app afresh. Now only the page is replaced, in the app's own
 * words; with no header and no tab bar at the door, its way back is drawn
 * on the page: to the page before, or to Home, whose guard sends anyone
 * not let in yet to the door or the waiting room.
 */
describe("a page at the door that breaks", () => {
  const door = readdirSync(path.join(root, "app/(gate)"))
    .filter((f) => f.endsWith(".tsx"))
    .map((f) => `app/(gate)/${f}`);

  it("is every page there, and the link that opens the invitation", () => {
    expect(door.sort()).toEqual([
      "app/(gate)/apply.tsx",
      "app/(gate)/invite.tsx",
      "app/(gate)/landing.tsx",
      "app/(gate)/pending.tsx",
      "app/(gate)/sign-in.tsx",
    ]);
  });

  for (const file of [...door, "app/invite/[slug].tsx"]) {
    it(`${file} breaks alone, with the way back on the page`, () => {
      expect(code(file)).toMatch(/^export \{ RecoverPageWithBack as ErrorBoundary \} from "@\/navigation\/Recover";$/m);
    });
  }

  it("and the way back leads somewhere for someone signed out: Home's guard sends them to the door", () => {
    const recover = code("src/navigation/Recover.tsx");
    expect(recover).toMatch(/function leave\(\) \{\s*if \(router\.canGoBack\(\)\) router\.back\(\);\s*else router\.replace\("\/\(tabs\)"\);\s*\}/);
    const tabs = code("app/(tabs)/_layout.tsx");
    expect(tabs).toContain('if (session === null) return <Redirect href="/(gate)/landing" />;');
    expect(tabs).toMatch(/if \(profileLoaded && profile\?\.status !== "approved"\) \{\s*return <Redirect href="\/\(gate\)\/pending" \/>;/);
  });
});
