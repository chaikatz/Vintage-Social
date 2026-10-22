import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, Platform } from "react-native";
import * as MediaLibrary from "expo-media-library";
import { onThisDay, Surprise, YearChapter, yearIndex, type YearCount } from "./discovery";
import { readAccess, requestAccess, type LibraryAccess } from "./access";
import { developedRecently, markSeen, seenRecently } from "./history";
import { isSetAside, setAsidePrints } from "./setAside";
import { keepPlace, recallPlace } from "./session";
import { darkroomSource } from "./source";
import type { DarkroomMode, DayReach, LibrarySource, Print } from "./types";

/**
 * The Darkroom's state: whether it may look, what the library holds by
 * year, which way in is open, and the sequence of prints in front of the
 * member — extended a few at a time as they reach the end of it, never
 * all at once.
 */

/** Read this many more when the member is this close to the end. */
const BATCH = { surprise: 6, year: 12 } as const;
export const READ_AHEAD = 3;
/** A print looked at for this long counts as seen. */
const SEEN_AFTER_MS = 800;
/** On This Day opens the Darkroom when the day itself holds at least this many. */
export const ON_THIS_DAY_OPENS_WITH = 3;

let yearsCache: { at: number; years: YearCount[] } | null = null;
const YEARS_FRESH_MS = 10 * 60_000;

async function years(source: LibrarySource, refresh = false): Promise<YearCount[]> {
  if (!refresh && yearsCache && Date.now() - yearsCache.at < YEARS_FRESH_MS) return yearsCache.years;
  const y = await yearIndex(source);
  yearsCache = { at: Date.now(), years: y };
  return y;
}

/** For the Post tab's entry line: how far back the library goes, from what is already known. */
export function knownYears(): YearCount[] | null {
  return yearsCache?.years ?? null;
}

export async function libraryYears(): Promise<YearCount[]> {
  const source = darkroomSource();
  if (!source) return [];
  try {
    return await years(source);
  } catch {
    return [];
  }
}

export type SequenceState = "idle" | "loading" | "ready" | "empty" | "failed";

export interface DarkroomState {
  access: LibraryAccess | "checking";
  years: YearCount[];
  mode: DarkroomMode;
  year: number | null;
  /** By year: the month the chapter was opened at. */
  month: number;
  prints: Print[];
  /** Whether On This Day holds anything, once it has been asked. */
  dayHas: boolean | null;
  /** On This Day only: how far it had to reach. */
  reach: DayReach | null;
  sequence: SequenceState;
  /** More can be read past the end of `prints`. */
  more: boolean;
  index: number;
  /** Restored from the last visit rather than started fresh. */
  restored: boolean;
}

export function useDarkroom(initial: { mode?: DarkroomMode; year?: number | null; startId?: string | null }) {
  const source = darkroomSource();
  // Read once: the place from the last visit, unless this visit was opened onto a particular way in.
  const place = useRef(initial.mode ? null : recallPlace()).current;
  const [state, setState] = useState<DarkroomState>(() => {
    return {
      access: "checking",
      years: [],
      mode: place?.mode ?? initial.mode ?? "on-this-day",
      year: place?.year ?? initial.year ?? null,
      month: 0,
      prints: place?.prints ?? [],
      dayHas: null,
      reach: null,
      sequence: place ? "ready" : "idle",
      more: place ? true : false,
      index: place?.index ?? 0,
      restored: Boolean(place),
    };
  });
  const reader = useRef<Surprise | YearChapter | null>((place?.reader as Surprise | YearChapter | null) ?? null);
  const reading = useRef(false);
  const generation = useRef(0);
  const live = useRef(true);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);

  const patch = useCallback((p: Partial<DarkroomState>) => {
    if (live.current) setState((s) => ({ ...s, ...p }));
  }, []);

  // --- access -------------------------------------------------------------
  const checkAccess = useCallback(async () => {
    const access = await readAccess();
    patch({ access });
    return access;
  }, [patch]);

  const ask = useCallback(async () => {
    const access = await requestAccess();
    patch({ access });
    return access;
  }, [patch]);

  // --- opening a way in ---------------------------------------------------
  const open = useCallback(
    async (
      mode: DarkroomMode,
      year: number | null = null,
      opts: { startId?: string | null; refreshYears?: boolean; month?: number } = {},
    ) => {
      if (!source) return;
      const gen = ++generation.current;
      reader.current = null;
      const month = opts.month ?? 0;
      patch({ mode, year, month, prints: [], index: 0, sequence: "loading", more: false, reach: null, restored: false });
      try {
        const y = await years(source, opts.refreshYears);
        if (gen !== generation.current) return;
        patch({ years: y });
        let prints: Print[] = [];
        let more = false;
        let reach: DayReach | null = null;
        let chosen = mode;
        let chosenYear = year;
        if (mode === "set-aside") {
          prints = [...setAsidePrints()];
        } else if (mode === "on-this-day") {
          const day = await onThisDay(source, y);
          prints = day.prints;
          reach = day.reach;
          patch({ dayHas: day.prints.length > 0 });
        } else if (mode === "year") {
          chosenYear = year ?? y[0]?.year ?? null;
          if (chosenYear != null) {
            const chapter = new YearChapter(source, chosenYear, 200, month);
            reader.current = chapter;
            prints = await chapter.next(BATCH.year);
            more = !chapter.done;
          }
        } else {
          const surprise = new Surprise(source, y, {
            seed: (Date.now() ^ 0x5bd1e995) >>> 0,
            // Seen lately, posted this year, or already on the bench: the member knows where those are.
            skip: (id) => seenRecently(id) || developedRecently(id) || isSetAside(id),
          });
          reader.current = surprise;
          prints = await surprise.next(BATCH.surprise);
          more = !surprise.exhausted;
          chosen = "surprise";
        }
        if (gen !== generation.current) return;
        const start = opts.startId ? Math.max(0, prints.findIndex((p) => p.id === opts.startId)) : 0;
        patch({
          mode: chosen,
          year: chosenYear,
          prints,
          reach,
          more,
          index: start,
          sequence: prints.length > 0 ? "ready" : "empty",
        });
      } catch {
        if (gen === generation.current) patch({ sequence: "failed" });
      }
    },
    [source, patch],
  );

  /**
   * The first way in: On This Day when the day itself holds enough to
   * stand on, otherwise Surprise — both lean on the old.
   */
  const openDefault = useCallback(async () => {
    if (!source) return;
    const gen = ++generation.current;
    patch({ sequence: "loading" });
    try {
      const y = await years(source);
      if (gen !== generation.current) return;
      const day = await onThisDay(source, y);
      if (gen !== generation.current) return;
      patch({ dayHas: day.prints.length > 0 });
      if (day.reach === "day" && day.prints.length >= ON_THIS_DAY_OPENS_WITH) {
        reader.current = null;
        patch({ years: y, mode: "on-this-day", year: null, prints: day.prints, reach: day.reach, more: false, index: 0, sequence: "ready" });
        return;
      }
      patch({ years: y });
      await open("surprise");
    } catch {
      if (gen === generation.current) patch({ sequence: "failed" });
    }
  }, [source, patch, open]);

  // --- reading on ---------------------------------------------------------
  const readMore = useCallback(async () => {
    const r = reader.current;
    if (!r || reading.current) return;
    reading.current = true;
    const gen = generation.current;
    try {
      const batch = r instanceof Surprise ? await r.next(BATCH.surprise) : await r.next(BATCH.year);
      if (gen !== generation.current || !live.current) return;
      const done = r instanceof Surprise ? r.exhausted : r.done;
      setState((s) => {
        const ids = new Set(s.prints.map((p) => p.id));
        return { ...s, prints: [...s.prints, ...batch.filter((p) => !ids.has(p.id))], more: !done && batch.length > 0 };
      });
    } catch {
      if (gen === generation.current) patch({ more: false });
    } finally {
      reading.current = false;
    }
  }, [patch]);

  const setIndex = useCallback((index: number) => {
    setState((s) => (s.index === index ? s : { ...s, index }));
  }, []);

  // Close to the end: read on.
  useEffect(() => {
    if (state.sequence === "ready" && state.more && state.index >= state.prints.length - READ_AHEAD) readMore();
  }, [state.index, state.prints.length, state.more, state.sequence, readMore]);

  // Looked at long enough: seen. Only for the ways in that choose for the
  // member — a year read in order, or the bench, is browsed on purpose.
  const current = state.prints[state.index];
  useEffect(() => {
    if (!current || state.mode === "set-aside") return;
    const t = setTimeout(() => markSeen(current.id), SEEN_AFTER_MS);
    return () => clearTimeout(t);
  }, [current, state.mode]);

  // Keep the place, for coming back within the half hour.
  useEffect(() => {
    if (state.sequence !== "ready") return;
    keepPlace({ mode: state.mode, year: state.year, prints: state.prints, index: state.index, reader: reader.current });
  }, [state.sequence, state.mode, state.year, state.prints, state.index]);

  // --- the library changing underneath ------------------------------------
  // A limited selection changed, a photograph deleted, access given in
  // Settings: re-read access when the app comes back, and the year index
  // when Photos says the library changed. The sequence on screen is left
  // as it is — a print that has gone is shown as gone, not yanked away.
  useEffect(() => {
    if (Platform.OS === "web") return;
    const app = AppState.addEventListener("change", (s) => {
      if (s === "active") checkAccess();
    });
    let library: { remove: () => void } | null = null;
    try {
      library = MediaLibrary.addListener(() => {
        yearsCache = null;
        checkAccess();
      });
    } catch {
      library = null;
    }
    return () => {
      app.remove();
      library?.remove();
    };
  }, [checkAccess]);

  return { state, source, checkAccess, ask, open, openDefault, readMore, setIndex };
}
