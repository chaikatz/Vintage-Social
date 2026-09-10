import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  __subscribeForTest,
  isVideoMuted,
  resetVideoSound,
  setVideoMuted,
  toggleVideoMuted,
} from "@/utils/videoSound";

/**
 * The switch every video card follows. It has no native side of its own —
 * expo-video owns the audio session — so what matters here is that it is
 * one shared state, flips synchronously, and tells every listener.
 */
describe("feed video sound", () => {
  beforeEach(() => resetVideoSound());

  it("starts muted", () => {
    expect(isVideoMuted()).toBe(true);
  });

  it("flips the moment it is toggled — no promise in between", () => {
    const listener = vi.fn();
    __subscribeForTest(listener);
    toggleVideoMuted();
    expect(isVideoMuted()).toBe(false);
    expect(listener).toHaveBeenCalledTimes(1);
    toggleVideoMuted();
    expect(isVideoMuted()).toBe(true);
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("is one state for every card", () => {
    const a = vi.fn();
    const b = vi.fn();
    __subscribeForTest(a);
    __subscribeForTest(b);
    setVideoMuted(false);
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
  });

  it("ignores a no-op so listeners are not woken for nothing", () => {
    const listener = vi.fn();
    __subscribeForTest(listener);
    setVideoMuted(true);
    expect(listener).not.toHaveBeenCalled();
  });

  it("lets a listener leave", () => {
    const listener = vi.fn();
    const off = __subscribeForTest(listener);
    off();
    setVideoMuted(false);
    expect(listener).not.toHaveBeenCalled();
  });
});
