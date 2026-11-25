import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Where a stored media path is drawn from. The browser demo posts a
 * photograph from the Post tab's roll (or the Memory Room) as the page's
 * own address for the bundled picture, "/assets/…": it is drawn from
 * there, not looked up as a storage key, which would draw nothing. Off
 * the demo, a path is a storage key as before.
 */

const h = vi.hoisted(() => ({ demo: true }));
vi.mock("react-native", () => ({ Platform: { OS: "web" } }));
vi.mock("expo-image-manipulator", () => ({}));
vi.mock("@/media/nativeMedia", () => ({ prepareImage: vi.fn() }));
vi.mock("@/uploads/storageUpload", () => ({ IMMUTABLE_CACHE_SECONDS: 1, SHORT_CACHE_SECONDS: 1, uploadToStorage: vi.fn() }));
vi.mock("@/utils/retry", () => ({ isTransient: () => false, withRetry: (fn: () => unknown) => fn(), withTimeout: (p: unknown) => p }));
vi.mock("@/demo/photoAssets", () => ({ PHOTOS: { "milan-nebbia": 101 } }));
vi.mock("@/lib/env", () => ({ isDemoMode: () => h.demo }));
vi.mock("@/lib/supabase", () => ({
  supabase: { storage: { from: (bucket: string) => ({ getPublicUrl: (p: string) => ({ data: { publicUrl: `https://store.example/${bucket}/${p}` } }) }) } },
}));

const { mediaUrl } = await import("@/api/media");
const { DEMO_PREFIX } = await import("@/demo/photos");

beforeEach(() => {
  h.demo = true;
});

describe("a media path, drawn", () => {
  it("in the demo, a photograph posted from the roll is drawn from the page's own address", () => {
    expect(mediaUrl("media", "/assets/src/demo/photos/milan.jpg")).toBe("/assets/src/demo/photos/milan.jpg");
    expect(mediaUrl("media", `${DEMO_PREFIX}milan-nebbia`)).toBe(101);
    expect(mediaUrl("media", "https://example.org/a.jpg")).toBe("https://example.org/a.jpg");
  });

  it("off the demo, every other path is a storage key", () => {
    h.demo = false;
    expect(mediaUrl("media", "user-1/post-1.jpg")).toBe("https://store.example/media/user-1/post-1.jpg");
    expect(mediaUrl("media", "/assets/x.jpg")).toBe("https://store.example/media//assets/x.jpg");
    expect(mediaUrl("media", null)).toBeNull();
  });
});
