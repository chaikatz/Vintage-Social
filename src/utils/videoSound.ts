import { useSyncExternalStore } from "react";

/**
 * Whether feed video is muted, shared by every card on screen.
 *
 * Video has to start muted — autoplay with sound is intrusive, and iOS will
 * refuse it outright in some contexts — but "muted" is a property of the
 * feed, not of one card. Unmute one photograph and the next one you scroll
 * to keeps the sound, which is what every feed does and what people expect.
 *
 * This is deliberately nothing more than a switch. The audio session is
 * expo-video's to manage: every player it owns reports its state to one
 * native manager, which puts the session in the `playback` category — the
 * one that plays through the ringer switch — and activates it the moment a
 * playing player is unmuted. An earlier version asked expo-audio to set the
 * session as well, which meant two managers with opinions about the same
 * session and a toggle that waited on a promise before it took effect. One
 * owner, and a switch that flips the instant it is tapped.
 */

let muted = true;
const listeners = new Set<() => void>();

function snapshot(): boolean {
  return muted;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function notify(): void {
  for (const listener of listeners) listener();
}

export function setVideoMuted(next: boolean): void {
  if (muted === next) return;
  muted = next;
  notify();
}

export function toggleVideoMuted(): void {
  setVideoMuted(!muted);
}

export function isVideoMuted(): boolean {
  return muted;
}

/** Subscribe a component to the shared mute state. */
export function useVideoMuted(): boolean {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}

/** Test seam: listen the way a component does, without rendering one. */
export function __subscribeForTest(listener: () => void): () => void {
  return subscribe(listener);
}

/** Test seam: back to muted. */
export function resetVideoSound(): void {
  muted = true;
  notify();
}
