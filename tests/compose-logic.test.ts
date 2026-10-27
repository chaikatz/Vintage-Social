import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  CLIP_LENGTH_GRACE_MS,
  authorFrom,
  bakesOnScreen,
  buildPostDraft,
  clampDurationSeconds,
  clipSeconds,
  clipTooLong,
  createShareGuard,
  developForPost,
  placeOf,
  type ComposeChoices,
  type Developed,
  type DevelopInput,
} from "@/utils/composeDraft";
import type { PostDraft } from "@/uploads";

/**
 * The compose screen's hand-over to the outbox, without a phone: the clip
 * length the posts table accepts, the guard against a second tap, the
 * develop decision for each kind of post, the draft built from the
 * choices frozen at the tap, and the picker's refusal to pass on a
 * photograph the renderer cannot read. A last block reads compose itself,
 * for the renderer layout that has regressed once already.
 */

const phone = vi.hoisted(() => ({
  picked: null as null | Record<string, unknown>,
  pickerOptions: [] as Record<string, unknown>[],
  prepareCalls: [] as { uri: string; opts: Record<string, unknown> }[],
  /** Each call takes the next answer; a function is called, an Error is thrown. */
  prepareAnswers: [] as unknown[],
  alerts: [] as { title: string; message?: string }[],
}));

vi.mock("react-native", () => ({
  Platform: { OS: "ios" },
  Alert: { alert: () => undefined },
}));

vi.mock("expo-image-picker", () => ({
  launchImageLibraryAsync: async (options: Record<string, unknown>) => {
    phone.pickerOptions.push(options);
    return phone.picked ? { canceled: false, assets: [phone.picked] } : { canceled: true, assets: [] };
  },
  launchCameraAsync: async (options: Record<string, unknown>) => {
    phone.pickerOptions.push(options);
    return phone.picked ? { canceled: false, assets: [phone.picked] } : { canceled: true, assets: [] };
  },
  requestCameraPermissionsAsync: async () => ({ granted: true }),
}));

vi.mock("@/media/nativeMedia", () => ({
  prepareImage: async (uri: string, opts: Record<string, unknown>) => {
    phone.prepareCalls.push({ uri, opts });
    const answer = phone.prepareAnswers.shift();
    if (answer instanceof Error) throw answer;
    if (answer !== undefined) return answer;
    return { uri: `${uri}.prepared.jpg`, width: 2048, height: 1536 };
  },
}));

vi.mock("@/utils/captureDate", () => ({
  captureDateForAsset: async () => null,
}));

vi.mock("@/utils/alert", () => ({
  showAlert: (title: string, message?: string) => {
    phone.alerts.push({ title, message });
  },
}));

beforeEach(() => {
  phone.picked = null;
  phone.pickerOptions.length = 0;
  phone.prepareCalls.length = 0;
  phone.prepareAnswers.length = 0;
  phone.alerts.length = 0;
});

// ---------------------------------------------------------------------------
// The clip's length
// ---------------------------------------------------------------------------

describe("a clip's length", () => {
  it("is held to the 1 to 60 whole seconds the posts table accepts", () => {
    expect(clampDurationSeconds(12)).toBe(12);
    expect(clampDurationSeconds(0.3)).toBe(1);
    expect(clampDurationSeconds(60)).toBe(60);
    // The old rounding turned these into 61, which the insert refused after the upload.
    expect(clampDurationSeconds(60.6)).toBe(60);
    expect(clampDurationSeconds(61)).toBe(60);
    expect(clampDurationSeconds(600)).toBe(60);
  });

  it("reads the route's string parameter the same way", () => {
    expect(clampDurationSeconds("12")).toBe(12);
    expect(clampDurationSeconds("61")).toBe(60);
    expect(clampDurationSeconds("0")).toBeNull();
    expect(clampDurationSeconds("")).toBeNull();
    expect(clampDurationSeconds("soon")).toBeNull();
  });

  it("stays unknown rather than inventing a length", () => {
    for (const unknown of [null, undefined, 0, -3, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(clampDurationSeconds(unknown)).toBeNull();
    }
  });

  it("turns the picker's milliseconds into the editor's parameter", () => {
    expect(clipSeconds(12_000)).toBe(12);
    expect(clipSeconds(400)).toBe(1);
    expect(clipSeconds(60_600)).toBe(60);
    expect(clipSeconds(null)).toBe(0);
    expect(clipSeconds(undefined)).toBe(0);
    expect(clipSeconds(0)).toBe(0);
  });

  it("refuses only what is longer than the minute, allowing the trimmer its last frames", () => {
    expect(clipTooLong(59_000)).toBe(false);
    expect(clipTooLong(60_000)).toBe(false);
    expect(clipTooLong(60_000 + CLIP_LENGTH_GRACE_MS)).toBe(false);
    expect(clipTooLong(60_000 + CLIP_LENGTH_GRACE_MS + 1)).toBe(true);
    expect(clipTooLong(61_000)).toBe(true);
    expect(clipTooLong(null)).toBe(false);
    expect(clipTooLong(undefined)).toBe(false);
  });

  it("never lets through a clip whose stored length the table would refuse", () => {
    for (let ms = 0; ms <= 62_000; ms += 50) {
      if (clipTooLong(ms)) continue;
      const seconds = clampDurationSeconds(clipSeconds(ms));
      if (seconds != null) {
        expect(seconds).toBeGreaterThanOrEqual(1);
        expect(seconds).toBeLessThanOrEqual(60);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// One post per tap
// ---------------------------------------------------------------------------

describe("the Share guard", () => {
  it("lets one tap through and refuses the second, before anything renders", () => {
    const guard = createShareGuard();
    expect(guard.state).toBe("idle");
    expect(guard.begin()).toBe(true);
    expect(guard.state).toBe("sharing");
    expect(guard.begin()).toBe(false);
    expect(guard.begin()).toBe(false);
  });

  it("opens again when the post could not be kept, so the member can try once more", () => {
    const guard = createShareGuard();
    guard.begin();
    guard.fail();
    expect(guard.state).toBe("idle");
    expect(guard.begin()).toBe(true);
  });

  it("stays shut once the outbox has the post", () => {
    const guard = createShareGuard();
    guard.begin();
    guard.succeed();
    expect(guard.state).toBe("shared");
    expect(guard.begin()).toBe(false);
    // A late failure from anywhere cannot reopen a screen whose post is gone.
    guard.fail();
    expect(guard.state).toBe("shared");
    expect(guard.begin()).toBe(false);
  });

  it("does not count a post that was never begun", () => {
    const guard = createShareGuard();
    guard.succeed();
    expect(guard.state).toBe("idle");
    guard.fail();
    expect(guard.state).toBe("idle");
  });

  it("keeps each screen's guard to itself", () => {
    const a = createShareGuard();
    const b = createShareGuard();
    a.begin();
    expect(b.begin()).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Developing
// ---------------------------------------------------------------------------

const PHOTO: DevelopInput = {
  kind: "photo",
  uri: "file:///editor/picked.jpg",
  width: 2048,
  height: 1536,
  filterId: "archive",
  renderFailed: false,
  canBakeVideo: true,
  demo: false,
};

const BAKED = { uri: "file:///caches/GLView/baked.jpeg", width: 1440, height: 1080 };

describe("what has to wait for the renderer", () => {
  it("is only a photograph with a film it could read", () => {
    expect(bakesOnScreen(PHOTO)).toBe(true);
    expect(bakesOnScreen({ ...PHOTO, filterId: "none" })).toBe(false);
    expect(bakesOnScreen({ ...PHOTO, renderFailed: true })).toBe(false);
    expect(bakesOnScreen({ ...PHOTO, kind: "video" })).toBe(false);
  });
});

describe("developing a post", () => {
  it("leaves None as it is, baked by definition, without touching the renderer", async () => {
    const bake = vi.fn(async () => BAKED);
    const out = await developForPost({ ...PHOTO, filterId: "none" }, bake);
    expect(bake).not.toHaveBeenCalled();
    expect(out).toEqual({
      sourceUri: PHOTO.uri,
      sourceWidth: 2048,
      sourceHeight: 1536,
      filterBaked: true,
      bakeVideo: false,
    });
  });

  it("posts a film's bake at the bake's own size", async () => {
    const bake = vi.fn(async () => BAKED);
    const out = await developForPost(PHOTO, bake);
    expect(bake).toHaveBeenCalledTimes(1);
    expect(out).toEqual({ sourceUri: BAKED.uri, sourceWidth: 1440, sourceHeight: 1080, filterBaked: true, bakeVideo: false });
  });

  it("posts the photograph unbaked when the bake fails, rather than losing the post", async () => {
    const out = await developForPost(PHOTO, async () => {
      throw Object.assign(new Error("EXGLContext not found"), { code: "E_GL_BAD_VIEW_TAG" });
    });
    expect(out).toEqual({ sourceUri: PHOTO.uri, sourceWidth: 2048, sourceHeight: 1536, filterBaked: false, bakeVideo: false });
  });

  it("treats a renderer that is gone, or a bake with nothing in it, as a failed bake", async () => {
    const answers = [undefined, null, { uri: "", width: 1440, height: 1080 }, { uri: BAKED.uri, width: 0, height: 1080 }];
    for (const answer of answers) {
      const out = await developForPost(PHOTO, async () => answer as never);
      expect(out.filterBaked).toBe(false);
      expect(out.sourceUri).toBe(PHOTO.uri);
    }
  });

  it("never bakes a photograph the renderer could not read", async () => {
    const bake = vi.fn(async () => BAKED);
    const out = await developForPost({ ...PHOTO, renderFailed: true }, bake);
    expect(bake).not.toHaveBeenCalled();
    expect(out.filterBaked).toBe(false);
    expect(out.sourceUri).toBe(PHOTO.uri);
  });

  it("hands a clip over as picked, with the native bake left to the outbox where the build has one", async () => {
    const bake = vi.fn(async () => BAKED);
    const clip: DevelopInput = { ...PHOTO, kind: "video", uri: "file:///picked/clip.mov", width: 1080, height: 1920 };
    const cases: [boolean, boolean, boolean][] = [
      [true, false, true],
      [true, true, false],
      [false, false, false],
      [false, true, false],
    ];
    for (const [canBakeVideo, demo, expected] of cases) {
      const out = await developForPost({ ...clip, canBakeVideo, demo }, bake);
      expect(out).toEqual({
        sourceUri: clip.uri,
        sourceWidth: 1080,
        sourceHeight: 1920,
        filterBaked: false,
        bakeVideo: expected,
      });
    }
    expect(bake).not.toHaveBeenCalled();
  });

  it("keeps an unknown size unknown", async () => {
    const out = await developForPost({ ...PHOTO, filterId: "none", width: null, height: 0 }, async () => BAKED);
    expect(out.sourceWidth).toBeNull();
    expect(out.sourceHeight).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// The draft
// ---------------------------------------------------------------------------

const AUTHOR = { id: "user-1", username: "june", full_name: "June Lark", avatar_url: "user-1/a.jpg" };

function choices(over: Partial<ComposeChoices> = {}): ComposeChoices {
  return {
    postId: "8d3f2c44-0b9e-4c1e-9a55-3f0e2a7b1c90",
    userId: "user-1",
    kind: "photo",
    duration: "0",
    filterId: "archive",
    showDateStamp: true,
    caption: "  Leith, late  ",
    takenAt: "2026-06-14T18:22:00.000Z",
    place: { kind: "place", fields: { location: "The Shore", place_id: "apple:123", lat: 55.976, lng: -3.17 } },
    tagIds: ["user-2", "user-3"],
    assetId: "ASSET-1",
    author: AUTHOR,
    ...over,
  };
}

const DEVELOPED: Developed = {
  sourceUri: BAKED.uri,
  sourceWidth: 1440,
  sourceHeight: 1080,
  filterBaked: true,
  bakeVideo: false,
};

/** Every field of the outbox's PostDraft, so a draft can be checked against the shared contract. */
const DRAFT_KEYS: (keyof PostDraft)[] = [
  "id",
  "userId",
  "kind",
  "sourceUri",
  "sourceWidth",
  "sourceHeight",
  "durationSeconds",
  "filterId",
  "filterBaked",
  "bakeVideo",
  "showDateStamp",
  "caption",
  "takenAt",
  "location",
  "lat",
  "lng",
  "placeId",
  "tagIds",
  "assetId",
  "author",
];

describe("the draft handed to the outbox", () => {
  it("carries every choice as it stood at the tap", () => {
    const draft = buildPostDraft(choices(), DEVELOPED);
    expect(draft).toEqual({
      id: "8d3f2c44-0b9e-4c1e-9a55-3f0e2a7b1c90",
      userId: "user-1",
      kind: "photo",
      sourceUri: BAKED.uri,
      sourceWidth: 1440,
      sourceHeight: 1080,
      durationSeconds: null,
      filterId: "archive",
      filterBaked: true,
      bakeVideo: false,
      showDateStamp: true,
      caption: "Leith, late",
      takenAt: "2026-06-14T18:22:00.000Z",
      location: "The Shore",
      lat: 55.976,
      lng: -3.17,
      placeId: "apple:123",
      tagIds: ["user-2", "user-3"],
      assetId: "ASSET-1",
      author: AUTHOR,
    });
    expect(Object.keys(draft).sort()).toEqual([...DRAFT_KEYS].sort());
  });

  it("keeps the same id however many times the draft is built", () => {
    const a = buildPostDraft(choices(), DEVELOPED);
    const b = buildPostDraft(choices(), { ...DEVELOPED, filterBaked: false, sourceUri: "file:///editor/picked.jpg" });
    expect(a.id).toBe(b.id);
  });

  it("is a copy: changing the screen's state afterwards cannot reach a queued post", () => {
    const tagIds = ["user-2"];
    const author = { ...AUTHOR };
    const draft = buildPostDraft(choices({ tagIds, author }), DEVELOPED);
    tagIds.push("user-9");
    author.username = "someone-else";
    expect(draft.tagIds).toEqual(["user-2"]);
    expect(draft.author.username).toBe("june");
  });

  it("tags each member once, in the order chosen", () => {
    const draft = buildPostDraft(choices({ tagIds: ["user-3", "user-2", "user-3"] }), DEVELOPED);
    expect(draft.tagIds).toEqual(["user-3", "user-2"]);
  });

  it("stores words alone with no point on the map", () => {
    const draft = buildPostDraft(choices({ place: { kind: "text", text: "  Leith  " } }), DEVELOPED);
    expect([draft.location, draft.lat, draft.lng, draft.placeId]).toEqual(["Leith", null, null, null]);
    expect(placeOf({ kind: "text", text: "   " })).toEqual({ location: null, lat: null, lng: null, placeId: null });
    expect(placeOf(null)).toEqual({ location: null, lat: null, lng: null, placeId: null });
  });

  it("stores no capture date, asset or caption rather than empty strings", () => {
    const draft = buildPostDraft(choices({ takenAt: "", assetId: "", caption: "   " }), DEVELOPED);
    expect(draft.takenAt).toBeNull();
    expect(draft.assetId).toBeNull();
    expect(draft.caption).toBe("");
    expect(buildPostDraft(choices({ takenAt: undefined, assetId: undefined }), DEVELOPED).takenAt).toBeNull();
  });

  it("gives a photograph no length, whatever the route said", () => {
    expect(buildPostDraft(choices({ duration: "12" }), DEVELOPED).durationSeconds).toBeNull();
  });

  it("holds a clip's length to the table's 1 to 60 and leaves its film to the native bake", () => {
    const clip: Developed = {
      sourceUri: "file:///picked/clip.mov",
      sourceWidth: 1080,
      sourceHeight: 1920,
      filterBaked: true,
      bakeVideo: true,
    };
    const draft = buildPostDraft(choices({ kind: "video", duration: "61" }), clip);
    expect(draft.kind).toBe("video");
    expect(draft.durationSeconds).toBe(60);
    // The pixels of a picked clip carry no film yet, whatever developing said.
    expect(draft.filterBaked).toBe(false);
    expect(draft.bakeVideo).toBe(true);
    expect(draft.sourceUri).toBe("file:///picked/clip.mov");
    expect(buildPostDraft(choices({ kind: "video", duration: "0" }), clip).durationSeconds).toBeNull();
    expect(buildPostDraft(choices({ kind: "video", duration: 14.6 }), clip).durationSeconds).toBe(15);
  });

  it("never asks the outbox to bake a photograph as a clip", () => {
    expect(buildPostDraft(choices(), { ...DEVELOPED, bakeVideo: true }).bakeVideo).toBe(false);
  });
});

describe("the author on the pending card", () => {
  it("is the signed-in member's own profile", () => {
    const profile = { ...AUTHOR, bio: "", city: null };
    expect(authorFrom(profile, "user-1")).toEqual(AUTHOR);
  });

  it("is a quiet blank under the member's own id when the profile is not there", () => {
    expect(authorFrom(null, "user-1")).toEqual({ id: "user-1", username: "", full_name: null, avatar_url: null });
    expect(authorFrom(undefined, "user-1").id).toBe("user-1");
  });

  it("is never another member's profile left over from before", () => {
    expect(authorFrom({ ...AUTHOR, id: "user-7", username: "otis" }, "user-1")).toEqual({
      id: "user-1",
      username: "",
      full_name: null,
      avatar_url: null,
    });
  });
});

// ---------------------------------------------------------------------------
// The picker
// ---------------------------------------------------------------------------

describe("the picker hands the editor only what the renderer can read", () => {
  it("prepares a photograph at the editor's size and quality", async () => {
    const { pickFromLibrary, PICKED_MAX_SIDE, PICKED_QUALITY } = await import("@/utils/pickForCompose");
    phone.picked = { uri: "file:///picked/IMG_0001.heic", width: 4032, height: 3024 };
    const params = await pickFromLibrary("photo");
    expect(phone.prepareCalls).toEqual([
      { uri: "file:///picked/IMG_0001.heic", opts: { maxSide: PICKED_MAX_SIDE, quality: PICKED_QUALITY } },
    ]);
    expect([PICKED_MAX_SIDE, PICKED_QUALITY]).toEqual([2048, 0.92]);
    expect(params).toMatchObject({
      uri: "file:///picked/IMG_0001.heic.prepared.jpg",
      mediaType: "photo",
      width: "2048",
      height: "1536",
      duration: "0",
    });
  });

  it("tries once more when the first decode fails", async () => {
    const { pickFromLibrary } = await import("@/utils/pickForCompose");
    phone.picked = { uri: "file:///picked/IMG_0002.heic", width: 4032, height: 3024 };
    phone.prepareAnswers.push(new Error("ImageIO could not read it"));
    const params = await pickFromLibrary("photo");
    expect(phone.prepareCalls).toHaveLength(2);
    expect(params?.uri).toBe("file:///picked/IMG_0002.heic.prepared.jpg");
    expect(phone.alerts).toEqual([]);
  });

  it("never falls through with the original, which draws black, and says so calmly", async () => {
    const { pickFromLibrary } = await import("@/utils/pickForCompose");
    phone.picked = { uri: "file:///picked/IMG_0003.heic", width: 4032, height: 3024 };
    phone.prepareAnswers.push(new Error("no"), new Error("still no"));
    const params = await pickFromLibrary("photo");
    expect(params).toBeNull();
    expect(phone.prepareCalls).toHaveLength(2);
    expect(phone.alerts).toHaveLength(1);
    expect(phone.alerts[0].title).toBe("Couldn’t open that photograph");
    expect(`${phone.alerts[0].title} ${phone.alerts[0].message}`).not.toMatch(/!|'/);
  });

  it("counts a decode with no picture in it as a failure", async () => {
    const { takeForCompose } = await import("@/utils/pickForCompose");
    phone.picked = { uri: "file:///camera/shot.jpg", width: 3024, height: 4032 };
    phone.prepareAnswers.push({ uri: "file:///x.jpg", width: 0, height: 0 }, { uri: "", width: 10, height: 10 });
    expect(await takeForCompose()).toBeNull();
    expect(phone.alerts).toHaveLength(1);
  });

  it("takes a clip of the full minute and stores it as 60 seconds", async () => {
    const { pickFromLibrary } = await import("@/utils/pickForCompose");
    phone.picked = { uri: "file:///picked/clip.mov", width: 1080, height: 1920, duration: 60_400 };
    const params = await pickFromLibrary("video");
    expect(params).toMatchObject({ uri: "file:///picked/clip.mov", mediaType: "video", duration: "60" });
    // A clip is not decoded here: the outbox develops it.
    expect(phone.prepareCalls).toEqual([]);
    expect(phone.alerts).toEqual([]);
  });

  it("refuses a clip over the minute before any of it is developed", async () => {
    const { pickFromLibrary } = await import("@/utils/pickForCompose");
    phone.picked = { uri: "file:///picked/long.mov", width: 1080, height: 1920, duration: 61_000 };
    expect(await pickFromLibrary("video")).toBeNull();
    expect(phone.alerts.map((a) => a.title)).toEqual(["Too long"]);
  });

  it("leaves the clip's picker options as they were", async () => {
    const { pickFromLibrary } = await import("@/utils/pickForCompose");
    phone.picked = { uri: "file:///picked/clip.mov", width: 1080, height: 1920, duration: 5_000 };
    await pickFromLibrary("video");
    expect(phone.pickerOptions[0]).toEqual({
      mediaTypes: ["videos"],
      allowsEditing: true,
      quality: 1,
      videoMaxDuration: 60,
      exif: false,
    });
  });
});

// ---------------------------------------------------------------------------
// Compose itself
// ---------------------------------------------------------------------------

const root = path.resolve(import.meta.dirname, "..");

/** The source without its comments, so prose that names what is not done is not taken as doing it. */
function code(file: string): string {
  return readFileSync(path.join(root, file), "utf8")
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

describe("compose", () => {
  const compose = code("app/compose.tsx");

  it("puts the preview's renderer straight into the frame, with no view of its own around it", () => {
    // A wrapper whose style changes is flattened and restored by Fabric,
    // which takes the GL view off its parent, and expo-gl then destroys its
    // context: the regression of b93d4be, fixed once before in 2835c7d.
    expect(compose).not.toMatch(/filmWaiting/);
    const frame = compose.indexOf("<View style={[styles.preview");
    const renderer = compose.indexOf("ref={filteredRef}");
    expect(frame).toBeGreaterThan(-1);
    expect(renderer).toBeGreaterThan(frame);
    const between = compose.slice(frame + 1, renderer);
    expect(between).not.toMatch(/<View\b/);
    expect(between).not.toMatch(/<Animated\./);
  });

  it("keeps the plain photograph mounted under the renderer, in memory only", () => {
    const frame = compose.indexOf("<View style={[styles.preview");
    const renderer = compose.indexOf("ref={filteredRef}");
    const underlay = compose.slice(frame, renderer).match(/<Image\s+source=\{uri\}[^>]*\/>/);
    expect(underlay?.[0]).toMatch(/cachePolicy="memory"/);
    // Mounted whatever the renderer is doing: nothing in front of it decides.
    expect(compose.slice(frame, renderer)).not.toMatch(/filmReady|!filmReady/);
  });

  it("draws every swatch from the tray's own small copy, at that copy's size", () => {
    expect(compose).toMatch(/maxSide: TRAY_MAX_SIDE, quality: TRAY_QUALITY/);
    expect(compose).toMatch(/const TRAY_MAX_SIDE = 240;/);
    expect(compose).toMatch(/const TRAY_QUALITY = 0\.85;/);
    const swatch = compose.match(/<FilteredImage\s+uri=\{tray\.uri\}[\s\S]*?\/>/)?.[0] ?? "";
    expect(swatch).toMatch(/width=\{tray\.width\}/);
    expect(swatch).toMatch(/height=\{tray\.height\}/);
    expect(swatch).toMatch(/filter=\{f\}/);
    expect(compose).not.toMatch(/uri=\{poster\?\.uri \?\? uri\}/);
  });

  it("leaves the posting itself to the outbox", () => {
    expect(compose).toMatch(/await enqueuePost\(buildPostDraft\(choices, developed\)\)/);
    for (const call of [
      /createPost\(/,
      /uploadFile\(/,
      /tagMembers\(/,
      /rememberPlace\(/,
      /markDeveloped\(/,
      /refreshProfile/,
      /\.prefetch\(/,
      /invalidateQueries\(/,
      /prepareFeedImage|prepareThumbnail/,
      /bakeVideo\(/,
    ]) {
      expect(compose).not.toMatch(call);
    }
    expect(compose).not.toMatch(/Couldn’t publish/);
  });

  it("mints the post id once per visit, not once per tap", () => {
    expect(compose).toMatch(/useState\(\(\) => Crypto\.randomUUID\(\)\)/);
    const share = compose.slice(compose.indexOf("const share = async"));
    expect(share).not.toMatch(/randomUUID/);
  });

  it("guards the tap before anything awaits", () => {
    const share = compose.slice(compose.indexOf("const share = async"), compose.indexOf("const stampLabel"));
    const guard = share.indexOf("guard.begin()");
    expect(guard).toBeGreaterThan(-1);
    expect(guard).toBeLessThan(share.indexOf("await"));
  });

  it("goes Home by popping back to the tabs that are there, not by replacing them", () => {
    expect(compose).toMatch(/router\.dismissTo\("\/\(tabs\)"\)/);
    expect(compose).not.toMatch(/router\.replace\(/);
    expect(compose).not.toMatch(/router\.dismissAll\(/);
  });

  it("bakes a film at the feed's size", () => {
    expect(compose).toMatch(/filteredRef\.current\?\.bake\(\{ maxSide: BAKE_MAX_SIDE \}\)/);
  });
});
