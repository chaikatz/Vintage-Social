import { useSyncExternalStore } from "react";
import { readDiskCache, writeDiskCache } from "@/utils/diskCache";
import type { Print } from "./types";

/**
 * Photographs set aside to come back to — the prints a member leaves on
 * the side of the bench to decide on later.
 *
 * A reference, not a copy: the library's identifier and enough to draw it
 * (its address, its shape, its date), kept in one small file on this
 * phone. Nothing is uploaded and nothing is published. If the photograph
 * leaves the library, or falls outside a limited selection, the reference
 * is simply shown as gone and can be put back.
 */

const FILE = "darkroom-set-aside.json";
const KEY = "vintage.darkroom-set-aside";
/** Past this the oldest reference is let go: a bench, not an archive. */
export const SET_ASIDE_LIMIT = 500;

export interface SetAsidePrint extends Print {
  setAsideAt: number;
}

export function parseSetAside(raw: unknown): SetAsidePrint[] | null {
  if (!Array.isArray(raw)) return null;
  const out: SetAsidePrint[] = [];
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
    out.push({ id, uri, width, height, takenAt, setAsideAt, subtypes: [] });
  }
  return out;
}

let prints: SetAsidePrint[] | null = null;
const listeners = new Set<() => void>();

function load(): SetAsidePrint[] {
  if (!prints) prints = readDiskCache(FILE, KEY, parseSetAside) ?? [];
  return prints;
}

function save(next: SetAsidePrint[]): void {
  prints = next;
  writeDiskCache(
    FILE,
    KEY,
    next.map(({ id, uri, width, height, takenAt, setAsideAt }) => ({ id, uri, width, height, takenAt, setAsideAt })),
  );
  for (const l of listeners) l();
}

/** Newest set aside first. */
export function setAsidePrints(): readonly SetAsidePrint[] {
  return load();
}

export function isSetAside(id: string): boolean {
  return load().some((p) => p.id === id);
}

export function setAside(print: Print, at = Date.now()): void {
  const rest = load().filter((p) => p.id !== print.id);
  save([{ ...print, subtypes: [], setAsideAt: at }, ...rest].slice(0, SET_ASIDE_LIMIT));
}

export function putBack(id: string): void {
  const list = load();
  if (!list.some((p) => p.id === id)) return;
  save(list.filter((p) => p.id !== id));
}

/** Set aside, or put back. Returns whether it is now set aside. */
export function toggleSetAside(print: Print): boolean {
  if (isSetAside(print.id)) {
    putBack(print.id);
    return false;
  }
  setAside(print);
  return true;
}

export function forgetSetAside(): void {
  save([]);
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The set-aside prints, kept current on screen. */
export function useSetAside(): readonly SetAsidePrint[] {
  return useSyncExternalStore(subscribe, load, load);
}
