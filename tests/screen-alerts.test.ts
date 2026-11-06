import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { errorMessage } from "@/utils/errorMessage";

/**
 * What the screens' alerts say when something is refused. supabase-js hands
 * a refusal back as a plain object, so `err instanceof Error ? err.message
 * : String(err)` showed "[object Object]", and an Error from the server
 * showed the database talking. Every alert of these screens goes through
 * errorMessage, with the screen's own words for what did not happen.
 */

const root = path.resolve(import.meta.dirname, "..");
function code(file: string): string {
  return readFileSync(path.join(root, file), "utf8")
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

const SCREENS = [
  "app/(tabs)/profile.tsx",
  "app/(tabs)/index.tsx",
  "app/(tabs)/create.tsx",
  "app/user/[username].tsx",
  "app/post/[id].tsx",
  "app/gallery.tsx",
  "app/requests.tsx",
  "app/blocked.tsx",
  "app/likes.tsx",
  "app/export.tsx",
  "app/settings.tsx",
  "app/compose.tsx",
  "app/invites.tsx",
  "app/darkroom.tsx",
  "app/library-picker.tsx",
  "app/memories.tsx",
  "src/components/PostCard.tsx",
];

describe("the screens' alerts", () => {
  it("never print what was thrown as it came", () => {
    for (const file of SCREENS) {
      const src = code(file);
      expect(src, file).not.toMatch(/instanceof Error \? \w+\.message : String\(/);
      expect(src, file).not.toMatch(/showAlert\([^;]*String\((err|e|error)\)/);
      expect(src, file).not.toMatch(/showAlert\([^;]*\b(err|e|error)\.message\b/);
    }
  });

  it("say what did not happen, in each screen's own words", () => {
    const cases: [string, RegExp][] = [
      ["app/post/[id].tsx", /onError: \(err\) => showAlert\("That didn’t work", errorMessage\(err, "Nothing changed\. Try again in a moment\."\)\)/],
      ["app/user/[username].tsx", /showAlert\("Couldn’t open the conversation", errorMessage\(err, "Try again in a moment\."\)\)/],
      ["app/requests.tsx", /showAlert\("That didn’t work", errorMessage\(err, "Nothing changed\. Try again in a moment\."\)\)/],
      ["app/blocked.tsx", /showAlert\("Couldn’t unblock", errorMessage\(err, "Nothing changed\. Try again in a moment\."\)\)/],
      ["app/export.tsx", /showAlert\("That didn’t work", errorMessage\(err, "The link is still on\. Try again in a moment\."\)\)/],
      ["app/export.tsx", /showAlert\("Couldn’t export", errorMessage\(err, "Nothing was shared\. Try again in a moment\."\)\)/],
      ["app/invites.tsx", /showAlert\("That didn’t work", errorMessage\(err, "Nothing changed\. Try again in a moment\."\)\)/],
    ];
    for (const [file, alert] of cases) expect(code(file), file).toMatch(alert);
    // The follow and the block on a member's page.
    expect(code("app/user/[username].tsx").match(/showAlert\("That didn’t work", errorMessage\(err, "Nothing changed\. Try again in a moment\."\)\)/g)).toHaveLength(2);
  });

  it("show the words our own SQL raised for the member, and nothing of the database's", () => {
    // set_invite_slug's own refusal (migration 0013), as PostgREST hands it back.
    const taken = { code: "P0001", message: "That suffix is already in use.", details: null, hint: null };
    expect(errorMessage(taken, "Nothing changed. Try again in a moment.")).toBe("That suffix is already in use.");
    const refused = { code: "42501", message: 'new row violates row-level security policy for table "follows"', details: null, hint: null };
    expect(errorMessage(refused, "Nothing changed. Try again in a moment.")).toBe("Nothing changed. Try again in a moment.");
    // A native module's refusal carries its code: the snapshot or the share sheet, on Share outside.
    const native = Object.assign(new Error("Failed to snapshot view tag 12"), { code: "E_UNABLE_TO_SNAPSHOT" });
    expect(errorMessage(native, "Nothing was shared. Try again in a moment.")).toBe("Nothing was shared. Try again in a moment.");
    // Our own words, thrown by the export itself, are shown.
    expect(errorMessage(new Error("Sharing is not available on this device"), "x")).toBe("Sharing is not available on this device");
  });
});
