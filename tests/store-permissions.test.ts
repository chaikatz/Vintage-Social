import { readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

/**
 * What iOS says on the app's behalf when it asks a member for something.
 *
 * Every string here is read from the Info.plist that the build would
 * write — app.json with every config plugin applied, the same
 * introspection `npx expo config --type introspect` does — not from
 * app.json alone, because a plugin listed without options writes its own
 * template words ("Allow $(PRODUCT_NAME) to …") over nothing.
 *
 * Apple reads the purpose strings at review (Guideline 5.1.1) and a member
 * reads one whenever iOS asks on the app's behalf. So each one has to be
 * the app's own sentence, and true of what the code does. Where the code
 * decides whether a sentence is true, the code is read here too: if the
 * camera starts recording films, or something starts asking for location,
 * the test says which sentence has to change with it.
 */

const root = path.resolve(import.meta.dirname, "..");
const read = (rel: string) => readFileSync(path.join(root, rel), "utf8");

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === "node_modules" ? [] : walk(p);
    return /\.(tsx?|swift)$/.test(e.name) ? [p] : [];
  });
}

/** Every source file the app is built from: the screens, the code, the local native modules. */
const sources = () =>
  [...walk(path.join(root, "app")), ...walk(path.join(root, "src")), ...walk(path.join(root, "modules"))].map((f) => ({
    file: path.relative(root, f),
    text: readFileSync(f, "utf8"),
  }));

let plist: Record<string, unknown>;

beforeAll(async () => {
  const require = createRequire(path.join(root, "package.json"));
  const { getPrebuildConfigAsync } = require("@expo/prebuild-config");
  const { compileModsAsync } = require("@expo/config-plugins/build/plugins/mod-compiler.js");
  const { exp } = await getPrebuildConfigAsync(root, { platforms: ["ios"] });
  await compileModsAsync(exp, { projectRoot: root, introspect: true, platforms: ["ios"], assertMissingModProviders: false });
  plist = exp.ios.infoPlist;
}, 60_000);

const usage = () =>
  Object.entries(plist).filter(([k]) => /UsageDescription$/.test(k)) as [string, string][];

describe("the purpose strings iOS shows for VINTAGE", () => {
  it("are all the app's own sentences, never a plugin's template", () => {
    expect(usage().length).toBeGreaterThanOrEqual(6);
    for (const [key, text] of usage()) {
      expect(text, key).not.toContain("$(PRODUCT_NAME)");
      expect(text, key).not.toMatch(/^Allow /);
      expect(text.startsWith("VINTAGE") || text.startsWith("When you"), key).toBe(true);
    }
  });

  it("say a print can be saved, because the share sheet offers Save Image and Save Video", () => {
    // A print leaves through the system share sheet. Its Save Image / Save
    // Video writes to the library in the app's name, and iOS asks first
    // with this sentence (and stops the app without it).
    expect(read("src/utils/exportPost.ts")).toMatch(/Sharing\.shareAsync\(/);
    const add = plist.NSPhotoLibraryAddUsageDescription as string;
    expect(add).toBeTruthy();
    expect(add).not.toMatch(/does not save|never saves|nothing to your library/i);
    expect(add).toMatch(/share sheet/i);
    expect(add).toMatch(/nothing else/i);
  });

  it("do not promise to record sound while the camera only takes photographs", () => {
    const camera = read("src/utils/pickForCompose.ts").match(/launchCameraAsync\(\{[\s\S]*?\}\)/);
    expect(camera, "the camera call").toBeTruthy();
    const takesFilms = /mediaTypes:\s*\[[^\]]*videos/.test(camera![0]);
    const recorders = sources().filter(({ text }) =>
      /useAudioRecorder|RecordingPresets|requestRecordingPermissionsAsync|AVAudioRecorder|requestRecordPermission/.test(text),
    );
    const mic = plist.NSMicrophoneUsageDescription as string;
    if (takesFilms || recorders.length > 0) {
      // Once something records, say what: this sentence is what the member reads.
      expect(mic, `recording now happens in ${recorders.map((r) => r.file).join(", ") || "the camera"}`).toMatch(/record/i);
      expect(mic).not.toMatch(/does not record/i);
    } else {
      expect(mic).toMatch(/does not record/i);
    }
  });

  it("say location is never tracked, and nothing asks for it", () => {
    const askers = sources().filter(({ text }) =>
      /requestForegroundPermissionsAsync|requestBackgroundPermissionsAsync|getCurrentPositionAsync|watchPositionAsync|getLastKnownPositionAsync|requestWhenInUseAuthorization|requestAlwaysAuthorization|startUpdatingLocation|showsUserLocation=\{true\}|showsUserLocation\s*[/>]/.test(
        text,
      ),
    );
    expect(askers.map((a) => a.file)).toEqual([]);
    for (const key of [
      "NSLocationWhenInUseUsageDescription",
      "NSLocationAlwaysAndWhenInUseUsageDescription",
      "NSLocationAlwaysUsageDescription",
    ]) {
      expect(plist[key], key).toMatch(/does not track where you are/);
    }
    expect((plist.UIBackgroundModes as string[] | undefined) ?? []).not.toContain("location");
  });

  it("say Face ID is not used, and nothing uses it", () => {
    const users = sources().filter(({ text }) => /requireAuthentication|authenticateAsync|LAContext|evaluatePolicy/.test(text));
    expect(users.map((u) => u.file)).toEqual([]);
    expect(plist.NSFaceIDUsageDescription).toBe("VINTAGE does not use Face ID.");
  });

  it("keep export compliance, the iPhone-only portrait app and the limited-library prompt as they are", () => {
    const app = JSON.parse(read("app.json")).expo;
    expect(plist.ITSAppUsesNonExemptEncryption).toBe(false);
    expect(plist.PHPhotoLibraryPreventAutomaticLimitedAccessAlert).toBe(true);
    expect(app.ios.supportsTablet).toBe(false);
    expect(app.orientation).toBe("portrait");
  });
});
