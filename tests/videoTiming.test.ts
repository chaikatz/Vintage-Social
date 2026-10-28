import { describe, expect, it } from "vitest";
import { CLIP_SPAN_STALE_MS, clipTiming, createClipTimer } from "@/utils/videoTiming";

/**
 * The development build's clip timings, with a fake clock: what a span
 * starts from, what ends it, and what it forgets. Under node there is no
 * __DEV__, which is how a release looks, and the shared timer is absent.
 */

function harness() {
  let t = 0;
  const logged: { label: string; ms: number; extra?: Record<string, unknown> }[] = [];
  const timer = createClipTimer({
    now: () => t,
    start: (label) => {
      const t0 = t;
      return (extra) => {
        logged.push({ label, ms: t - t0, extra });
        return t - t0;
      };
    },
  });
  return { timer, logged, advance: (ms: number) => (t += ms) };
}

const clip = { id: "3f2a91c0-aaaa-bbbb", media_path: "u1/3f2a91c0.mp4", media_type: "video" };

describe("clip start-up timings", () => {
  it("do not exist outside a development build", () => {
    expect(clipTiming).toBeNull();
  });

  it("time a profile tap to the first moving frame, tagged with where it opened", () => {
    const { timer, logged, advance } = harness();
    timer.asked(clip, "gallery");
    advance(300); // the gallery measures; the card is not on screen yet
    timer.shown(clip.media_path, "gallery", clip.id);
    advance(340);
    expect(timer.moving(clip.media_path)).toBe(640);
    expect(logged).toEqual([
      { label: "video.tap→firstFrame", ms: 640, extra: { surface: "gallery", from: "tap", id: "3f2a91c0" } },
    ]);
  });

  it("time Home from the card coming on screen, where there was no tap", () => {
    const { timer, logged, advance } = harness();
    timer.shown(clip.media_path, "feed", clip.id);
    advance(40);
    timer.moving(clip.media_path);
    expect(logged[0]).toMatchObject({ ms: 40, extra: { surface: "feed", from: "active" } });
  });

  it("finish a tap's span on a screen that does not say where it is", () => {
    // The single post's PostMedia passes no surface; the tap said "post".
    const { timer, logged, advance } = harness();
    timer.asked(clip, "post");
    advance(500);
    timer.shown(clip.media_path, null, null);
    advance(100);
    timer.moving(clip.media_path);
    expect(logged[0]).toMatchObject({ ms: 600, extra: { surface: "post", from: "tap" } });
  });

  it("start nothing for a card that does not say where it is and was not tapped", () => {
    const { timer, logged } = harness();
    timer.shown("file:///pending.mp4", null, null);
    expect(timer.moving("file:///pending.mp4")).toBeNull();
    expect(logged).toEqual([]);
  });

  it("log each start once", () => {
    const { timer, logged } = harness();
    timer.shown(clip.media_path, "feed", clip.id);
    timer.moving(clip.media_path);
    timer.moving(clip.media_path);
    expect(logged).toHaveLength(1);
  });

  it("forget a card that leaves the screen before its clip moves", () => {
    const { timer, logged } = harness();
    timer.shown(clip.media_path, "gallery", clip.id);
    timer.hidden(clip.media_path);
    expect(timer.moving(clip.media_path)).toBeNull();
    expect(logged).toEqual([]);
  });

  it("keep a tap's span while its card is still being drawn off screen", () => {
    const { timer, logged } = harness();
    timer.asked(clip, "gallery");
    timer.hidden(clip.media_path); // not yet shown: nothing to forget
    timer.shown(clip.media_path, "gallery", clip.id);
    timer.moving(clip.media_path);
    expect(logged[0]).toMatchObject({ extra: { from: "tap" } });
  });

  it("do not count a tap nobody followed through against a later start", () => {
    const { timer, logged, advance } = harness();
    timer.asked(clip, "gallery");
    advance(CLIP_SPAN_STALE_MS + 1);
    // Back on Home, the same clip comes on screen: its own span, from now.
    timer.shown(clip.media_path, "feed", clip.id);
    advance(25);
    timer.moving(clip.media_path);
    expect(logged).toEqual([{ label: "video.tap→firstFrame", ms: 25, extra: { surface: "feed", from: "active", id: "3f2a91c0" } }]);
  });

  it("leave a tap for one surface to that surface", () => {
    const { timer, logged } = harness();
    timer.asked(clip, "gallery");
    timer.shown(clip.media_path, "feed", clip.id);
    timer.moving(clip.media_path);
    expect(logged[0]).toMatchObject({ extra: { surface: "feed", from: "active" } });
  });

  it("time only clips, and print no path", () => {
    const { timer, logged } = harness();
    timer.asked({ ...clip, media_type: "photo" }, "gallery");
    expect(timer.moving(clip.media_path)).toBeNull();
    timer.shown(clip.media_path, "feed", null);
    timer.moving(clip.media_path);
    expect(JSON.stringify(logged)).not.toMatch(/mp4|u1\//);
  });
});
