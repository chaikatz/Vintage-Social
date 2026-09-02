import { useSyncExternalStore } from "react";
import { setAudioModeAsync } from "expo-audio";

/**
 * Whether feed video is muted, shared by every card on screen.
 *
 * Video has to start muted — autoplay with sound is intrusive, and iOS will
 * refuse it outright in some contexts — but "muted" is a property of the
 * feed, not of one card. Unmute one photograph and the next one you scroll
 * to keeps the sound, which is what every feed does and what people expect.
 *
 * Unmuting also has to reconfigure the audio session. By default iOS honours
 * the ringer switch, so a muted phone plays nothing and the button looks
 * broken. Asking for the `playback` category (playsInSilentMode) is what lets
 * a deliberate unmute actually make sound. It is requested on the first
 * unmute rather than at launch, so VINTAGE does not claim the audio session
 * of someone who never turns the sound on.
 */

let muted = true;
let sessionReady = false;
const listeners = new Set<() => void>();

function snapshot(): boolean {
  return muted;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

async function ensureAudioSession(): Promise<void> {
  if (sessionReady) return;
  sessionReady = true;
  try {
    await setAudioModeAsync({
      playsInSilentMode: true,
      // Someone else's music should duck, not stop dead: a short clip is
      // not a reason to kill what they were listening to.
      interruptionMode: "duckOthers",
      shouldPlayInBackground: false,
    });
  } catch {
    // An audio session we could not claim just means the ringer switch
    // still wins. Playing quietly is better than failing loudly.
    sessionReady = false;
  }
}

export function setVideoMuted(next: boolean): void {
  if (muted === next) return;
  muted = next;
  if (!next) void ensureAudioSession();
  for (const listener of listeners) listener();
}

export function toggleVideoMuted(): void {
  setVideoMuted(!muted);
}

/** Subscribe a component to the shared mute state. */
export function useVideoMuted(): boolean {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}

/** Test seam: forget the session and go back to muted. */
export function resetVideoSound(): void {
  muted = true;
  sessionReady = false;
  for (const listener of listeners) listener();
}
