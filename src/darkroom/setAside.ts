import { useSyncExternalStore } from "react";
import { deleteDiskCache, readDiskCache, writeDiskCache } from "@/utils/diskCache";
import type { Print } from "./types";

/**
 * Photographs set aside to come back to — the prints a member leaves on
 * the side of the bench to decide on later.
 *
 * A reference, not a copy: the library's identifier and enough to draw it
 * without asking the library first (its address, its shape, when it was
 * taken), kept in one small file on this phone. No pixels, no file name,
 * no place. Nothing is uploaded and nothing is published. If the
 * photograph leaves the library, or falls outside a limited selection,
 * the reference is shown as gone and can be removed.
 *
 * The shelf lives in Documents rather than the cache folder: it is the
 * member's own choosing, and iOS emptying the cache must not empty it.
 * It holds 500. Past that it refuses, and says so, rather than quietly
 * letting the oldest go — a bench, not an archive, and never a loss the
 * member did not choose.
 */

const FILE = "darkroom-set-aside.json";
const KEY = "vintage.darkroom-set-aside";
export const SET_ASIDE_LIMIT = 500;

export interface SetAsidePrint extends Print {
  setAsideAt: number;
}

/** The stored list, newest first, with anything that does not fit, or repeats, left out. */
export function parseSetAside(raw: unknown): SetAsidePrint[] | null {
  if (!Array.isArray(raw)) return null;
  const out: SetAsidePrint[] = [];
  const ids = new Set<string>();
  for (const v of raw) {
    if (!v || typeof v !== "object") continue;
    const r = v as Record<string, unknown>;
    const num = (x: unknown) => (typeof x === "number" && Number.isFinite(x) ? x : null);
    const id = typeof r.id === "string" && r.id ? r.id : null;
    const uri = typeof r.uri === "string" || typeof r.uri === "number" ? r.uri : null;
    const width = num(r.width);
    const height = num(r.height);
    const takenAt = num(r.takenAt);
    const setAsideAt = num(r.setAsideAt);
    if (!id || uri == null || width == null || height == null || takenAt == null || setAsideAt == null) continue;
    if (ids.has(id)) continue;
    ids.add(id);
    out.push({ id, uri, width, height, takenAt, setAsideAt, subtypes: [] });
  }
  return out.sort((a, b) => b.setAsideAt - a.setAsideAt).slice(0, SET_ASIDE_LIMIT);
}

let prints: SetAsidePrint[] | null = null;
let ids = new Set<string>();
/** How many were let go because the library no longer has them, not yet said. */
let pruned = 0;
const listeners = new Set<() => void>();
/**
 * Shut by `forgetDarkroom` until a member is next signed in: a room still
 * open when the session ended may still set aside and put back on screen,
 * but the file is not written, and `reopenSetAside` lets it all go.
 */
let sealed = false;

function load(): SetAsidePrint[] {
  if (!prints) {
    prints = readDiskCache(FILE, KEY, parseSetAside) ?? [];
    ids = new Set(prints.map((p) => p.id));
  }
  return prints;
}

function changed(next: SetAsidePrint[]): void {
  prints = next;
  ids = new Set(next.map((p) => p.id));
  for (const l of listeners) l();
}

/** Written at once on every change: the shelf is the member's, and an app kill must not lose a choice. */
function save(next: SetAsidePrint[]): void {
  if (!sealed) {
    writeDiskCache(
      FILE,
      KEY,
      next.map(({ id, uri, width, height, takenAt, setAsideAt }) => ({ id, uri, width, height, takenAt, setAsideAt })),
    );
  }
  changed(next);
}

/** Newest set aside first. */
export function setAsidePrints(): readonly SetAsidePrint[] {
  return load();
}

export function isSetAside(id: string): boolean {
  load();
  return ids.has(id);
}

/**
 * Set aside, or put back. "full" when the shelf already holds 500 and
 * this one is not on it: nothing changes, and the room says why.
 */
export function toggleSetAside(print: Print, at = Date.now()): "on" | "off" | "full" {
  const list = load();
  if (ids.has(print.id)) {
    putBack(print.id);
    return "off";
  }
  if (list.length >= SET_ASIDE_LIMIT) return "full";
  // Only what the file keeps: no subtypes, and never the file name.
  const kept: SetAsidePrint = {
    id: print.id,
    uri: print.uri,
    width: print.width,
    height: print.height,
    takenAt: print.takenAt,
    subtypes: [],
    setAsideAt: at,
  };
  save([kept, ...list]);
  return "on";
}

export function putBack(id: string): void {
  load();
  if (!ids.has(id)) return;
  save(load().filter((p) => p.id !== id));
}

/**
 * Let go of references the library no longer resolves, and keep a note
 * of how many, for the contents page to say once. Returns how many went.
 */
export function pruneSetAside(missingIds: readonly string[]): number {
  if (missingIds.length === 0) return 0;
  const missing = new Set(missingIds);
  const list = load();
  const next = list.filter((p) => !missing.has(p.id));
  const gone = list.length - next.length;
  if (gone > 0) {
    save(next);
    pruned += gone;
  }
  return gone;
}

/** How many were let go since this was last asked, said once: the count, then 0. */
export function takePrunedNote(): number {
  const n = pruned;
  pruned = 0;
  return n;
}

/** The shelf emptied and its file deleted — at sign-out, so the next member finds none of it. */
export function forgetSetAside(): void {
  deleteDiskCache(FILE, KEY);
  pruned = 0;
  changed([]);
}

/** No more writes of the shelf, until `reopenSetAside`. */
export function sealSetAside(): void {
  sealed = true;
}

/**
 * A member is signed in again after a seal: anything set aside while it
 * was shut was the leaving member's, so it goes, and the shelf on screen
 * is read again from the file. Without a seal nothing changes.
 */
export function reopenSetAside(): void {
  if (!sealed) return;
  sealed = false;
  pruned = 0;
  prints = null;
  ids = new Set();
  for (const l of listeners) l();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The set-aside prints, kept current on screen. */
export function useSetAside(): readonly SetAsidePrint[] {
  return useSyncExternalStore(subscribe, load, load);
}
