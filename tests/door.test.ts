import { readFileSync } from "node:fs";
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

  it("the application goes in through the same hook: sent, or with its account made and the application refused", () => {
    // Left on the form after a failure that came after the account was
    // made, every further try was "That username is taken": the new
    // account's own profile holds the name (handle_new_user).
    const apply = code("app/(gate)/apply.tsx");
    expect(apply).toMatch(/const goIn = useDoorClosesBehind\(busy\);/);
    expect(apply).toMatch(/await submitApplication\(\{[\s\S]*?\}\);\s*await goIn\(\);/);
    expect(apply).not.toMatch(/router\.replace\("\/\(gate\)\/pending"\)|enterApp/);
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
  });
});
