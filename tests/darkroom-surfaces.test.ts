import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The surfaces outside the Darkroom: the accessibility settings the room
 * follows, the ordinary picker's EXIF, the words in the privacy policy and
 * the purpose string, and the two doors (the Post tab and On this day),
 * which must never be the thing that reads or asks for the library.
 *
 * iOS is faked: AccessibilityInfo answers when the test says so and keeps
 * a list of who is listening; the picker hands back whatever metadata the
 * test gives it, GPS block and all.
 */

const ios = vi.hoisted(() => ({
  os: "ios",
  answers: new Map<string, () => Promise<boolean>>(),
  reads: [] as string[],
  listeners: new Map<string, Set<(value: boolean) => void>>(),
  // The browser hands back nothing for an event it cannot follow.
  noSubscription: false,
  picked: null as null | Record<string, unknown>,
  pickerOptions: [] as Record<string, unknown>[],
  dated: [] as unknown[],
}));

function question(name: string) {
  return () => {
    ios.reads.push(name);
    const answer = ios.answers.get(name);
    return answer ? answer() : Promise.resolve(false);
  };
}

vi.mock("react-native", () => ({
  Platform: {
    get OS() {
      return ios.os;
    },
  },
  AccessibilityInfo: {
    isReduceMotionEnabled: question("isReduceMotionEnabled"),
    isDarkerSystemColorsEnabled: question("isDarkerSystemColorsEnabled"),
    isBoldTextEnabled: question("isBoldTextEnabled"),
    isScreenReaderEnabled: question("isScreenReaderEnabled"),
    addEventListener: (event: string, handler: (value: boolean) => void) => {
      const set = ios.listeners.get(event) ?? new Set();
      set.add(handler);
      ios.listeners.set(event, set);
      if (ios.noSubscription) return undefined;
      return { remove: () => set.delete(handler) };
    },
  },
  Alert: { alert: () => undefined },
}));

vi.mock("expo-image-picker", () => ({
  launchImageLibraryAsync: async (options: Record<string, unknown>) => {
    ios.pickerOptions.push(options);
    return ios.picked ? { canceled: false, assets: [ios.picked] } : { canceled: true, assets: [] };
  },
  launchCameraAsync: async (options: Record<string, unknown>) => {
    ios.pickerOptions.push(options);
    return ios.picked ? { canceled: false, assets: [ios.picked] } : { canceled: true, assets: [] };
  },
  requestCameraPermissionsAsync: async () => ({ granted: true }),
}));

vi.mock("@/api/media", () => ({
  prepareForDarkroom: async (uri: string) => ({ uri: `${uri}.prepared.jpg`, width: 2048, height: 1536 }),
}));

// Picked photographs are now prepared by the native decoder (sRGB, straight to size).
vi.mock("@/media/nativeMedia", () => ({
  prepareImage: async (uri: string) => ({ uri: `${uri}.prepared.jpg`, width: 2048, height: 1536 }),
  hasNativePrepare: () => true,
}));

// What the capture-date reader is handed, recorded, then read the real way.
vi.mock("@/utils/captureDate", async () => {
  const { captureDateFrom } = await import("@/utils/exif");
  return {
    captureDateForAsset: async (asset: { exif?: Record<string, unknown> | null; assetId?: string | null }) => {
      ios.dated.push(asset);
      return captureDateFrom(asset.exif);
    },
  };
});

const root = path.resolve(import.meta.dirname, "..");
const source = (file: string) => readFileSync(path.join(root, file), "utf8");

/** Let the promises in flight settle. */
const settle = () => new Promise((r) => setTimeout(r, 0));

/** iOS changes a setting and says so. */
function change(event: string, value: boolean) {
  for (const handler of [...(ios.listeners.get(event) ?? [])]) handler(value);
}

const listening = (event: string) => ios.listeners.get(event)?.size ?? 0;

beforeEach(() => {
  vi.resetModules();
  ios.os = "ios";
  ios.answers.clear();
  ios.reads.length = 0;
  ios.listeners.clear();
  ios.noSubscription = false;
  ios.picked = null;
  ios.pickerOptions.length = 0;
  ios.dated.length = 0;
});

// ---------------------------------------------------------------------------
// Accessibility settings
// ---------------------------------------------------------------------------

describe("an accessibility setting", () => {
  it("is off until iOS answers, then reads the answer and follows its change event", async () => {
    const { reducedMotion } = await import("@/utils/useReducedMotion");
    ios.answers.set("isReduceMotionEnabled", async () => true);
    const heard: boolean[] = [];
    expect(reducedMotion.get()).toBe(false);
    const stop = reducedMotion.subscribe(() => heard.push(reducedMotion.get()));
    expect(ios.reads).toEqual(["isReduceMotionEnabled"]);
    expect(listening("reduceMotionChanged")).toBe(1);
    await settle();
    expect(reducedMotion.get()).toBe(true);
    change("reduceMotionChanged", false);
    expect(reducedMotion.get()).toBe(false);
    expect(heard).toEqual([true, false]);
    stop();
  });

  it("asks once and listens once however many screens want it, and stops with the last", async () => {
    const { reducedMotion } = await import("@/utils/useReducedMotion");
    const a = reducedMotion.subscribe(() => undefined);
    const b = reducedMotion.subscribe(() => undefined);
    expect(ios.reads).toHaveLength(1);
    expect(listening("reduceMotionChanged")).toBe(1);
    a();
    expect(listening("reduceMotionChanged")).toBe(1);
    b();
    expect(listening("reduceMotionChanged")).toBe(0);
  });

  it("keeps the last answer for the next screen, and asks again when one comes", async () => {
    const { boldText } = await import("@/utils/useRoomAccessibility");
    ios.answers.set("isBoldTextEnabled", async () => true);
    const stop = boldText.subscribe(() => undefined);
    await settle();
    stop();
    expect(boldText.get()).toBe(true);
    ios.answers.set("isBoldTextEnabled", async () => false);
    const again = boldText.subscribe(() => undefined);
    expect(boldText.get()).toBe(true);
    await settle();
    expect(boldText.get()).toBe(false);
    expect(ios.reads).toEqual(["isBoldTextEnabled", "isBoldTextEnabled"]);
    again();
  });

  it("takes a change heard before the first answer over that older answer", async () => {
    const { increaseContrast } = await import("@/utils/useRoomAccessibility");
    let answer: (value: boolean) => void = () => undefined;
    ios.answers.set("isDarkerSystemColorsEnabled", () => new Promise((r) => (answer = r)));
    const stop = increaseContrast.subscribe(() => undefined);
    change("darkerSystemColorsChanged", true);
    answer(false);
    await settle();
    expect(increaseContrast.get()).toBe(true);
    stop();
  });

  it("hears nothing once no screen wants it, and an answer arriving after that is dropped", async () => {
    const { reducedMotion } = await import("@/utils/useReducedMotion");
    let answer: (value: boolean) => void = () => undefined;
    ios.answers.set("isReduceMotionEnabled", () => new Promise((r) => (answer = r)));
    const heard: boolean[] = [];
    const stop = reducedMotion.subscribe(() => heard.push(reducedMotion.get()));
    stop();
    answer(true);
    await settle();
    change("reduceMotionChanged", true);
    expect(reducedMotion.get()).toBe(false);
    expect(heard).toEqual([]);
  });

  it("stays off, without throwing, where the platform has no such question or event", async () => {
    const { accessibilitySetting } = await import("@/utils/useReducedMotion");
    ios.noSubscription = true;
    const missing = accessibilitySetting(() => undefined, "boldTextChanged");
    const stop = missing.subscribe(() => undefined);
    await settle();
    expect(missing.get()).toBe(false);
    expect(() => stop()).not.toThrow();

    const refusing = accessibilitySetting(() => Promise.reject(new Error("no")), "boldTextChanged");
    const stopRefusing = refusing.subscribe(() => undefined);
    await settle();
    expect(refusing.get()).toBe(false);
    stopRefusing();

    const throwing = accessibilitySetting(() => {
      throw new Error("not a function here");
    }, "boldTextChanged");
    expect(() => throwing.subscribe(() => undefined)()).not.toThrow();
  });

  it("follows the four settings the room uses, each through its own question and event", async () => {
    const motion = await import("@/utils/useReducedMotion");
    const room = await import("@/utils/useRoomAccessibility");
    const pairs = [
      [motion.reducedMotion, "isReduceMotionEnabled", "reduceMotionChanged"],
      [room.increaseContrast, "isDarkerSystemColorsEnabled", "darkerSystemColorsChanged"],
      [room.boldText, "isBoldTextEnabled", "boldTextChanged"],
      [room.screenReader, "isScreenReaderEnabled", "screenReaderChanged"],
    ] as const;
    for (const [setting, read, event] of pairs) {
      ios.answers.set(read, async () => true);
      const stop = setting.subscribe(() => undefined);
      await settle();
      expect(ios.reads).toContain(read);
      expect(listening(event)).toBe(1);
      expect(setting.get()).toBe(true);
      stop();
    }
    expect(typeof motion.useReducedMotion).toBe("function");
    expect(typeof room.useIncreaseContrast).toBe("function");
    expect(typeof room.useBoldText).toBe("function");
    expect(typeof room.useScreenReader).toBe("function");
  });

  it("treats the browser as a phone with VoiceOver off, since React Native for the web always says yes", async () => {
    ios.os = "web";
    ios.answers.set("isScreenReaderEnabled", async () => true);
    const { screenReader } = await import("@/utils/useRoomAccessibility");
    const stop = screenReader.subscribe(() => undefined);
    await settle();
    expect(screenReader.get()).toBe(false);
    expect(ios.reads).not.toContain("isScreenReaderEnabled");
    stop();
  });
});

// ---------------------------------------------------------------------------
// The ordinary picker
// ---------------------------------------------------------------------------

/** What iOS hands expo-image-picker for a photograph taken on a phone: dates, camera, and where. */
const SHOT_EXIF = {
  DateTimeOriginal: "2019:07:04 18:32:10",
  DateTimeDigitized: "2019:07:04 18:32:10",
  DateTime: "2019:07:05 09:00:00",
  OffsetTimeOriginal: "+01:00",
  LensModel: "iPhone 11 back camera",
  Make: "Apple",
  Model: "iPhone 11",
  GPSLatitude: 51.5007,
  GPSLatitudeRef: "N",
  GPSLongitude: 0.1246,
  GPSLongitudeRef: "W",
  GPSAltitude: 11,
  GPSDateStamp: "2019:07:04",
  GPSTimeStamp: "17:32:10",
  "{GPS}": { Latitude: 51.5007, Longitude: 0.1246 },
};

const hasPlace = (value: unknown): boolean => JSON.stringify(value ?? null).match(/GPS|Latitude|Longitude|Altitude/) != null;

describe("the ordinary picker", () => {
  it("keeps only the fields a capture date is read from", async () => {
    const { datesOnly } = await import("@/utils/pickForCompose");
    expect(datesOnly(SHOT_EXIF)).toEqual({
      DateTimeOriginal: "2019:07:04 18:32:10",
      DateTimeDigitized: "2019:07:04 18:32:10",
      DateTime: "2019:07:05 09:00:00",
    });
    expect(
      datesOnly({ "{Exif}": { DateTimeOriginal: "2001:02:03 04:05:06", GPSLatitude: 1 }, "{GPS}": { Latitude: 1 } }),
    ).toEqual({ "{Exif}": { DateTimeOriginal: "2001:02:03 04:05:06" } });
    expect(datesOnly({ GPSLatitude: 51.5, Make: "Apple" })).toBeNull();
    expect(datesOnly({ DateTimeOriginal: 20190704 })).toBeNull();
    expect(datesOnly(null)).toBeNull();
    expect(datesOnly(undefined)).toBeNull();
  });

  it("reads the same capture date from what it keeps as from the whole of the metadata", async () => {
    const { datesOnly } = await import("@/utils/pickForCompose");
    const { captureDateFrom } = await import("@/utils/exif");
    const cases: Record<string, unknown>[] = [
      SHOT_EXIF,
      { DateTimeDigitized: "2015:12:24 23:59:01", GPSLatitude: 1 },
      { "{Exif}DateTimeOriginal": "2012:01:01 10:00:00", GPSLongitude: 2 },
      { DateTime: "2010:06:30 12:00:00" },
      { "{Exif}": { DateTimeDigitized: "2008:08:08 08:08:08" }, GPSAltitude: 3 },
      { DateTimeOriginal: "not a date", DateTime: "2011:11:11 11:11:11" },
    ];
    for (const exif of cases) {
      expect(captureDateFrom(datesOnly(exif))).toBe(captureDateFrom(exif));
      expect(captureDateFrom(exif)).not.toBeNull();
    }
  });

  it("asks for EXIF for a photograph, and never lets its location reach anything else", async () => {
    const { pickFromLibrary } = await import("@/utils/pickForCompose");
    ios.picked = { uri: "file:///picked.heic", width: 4032, height: 3024, assetId: "A1", exif: { ...SHOT_EXIF } };
    const params = await pickFromLibrary("photo");
    expect(ios.pickerOptions[0]).toMatchObject({ mediaTypes: ["images"], exif: true });
    expect(ios.dated).toHaveLength(1);
    expect(hasPlace(ios.dated[0])).toBe(false);
    expect(ios.dated[0]).toEqual({ exif: datesOf(SHOT_EXIF), assetId: "A1" });
    expect(params).toMatchObject({ uri: "file:///picked.heic.prepared.jpg", mediaType: "photo", width: "2048", height: "1536" });
    expect(params?.takenAt).toBe(new Date(2019, 6, 4, 18, 32, 10).toISOString());
    expect(hasPlace(params)).toBe(false);
  });

  it("does not ask for EXIF for a video, which has none", async () => {
    const { pickFromLibrary } = await import("@/utils/pickForCompose");
    ios.picked = { uri: "file:///clip.mov", width: 1920, height: 1080, duration: 12_000, assetId: "V1", exif: null };
    const params = await pickFromLibrary("video");
    expect(ios.pickerOptions[0]).toMatchObject({ mediaTypes: ["videos"], exif: false });
    expect(ios.dated[0]).toEqual({ exif: null, assetId: "V1" });
    expect(params).toMatchObject({ uri: "file:///clip.mov", mediaType: "video", duration: "12" });
  });

  it("cuts the camera's metadata down the same way", async () => {
    const { takeForCompose } = await import("@/utils/pickForCompose");
    ios.picked = { uri: "file:///shot.jpg", width: 3024, height: 4032, exif: { ...SHOT_EXIF } };
    const params = await takeForCompose();
    expect(ios.pickerOptions[0]).toMatchObject({ mediaTypes: ["images"], exif: true });
    expect(hasPlace(ios.dated[0])).toBe(false);
    expect(params?.takenAt).not.toBe("");
  });

  it("passes on only the dates and the identifier, whoever hands it an asset", async () => {
    const { paramsForPicked } = await import("@/utils/pickForCompose");
    await paramsForPicked(
      { uri: "file:///raw.jpg", width: 10, height: 10, assetId: "R1", exif: { ...SHOT_EXIF } } as never,
      "photo",
    );
    expect(ios.dated[0]).toEqual({ exif: datesOf(SHOT_EXIF), assetId: "R1" });
  });

  it("is cancelled quietly", async () => {
    const { pickFromLibrary } = await import("@/utils/pickForCompose");
    expect(await pickFromLibrary("photo")).toBeNull();
    expect(ios.dated).toHaveLength(0);
  });

  it("never asks for the photo library", () => {
    const picker = source("src/utils/pickForCompose.ts");
    expect(picker).not.toMatch(/expo-media-library|requestPermissionsAsync|getAssetInfoAsync/);
  });
});

function datesOf(exif: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(exif).filter(([key]) => ["DateTimeOriginal", "DateTimeDigitized", "DateTime"].includes(key)),
  );
}

// ---------------------------------------------------------------------------
// The doors
// ---------------------------------------------------------------------------

/** The source without its comments, so a doc comment that names what is not done is not taken as doing it. */
function code(file: string): string {
  return source(file)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1")
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, "");
}

describe("the Post tab", () => {
  const tab = code("app/(tabs)/create.tsx");
  const dir = path.join(root, "src/components/post");
  const partFiles = readdirSync(dir).map((f) => `src/components/post/${f}`);
  const parts = partFiles.map((f) => [f, code(f)] as const);
  const roll = code("src/post/useRoll.ts");
  const postFiles = readdirSync(path.join(root, "src/post")).map((f) => `src/post/${f}`);
  /** The one function's body in a file, from its name to the next `const … = useCallback`. */
  const body = (src: string, name: string) => {
    const at = src.indexOf(`const ${name} = useCallback`);
    const next = src.indexOf("= useCallback", at + name.length + 20);
    return at < 0 ? "" : src.slice(at, next < 0 ? undefined : next);
  };

  it("draws the page without reading the library itself: its reads live in src/post", () => {
    for (const [f, src] of [["app/(tabs)/create.tsx", tab] as const, ...parts]) {
      expect(src, f).not.toMatch(/expo-media-library|@\/darkroom\/access"|@\/utils\/library|darkroomSource|nativeSource/);
      expect(src, f).not.toMatch(/readAccess|requestAccess|\.oldest\(|getPermissionsAsync|requestPermissionsAsync|getAssetsAsync|libraryGranted|watchLibrary/);
    }
    // Only these four ask the library anything, or open one of its photographs.
    const asking = postFiles.filter((f) => /darkroomSource|readDayDoor\(|source\.(page|count|oldest)\(|composeParamsFor|readAccess|requestAccess/.test(code(f)));
    expect(asking.sort()).toEqual(["src/post/dayDoor.ts", "src/post/openPrint.ts", "src/post/useDayDoor.ts", "src/post/useRoll.ts"]);
  });

  it("reads the library only once the tab is in front, and asks for it only from the panel's CONTINUE", () => {
    // What access there is is read in `front`, which goes no further when the tab is not in front.
    expect(roll.match(/readAccess\(\)/g)).toHaveLength(1);
    const front = roll.slice(roll.indexOf("const front = useCallback"), roll.indexOf("focusedRef.current = focused;"));
    expect(front).toMatch(/if \(!source \|\| !focusedRef\.current\) return;\s*const before = accessRef\.current;\s*const now = await readAccess\(\);/);
    // The focus effect goes no further than letting go while the tab is not in front; once in front, after its animation.
    const focus = roll.slice(roll.indexOf("focusedRef.current = focused;"), roll.indexOf("const change = AppState"));
    expect(focus).toMatch(/if \(!focused\) \{[\s\S]*?return;\s*\}/);
    expect(focus.indexOf("if (!focused)")).toBeLessThan(focus.indexOf("runAfterInteractions"));
    // A return from the background reads only while the tab is in front.
    expect(roll).toMatch(/onReturnFromBackground\(\(\) => \{\s*if \(!focusedRef\.current\) \{\s*heard\.current = true;\s*return;\s*\}/);
    // Asking, only from the tap.
    expect(roll.match(/requestAccess\(\)/g)).toHaveLength(1);
    expect(body(roll, "ask")).toMatch(/const now = await requestAccess\(\);/);
    expect(roll.match(/chooseMorePhotographs\(\)/g)).toHaveLength(1);
    expect(body(roll, "shareMore")).toMatch(/await chooseMorePhotographs\(\);/);
    for (const f of postFiles) {
      const src = code(f);
      expect(src, f).not.toMatch(/libraryGranted\(true\)|requestPermissionsAsync|presentPermissionsPickerAsync/);
    }
  });

  it("keeps no listener on the library, but for a moment after SHARE MORE, while in front", () => {
    expect(roll.match(/watchLibrary\(/g)).toHaveLength(1);
    expect(body(roll, "shareMore")).toMatch(/watching\.current = watchLibrary\(/);
    // Let go on blur, and when the tab goes.
    const focus = roll.slice(roll.indexOf("focusedRef.current = focused;"), roll.indexOf("const change = AppState"));
    expect(focus).toMatch(/if \(!focused\) \{\s*leftAt\.current = Date\.now\(\);\s*watching\.current\?\.\(\);\s*watching\.current = null;/);
    for (const f of postFiles.filter((f) => f !== "src/post/useRoll.ts")) expect(code(f), f).not.toMatch(/watchLibrary|addListener/);
  });

  it("reads through the room's own gate, in bounded pages and with no cursor", () => {
    expect(roll).toMatch(/return s \? gated\(s\) : null;/);
    expect(code("src/post/useDayDoor.ts")).toMatch(/return s \? inBackground\(s\) : null;/);
    for (const f of postFiles) expect(code(f), f).not.toMatch(/\bafter\s*:/);
    expect(roll).toMatch(/first: ROLL_FIRST, order: "desc"/);
    expect(roll).toMatch(/first: ROLL_PAGE, order: "desc"/);
  });

  it("keeps every photograph of the library in its own view: never in the shared cache, never on disk", () => {
    let images = 0;
    for (const [f, src] of parts) {
      for (const image of src.match(/<Image\b[\s\S]*?\/>/g) ?? []) {
        // The one photograph the member posted is the server's thumbnail; every other is the library's.
        if (/source=\{memory\.source\}/.test(image)) continue;
        images += 1;
        expect(image, f).toMatch(/source=\{[^}]*printSource\(/);
        expect(image, f).toContain('cachePolicy="none"');
        expect(image, f).not.toMatch(/cachePolicy="(memory|disk|memory-disk)"/);
        // All but the proof, which is asked for small and scaled up.
        if (!/transition=\{0\}\s*accessibilityIgnoresInvertColors/.test(image) || /recyclingKey/.test(image)) {
          expect(image, f).toMatch(/allowDownscaling=\{false\}/);
          expect(image, f).toMatch(/priority="normal"/);
          expect(image, f).toMatch(/recyclingKey=\{print\.id\}/);
        }
      }
      expect(src, f).not.toMatch(/prefetch/i);
    }
    // The cells, the mount's proof and photograph, and the doors' prints.
    expect(images).toBe(4);
    for (const f of postFiles) expect(code(f), f).not.toMatch(/prefetch/i);
    expect(tab).not.toMatch(/prefetch/i);
  });

  it("lets go of what is out of sight ten seconds after the tab is left, at once in the background, keeping what the screen shows", () => {
    // Nothing is drawn before the tab is first in front.
    expect(roll).toMatch(/const \[release, setRelease\] = useState<Release>\("all"\);/);
    // Left, and sent to the background: what is out of sight goes.
    expect(roll).toMatch(/releaseTimer\.current = setTimeout\(\(\) => setRelease\(\(r\) => \(r === "none" \? "unseen" : r\)\), RELEASE_AFTER_BLUR_MS\);/);
    expect(roll).toMatch(/if \(state === "background"\) \{[\s\S]*?setRelease\(\(r\) => \(r === "none" \? "unseen" : r\)\);/);
    // Short of memory: everything while the tab rests; in front, the mount's full image alone.
    expect(roll).toMatch(/if \(focusedRef\.current\) setHeroReleased\(true\);\s*else setRelease\("all"\);/);
    // In front again, everything comes back.
    expect(roll).toMatch(/releaseTimer\.current = null;\s*setRelease\("none"\);\s*setHeroReleased\(false\);/);
    expect(roll).toMatch(/state === "active" && focusedRef\.current\) \{\s*setRelease\("none"\);/);
    // What the screen shows stays: the rows in sight, one either side, and the mount while it is in view.
    expect(tab).toMatch(/release === "unseen"\s*\? \{\s*\.\.\.rowsInSight\(\{ offset: offset\.current, header: headerHeight\.current, viewport: viewport\.current, row: size \+ GAP \}\),\s*hero: offset\.current < heroBottom\.current,/);
    expect(tab).toMatch(/const rowReleased = \(index: number\) => release === "all" \|\| \(sight != null && \(index < sight\.first \|\| index > sight\.last\)\);/);
    expect(tab).toMatch(/released=\{rowReleased\(index\)\}/);
    expect(tab).toMatch(/released=\{heroLetGo\}/);
    // A photograph let go is taken off the screen with its view, so its picture goes with it: a view
    // given no source would keep showing, and holding, the last one.
    const cell = parts.find(([f]) => f.endsWith("RollCell.tsx"))![1];
    expect(cell).toMatch(/\{released \? null : \(\s*<Image\s+source=\{printSource\(print\.uri\)\}/);
    const hero = parts.find(([f]) => f.endsWith("RollHero.tsx"))![1];
    expect(hero).toMatch(/\{released \? null : \(\s*<Image\s+source=\{printSource\(print\.uri\)\}[^>]*?transition=\{0\}/);
    expect(hero).toMatch(/\{released \|\| heroReleased \? null : \(\s*<Image\s+source=\{printSource\(print\.uri\)\}/);
    for (const [f, src] of parts) expect(src, f).not.toMatch(/source=\{[^}]*\? null :/);
    // The doors' prints are a few points across: they stay while the tab rests, so the doors never change face.
    expect(tab).toMatch(/const pictures = allowed;/);
    expect(tab).not.toMatch(/roll\.released/);
  });

  it("reads where the member left off from the place file, and the shelf from its own", () => {
    expect(tab).toMatch(/import \{ placeCover, placeLine \} from "@\/darkroom\/session"/);
    expect(tab).toMatch(/import \{ useSetAside \} from "@\/darkroom\/setAside"/);
    expect(tab).toMatch(/useFocusEffect\([\s\S]*setPlace\(\{ line: placeLine\(\), cover: placeCover\(\) \}\)/);
  });

  it("opens the room, its shelf and On this day", () => {
    expect(tab).toMatch(/router\.push\("\/darkroom"\)/);
    expect(tab).toMatch(/params: \{ mode: "set-aside" \}/);
    expect(tab).toMatch(/router\.push\("\/memories"\)/);
    expect(tab).toMatch(/darkroomAvailable\(\)/);
  });

  it("says the room's name, never the old one, and only what the spec says", () => {
    const all = [tab, ...parts.map(([, src]) => src), code("src/post/panels.ts"), code("src/post/dayDoor.ts"), code("src/post/roll.ts")].join("\n");
    for (const words of [
      "The Memory Room",
      '"Rediscover something worth sharing."',
      'title="Enter the Memory Room"',
      'accessibilityHint="Opens your photographs, one at a time, from further back."',
      'accessibilityHint="Opens the photographs you set aside."',
      'accessibilityHint="Opens what you posted and photographed on this date in other years."',
      'label: "Continue", hint: "Asks to see your photo library.", act: "ask"',
      'label="Library"',
    ]) {
      expect(all).toContain(words);
    }
    expect(all).not.toMatch(/Darkroom/);
    expect(all).not.toMatch(/Find me something|randomOldPhoto|Something worth remembering|Today in other years/);
    expect(all).not.toMatch(/!["'`]/);
    expect(all).not.toMatch(/"[^"\n]*\w'\w[^"\n]*"|>[^<{]*\w'\w[^<{]*</);
  });
});

describe("On this day", () => {
  const memories = code("app/memories.tsx");

  it("never asks for the photo library", () => {
    expect(memories).not.toMatch(/libraryGranted\(true\)|requestPermissionsAsync|askLibrary/);
  });

  it("opens the Darkroom's On this day, at the year when a year is chosen", () => {
    expect(memories).toMatch(/pathname: "\/darkroom"/);
    expect(memories).toMatch(/mode: "on-this-day", year: String\(year\)/);
  });

  it("keeps the library's thumbnails in their cells alone", () => {
    // The library's photographs are drawn from their ph:// address, `p.uri`; a post is drawn from its URL.
    // Never on the app's disk, and never left in the shared memory cache, which nothing here would empty.
    const thumbs = memories.match(/<Image\s+source=\{p\.uri\}[\s\S]*?\/>/g) ?? [];
    expect(thumbs).toHaveLength(1);
    expect(thumbs[0]).toContain('cachePolicy="none"');
    expect(thumbs[0]).not.toMatch(/cachePolicy="(memory|disk|memory-disk)"/);
    expect(memories.match(/\bp\.uri\b/g)).toHaveLength(1);
  });
});

describe("the routes", () => {
  const layout = code("app/_layout.tsx");

  it("fade into the Darkroom over 360 ms on the app's own page, light or dark", () => {
    const darkroom = layout.slice(layout.indexOf('name="darkroom"'));
    const options = darkroom.slice(0, darkroom.indexOf("/>"));
    expect(options).toMatch(/animation: "fade",\s*animationDuration: 360/);
    expect(options).toMatch(/fullScreenGestureEnabled: false/);
    // No page of its own: the stack's, which is the app's paper in either appearance.
    expect(options).not.toMatch(/contentStyle|backgroundColor/);
    expect(layout).toMatch(/screenOptions=\{\{[\s\S]*?contentStyle: \{ backgroundColor: colors\.paper \}/);
    expect(layout).not.toMatch(/\bdark\.[a-zA-Z]/);
  });

  it("give compose a 280 ms fade only when it is developed from the Darkroom", () => {
    expect(layout).toMatch(/=== "darkroom"\s*\? \{ animation: "fade" as const, animationDuration: 280 \}\s*: \{ animation: "default" as const \}/);
  });
});

// ---------------------------------------------------------------------------
// What the member is told
// ---------------------------------------------------------------------------

const PURPOSE =
  "VINTAGE shows you the photographs in your library, and when each was taken, so you can find one to share. They are read on this iPhone; nothing is uploaded unless you post it.";

describe("the purpose string", () => {
  it("is one sentence, the same in all three places, and location stays off", () => {
    const expo = JSON.parse(source("app.json")).expo;
    const plugins = Object.fromEntries(
      (expo.plugins as unknown[]).filter(Array.isArray).map((p) => [p[0], p[1]] as [string, Record<string, unknown>]),
    );
    expect(expo.ios.infoPlist.NSPhotoLibraryUsageDescription).toBe(PURPOSE);
    expect(plugins["expo-image-picker"].photosPermission).toBe(PURPOSE);
    expect(plugins["expo-media-library"].photosPermission).toBe(PURPOSE);
    expect(expo.ios.infoPlist.PHPhotoLibraryPreventAutomaticLimitedAccessAlert).toBe(true);
    expect(plugins["expo-media-library"].isAccessMediaLocationEnabled).toBe(false);
  });
});

describe("the privacy policy", () => {
  it("says what the Darkroom keeps, and no more than it does", async () => {
    const { PRIVACY_POLICY } = await import("@/legal/documents");
    const darkroom = PRIVACY_POLICY.split(/\n\n+/).find((p) => p.startsWith("Your photo library, in the Memory Room and on the Post tab."));
    expect(darkroom).toBeDefined();
    const text = darkroom ?? "";
    // The place is never read, the Hidden album never looked through.
    expect(text).toContain("never by place");
    expect(text).toContain("It does not look through your Hidden album.");
    // Set aside keeps more than an identifier, and says so.
    expect(text).toMatch(/photographs you set aside[^.]*it keeps the date each was taken and its size/);
    // Forgetting in Settings keeps the shelf.
    expect(text).toContain("“Forget what the Memory Room has shown me” in Settings clears what it has shown you and where you left off, but keeps the photographs you set aside.");
    expect(text).toContain("The list is deleted when you sign out.");
    // Ordinary app data on the phone: no promise that a backup leaves it out.
    expect(text).toContain("can be included in your phone’s own backup");
    expect(text).not.toMatch(/only the library’?'?s own identifiers|never backed up|excluded from/i);
    expect(text).toContain("VINTAGE downloads the photograph itself only when you open it to post.");
    // The Post tab reads on the phone, while it is open, and keeps nothing.
    expect(text).toContain(
      "The Post tab shows your newest photographs first, and counts the photographs you took on today’s date in earlier years; it reads them on your phone while the tab is open and keeps nothing about them.",
    );
    expect(text).toContain("photographs you posted from either, for a year");
    expect(text).not.toMatch(/'/);
  });

  it("keeps the location sentence and the photo-library promise word for word", async () => {
    const { PRIVACY_POLICY } = await import("@/legal/documents");
    expect(PRIVACY_POLICY).toContain(
      "VINTAGE does not read your location from your photographs and does not track where you are. A place on a post is the one you typed or picked by name.",
    );
    expect(PRIVACY_POLICY).toContain(
      "We do not read your contacts. We do not upload anything from your photo library except the photographs you post.",
    );
  });

  it("is the same on the web as in the app", async () => {
    const { PRIVACY_POLICY, TERMS_OF_USE, LEGAL_UPDATED } = await import("@/legal/documents");
    const escape = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    for (const [doc, html] of [
      [PRIVACY_POLICY, source("public/privacy.html")],
      [TERMS_OF_USE, source("public/terms.html")],
    ] as const) {
      expect(html).toContain(`Last updated ${LEGAL_UPDATED}`);
      for (const paragraph of doc.trim().split(/\n\n+/)) {
        const tag = paragraph.startsWith("## ") ? `<h2>${escape(paragraph.slice(3))}</h2>` : `<p>${escape(paragraph)}</p>`;
        expect(html).toContain(tag);
      }
    }
  });
});
