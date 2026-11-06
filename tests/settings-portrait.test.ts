import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Settings' Save with a new portrait. The old portrait's file used to be
 * removed before the profile update that replaces it, so an update that
 * failed (no signal, a timeout) left the profile naming a file that was
 * gone: a broken portrait for everyone, under an alert saying nothing was
 * saved. The old file goes only after the server has taken the new one.
 * Only the source can show the order; the demo uploads nothing.
 */

const root = path.resolve(import.meta.dirname, "..");
function code(file: string): string {
  return readFileSync(path.join(root, file), "utf8")
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

describe("Settings' Save with a new portrait", () => {
  const settings = code("app/settings.tsx");
  const save = settings.slice(settings.indexOf("const save = async"), settings.indexOf("const openDoc"));

  it("removes the old portrait only after the profile names the new one", () => {
    const update = save.indexOf("await updateOwnProfile(userId, {");
    const removals = [...save.matchAll(/supabase\.storage\.from\("avatars"\)\.remove\(/g)];
    expect(update).toBeGreaterThan(-1);
    expect(removals).toHaveLength(1);
    expect(removals[0].index).toBeGreaterThan(update);
    // And nowhere else on the screen.
    expect(settings.match(/\.from\("avatars"\)\.remove\(/g)).toHaveLength(1);
    expect(save).toMatch(/if \(replaced\) supabase\.storage\.from\("avatars"\)\.remove\(\[replaced\]\)\.catch\(\(\) => undefined\);/);
  });

  it("removes only a different file of this member's own", () => {
    expect(save).toMatch(
      /if \(previous && previous\.startsWith\(`\$\{userId\}\/`\) && previous !== avatarPath\) replaced = previous;/,
    );
  });

  it("says so when the picker refuses, in Settings and in the application", () => {
    // The picker can reject outright (an iCloud original that would not
    // come down); the tap used to end in silence.
    for (const file of ["app/settings.tsx", "app/(gate)/apply.tsx"]) {
      const src = code(file);
      const pick = src.slice(src.indexOf("const pickAvatar = async"), src.indexOf("\n  };", src.indexOf("const pickAvatar = async")));
      expect(pick, file).toMatch(/^const pickAvatar = async \(\) => \{\s*try \{\s*const result = await ImagePicker\.launchImageLibraryAsync\(/);
      expect(pick, file).toMatch(/\} catch \{\s*showAlert\("Couldn’t open that", "[^"]+"\);\s*\}$/);
    }
  });

  it("sends the file already uploaded when Save is tried again for the same photograph", () => {
    expect(save).toMatch(/if \(uploadedAvatar\.current\?\.uri === newAvatarUri\) \{\s*avatarPath = uploadedAvatar\.current\.path;/);
    expect(save).toMatch(/uploadedAvatar\.current = \{ uri: newAvatarUri, path: avatarPath \};/);
  });
});
