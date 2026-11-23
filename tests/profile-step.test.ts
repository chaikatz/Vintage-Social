import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { profileShown, profileStep, type RouteLike } from "@/utils/profileStep";
import { nameActions, nameFromAction } from "@/utils/nameActions";

/**
 * A name opens its member's page, never a second copy of a page already
 * open: on the page it names it stays, one screen above it it goes back.
 */
const tabs = (front?: string): RouteLike => ({
  name: "(tabs)",
  state: front ? { index: ["index", "search", "create", "activity", "profile"].indexOf(front), routes: ["index", "search", "create", "activity", "profile"].map((name) => ({ name })) } : undefined,
});
const user = (username: string): RouteLike => ({ name: "user/[username]", params: { username } });
const screen = (name: string): RouteLike => ({ name });
const step = (routes: RouteLike[], username: string, me: string | null = "vivian") => profileStep(routes, routes.length - 1, username, me);

describe("a member's page, from their name", () => {
  it("opens on top from anywhere else", () => {
    expect(step([screen("index"), tabs("index")], "ansel")).toBe("push");
    expect(step([tabs("index"), screen("post/[id]"), screen("comments")], "ansel")).toBe("push");
    // Their page further down the stack is no reason not to open it here.
    expect(step([tabs("index"), user("ansel"), screen("post/[id]"), screen("comments")], "ansel")).toBe("push");
    // Your own name from Home or a comment: your page, on top.
    expect(step([tabs("index"), screen("comments")], "vivian")).toBe("push");
  });

  it("goes back to it when it is the screen just under this one", () => {
    // Their gallery, opened from their page.
    expect(step([tabs("index"), user("ansel"), screen("gallery")], "ansel")).toBe("back");
    // A thread opened from their Message button.
    expect(step([tabs("index"), user("ansel"), screen("messages/[id]")], "Ansel")).toBe("back");
    // Your own gallery, opened from your Profile tab.
    expect(step([screen("index"), tabs("profile"), screen("gallery")], "vivian")).toBe("back");
    // Someone else's name there still opens theirs.
    expect(step([screen("index"), tabs("profile"), screen("gallery")], "ansel")).toBe("push");
  });

  it("stays when it is the page on screen", () => {
    expect(step([tabs("index"), user("ansel")], "ansel")).toBe("stay");
    expect(step([tabs("index"), user("Ansel")], "ansel")).toBe("stay");
    expect(step([screen("index"), tabs("profile")], "vivian")).toBe("stay");
    expect(step([tabs("index")], "")).toBe("stay");
  });

  it("reads the tabs as Home until a tab is chosen, and your page only once you are known", () => {
    expect(profileShown(tabs(), "vivian")).toBeNull();
    expect(profileShown(tabs("profile"), null)).toBeNull();
    expect(profileShown(tabs("profile"), "Vivian")).toBe("vivian");
    expect(profileShown(user("ansel"), "vivian")).toBe("ansel");
    expect(profileShown({ name: "user/[username]" }, "vivian")).toBeNull();
    expect(profileShown(undefined, "vivian")).toBeNull();
    expect(profileShown(screen("gallery"), "vivian")).toBeNull();
  });
});

describe("the hook every name uses", () => {
  const hook = readFileSync(path.resolve(import.meta.dirname, "../src/hooks/useOpenProfile.ts"), "utf8");

  it("reads the stack the pages are laid on, and pushes, goes back or stays as the step says", () => {
    expect(hook).toMatch(/while \(stack && stack\.getState\(\)\?\.type !== "stack"\) stack = stack\.getParent\(\);/);
    expect(hook).toMatch(/profileStep\(state\.routes as readonly RouteLike\[\], state\.index, target, me\)/);
    expect(hook).toMatch(/if \(step === "stay"\) return;\s*if \(step === "back"\) router\.back\(\);\s*else router\.push\(`\/user\/\$\{target\}`\);/);
  });

  it("is one function for the screen's life, so rows handed it are not drawn again", () => {
    expect(hook).toMatch(/return useCallback\(/);
    expect(hook).toMatch(/\[navigation, router, me\],/);
  });
});

describe("names as VoiceOver reaches them in a row", () => {
  it("one action per member named, each once, in lowercase, named by the words VoiceOver speaks", () => {
    // On the new architecture VoiceOver speaks an action's name and never its label.
    expect(nameActions(["Ansel", "marta", "ansel", null, undefined, " "])).toEqual([
      { name: "View ansel’s profile", label: "View ansel’s profile" },
      { name: "View marta’s profile", label: "View marta’s profile" },
    ]);
    expect(nameActions([])).toEqual([]);
    expect(nameActions([null])).toEqual([]);
    for (const a of nameActions(["ansel.adams_1", "x_y.z"])) expect(a.name).toBe(a.label);
  });

  it("reads the member back from the words handed back", () => {
    for (const username of ["ansel", "ansel.adams_1", "_x.", "a".repeat(24)]) {
      const [action] = nameActions([username]);
      expect(nameFromAction(action.name)).toBe(username);
    }
  });

  it("tells a name's action from anything else", () => {
    expect(nameFromAction("activate")).toBeNull();
    expect(nameFromAction("View ’s profile")).toBeNull();
    expect(nameFromAction("View ansel's profile")).toBeNull();
    expect(nameFromAction("View ansel’s profile now")).toBeNull();
    expect(nameFromAction("View Ansel’s profile")).toBeNull();
    expect(nameFromAction("profile:ansel")).toBeNull();
    expect(nameFromAction("")).toBeNull();
  });
});
