import { beforeEach, describe, expect, it, vi } from "vitest";

// The real module talks to the iOS audio session; what matters here is when
// that session is claimed, not what the platform does with it.
const setAudioModeAsync = vi.fn().mockResolvedValue(undefined);
vi.mock("expo-audio", () => ({
  setAudioModeAsync: (...args: unknown[]) => setAudioModeAsync(...args),
}));

const { setVideoMuted, toggleVideoMuted, resetVideoSound } = await import("@/utils/videoSound");

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("feed video sound", () => {
  beforeEach(() => {
    resetVideoSound();
    setAudioModeAsync.mockClear();
  });

  it("claims nothing while the feed stays muted", async () => {
    setVideoMuted(true);
    await flush();
    // Video autoplays muted, so an app that never has its sound turned on
    // should never take the audio session away from anything else.
    expect(setAudioModeAsync).not.toHaveBeenCalled();
  });

  it("asks to play through the ringer switch on the first unmute", async () => {
    setVideoMuted(false);
    await flush();
    expect(setAudioModeAsync).toHaveBeenCalledTimes(1);
    expect(setAudioModeAsync.mock.calls[0][0]).toMatchObject({
      playsInSilentMode: true,
      interruptionMode: "duckOthers",
    });
  });

  it("claims the session once, not on every toggle", async () => {
    setVideoMuted(false);
    await flush();
    toggleVideoMuted();
    toggleVideoMuted();
    await flush();
    expect(setAudioModeAsync).toHaveBeenCalledTimes(1);
  });

  it("ignores a set that changes nothing", async () => {
    setVideoMuted(true);
    setVideoMuted(true);
    await flush();
    expect(setAudioModeAsync).not.toHaveBeenCalled();
  });

  it("toggles back and forth", async () => {
    toggleVideoMuted(); // muted -> unmuted
    await flush();
    expect(setAudioModeAsync).toHaveBeenCalledTimes(1);
    toggleVideoMuted(); // unmuted -> muted, nothing new to claim
    await flush();
    expect(setAudioModeAsync).toHaveBeenCalledTimes(1);
  });
});
