import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppState, Platform } from "react-native";
import * as MediaLibrary from "expo-media-library";
import {
  choiceOf,
  dayStateOf,
  DEFAULT_DAY_MINIMUM,
  dropOnSettle,
  endingOf,
  JUMP_HALF_MS,
  opensOnThisDay,
  pageAmong,
  placeIndex,
  startIndex,
  type Chapter,
  type Loading,
  type OpenSpec,
  type RoomView,
  type Where,
} from "@/components/darkroom/chapter";
import { appendNew, Dealer, editReader, surpriseReader } from "@/components/darkroom/dealer";
import { Visit } from "@/components/darkroom/visit";
import type { DayState, EmptyWhy } from "@/components/darkroom/words";
import { readAccess, requestAccess, type LibraryAccess } from "./access";
import { REDISCOVERY_AGE_DAYS, type YearCount } from "./discovery";
import { dayFinished, finishDay, flushHistory, localDay, markSeen } from "./history";
import {
  chapterKey,
  flushPlace,
  introSeen,
  keepChapter,
  markIntroSeen,
  readPlace,
  recallChapter,
  savePlace,
  type ChapterKey,
  type SavedPlace,
} from "./session";
import { isSetAside, pruneSetAside, setAsidePrints } from "./setAside";
import { darkroomSource } from "./source";
import type { DarkroomMode, DayReach, Print } from "./types";

/**
 * The Darkroom's state: whether it may look, which chapter is open and
 * the prints dealt into it, where the member is among them, and what the
 * library holds by year — kept as the member moves through it, and kept
 * again when they leave.
 *
 * The first way in (§4.2). A place saved under twelve hours ago is taken
 * up exactly, with no title card. Otherwise the day itself is asked of
 * every earlier year, and at the same moment Surprise begins its cold
 * start; On this day opens when the day holds three moments and was not
 * already seen to its end today, and Surprise — already dealing — opens
 * when not. By year is never the first way in.
 *
 * Chapters. Each keeps its own position in memory (`keepChapter`), with
 * the dealer that was dealing it, so going back to a chapter finds the
 * same print and the deal carrying on; a batch that lands after the room
 * has turned away goes into that kept position rather than nowhere (see
 * `dealer.ts`). The chapter last open also goes to disk, through
 * `savePlace` and `flushPlace`, on blur and whenever the app stops being
 * active.
 *
 * Restoring from disk rebuilds what a file cannot hold (§10.8): Surprise
 * deals on with a new seed, the deck's prints excluded and counted toward
 * the roll; a year builds its edit again and carries on after the deck;
 * On this day shows the deck and asks the day again in the background,
 * to learn how far it reached. In every case the year index is read again
 * after the first print, and a chapter that can deal no further ends on
 * its end page: nothing waits on a reader that does not exist.
 *
 * Sequences only ever grow at the end. The exception is a print that has
 * left the chapter — put back from the shelf, or gone from the library —
 * which is taken out once the member has turned past it, with the pager
 * told to keep its place (`rebase`).
 *
 * Everything is read on the phone. Nothing here is sent anywhere.
 */

/** Dealt at a time, and kept at least this far ahead of the member. */
const BATCH = { surprise: 3, year: 12 } as const;
const AHEAD = { surprise: 3, year: 4 } as const;
/** A print settled on, with its image drawn, for this long counts as seen. */
export const SEEN_AFTER_MS = 1200;
/** Photos reports a change, then often several more: they are taken together after this. */
export const LIBRARY_SETTLE_MS = 2000;
const DAY_MS = 86_400_000;
/** A pinned print is looked for through at most this many batches of its year. */
const PIN_SEARCH = 12;

export interface DarkroomState {
  access: LibraryAccess | "checking";
  view: RoomView;
  where: Where | null;
  chapter: Chapter | null;
  loading: Loading | null;
  /** The year index, oldest first; null until it has been read. */
  years: YearCount[] | null;
  /** One year's twelve month counts, for Contents. */
  months: { year: number; counts: number[] } | null;
  /** What On this day holds today, for Contents. */
  day: DayState;
  /** Prints known to be gone from the library, or from the shared selection. */
  missing: ReadonlySet<string>;
  /** Bumped when the library changes, so a page that failed to draw tries again. */
  revision: number;
}

export interface RoomParams {
  mode?: DarkroomMode | null;
  year?: number | null;
  month?: number | null;
  /** An asset id to open at. */
  start?: string | null;
}

const isGranted = (a: LibraryAccess | "checking") => a === "full" || a === "limited";

export function useDarkroom(params: RoomParams) {
  const source = useMemo(() => darkroomSource(), []);
  const visit = useMemo(() => (source ? new Visit(source) : null), [source]);
  const [state, setState] = useState<DarkroomState>(() => ({
    access: "checking",
    view: { kind: "checking" },
    where: null,
    chapter: null,
    loading: null,
    years: visit?.freshYears() ?? null,
    months: null,
    day: "unknown",
    missing: new Set(),
    revision: 0,
  }));
  /** The state as of the last change, for callbacks that outlive a render. */
  const live = useRef(state);
  live.current = state;
  const initial = useRef(params).current;

  const mounted = useRef(true);
  const focused = useRef(true);
  /** The dealer of the chapter on the stage. */
  const dealer = useRef<Dealer | null>(null);
  /** Every open's number; an open overtaken by another keeps what it dealt rather than showing it. */
  const opening = useRef(0);
  const pagerGeneration = useRef(0);
  const started = useRef(false);
  /** The first-visit word has been said and iOS asked, and the room has not yet gone in. */
  const asking = useRef(false);
  const afterFirst = useRef(false);
  /** Prints whose full image has drawn this visit. */
  const loaded = useRef(new Set<string>());
  const [loadTick, setLoadTick] = useState(0);

  const patch = useCallback((p: Partial<DarkroomState> | ((s: DarkroomState) => Partial<DarkroomState>)) => {
    if (!mounted.current) return;
    setState((s) => ({ ...s, ...(typeof p === "function" ? p(s) : p) }));
  }, []);

  /** Changes `live` at once as well, for the callbacks that read it before the next render. */
  const commit = useCallback(
    (p: Partial<DarkroomState>) => {
      live.current = { ...live.current, ...p };
      patch(p);
    },
    [patch],
  );

  // --- reading on ------------------------------------------------------------

  /** Reads of the year index under way. */
  const yearsReading = useRef(0);

  /**
   * A first deal too short to decide on: nothing at all, or — under
   * limited access, from a cold start that cannot yet say whether it has
   * run out — fewer than a few. Either way the year index is read before
   * the room settles on the prints, the empty page, or "only a few".
   */
  const shortOfPrints = (dealt: number, cold: boolean) =>
    dealt === 0 || (cold && live.current.access === "limited" && dealt < DEFAULT_DAY_MINIMUM);

  /**
   * A roll that has run dry before it was given the year index, while the
   * index is being read, has only run out of its cold start (§10.5.9): it
   * waits for the years rather than ending, so neither the end of the
   * roll nor the exhausted page is shown on a guess.
   */
  const waitingForYears = useCallback(
    (d: Dealer | null) =>
      d != null &&
      d.key === chapterKey("surprise", null, 0) &&
      yearsReading.current > 0 &&
      !d.hasYears &&
      !d.failed &&
      d.reader?.ending !== "roll",
    [],
  );

  /**
   * The roll on the stage, told again whether it deals on: the year index
   * is being read, or has been, and a roll stalled for want of it may now
   * draw from it. A read that failed keeps its TRY AGAIN.
   */
  const reconsiderRoll = useCallback(() => {
    const d = dealer.current;
    if (!d) return;
    const more = d.more || waitingForYears(d);
    patch((s) => {
      const c = s.chapter;
      return c && c.key === d.key && c.mode === "surprise" && !c.failed && c.more !== more ? { chapter: { ...c, more } } : {};
    });
  }, [patch, waitingForYears]);

  const loadYears = useCallback(
    async (force = false): Promise<YearCount[] | null> => {
      if (!visit) return null;
      yearsReading.current += 1;
      reconsiderRoll();
      try {
        const years = await visit.years(force);
        if (live.current.years !== years) patch({ years });
        return years;
      } catch {
        return null;
      } finally {
        // Every roll has been given the years by now, or the read failed: either way the roll says how it ends.
        yearsReading.current -= 1;
        reconsiderRoll();
      }
    },
    [visit, patch, reconsiderRoll],
  );

  const loadMonths = useCallback(
    async (year: number) => {
      if (!visit) return;
      try {
        const counts = await visit.months(year);
        patch({ months: { year, counts } });
      } catch {
        // Contents shows no month strip until it can.
      }
    },
    [visit, patch],
  );

  const askDay = useCallback(async () => {
    if (!visit) throw new Error("No library");
    const result = await visit.askDay();
    patch({ day: dayStateOf(result) });
    return result;
  }, [visit, patch]);

  /** Batches for the chapter on the stage. */
  const listen = useCallback(
    (d: Dealer) => {
      d.listener = (batch, more, failed) => {
        const held = !failed && !more && waitingForYears(d);
        // The member outran the deal and waited on the trailing page: the
        // first print of the batch lands in front of them, which is shown.
        const c0 = live.current.chapter;
        if (c0 && c0.key === d.key && c0.index >= c0.prints.length) {
          const landed = appendNew(c0.prints, batch)[c0.index];
          if (landed) visit?.record(landed);
        }
        patch((s) => {
          const c = s.chapter;
          if (!c || c.key !== d.key) return {};
          // ANOTHER ROLL waits on its first batch with the stage faded.
          const loading = s.loading?.jump && s.loading.mode === c.mode && s.where?.mode === c.mode ? null : s.loading;
          const prints = appendNew(c.prints, batch);
          const next = more || held;
          // An empty batch that changes nothing leaves the chapter as it is:
          // the dealer asks again in its own time, rather than at once.
          if (batch.length === 0 && next === c.more && failed === c.failed && loading === s.loading) return {};
          return { chapter: { ...c, prints, more: next, failed }, loading };
        });
      };
    },
    [patch, visit, waitingForYears],
  );

  // --- keeping the place -------------------------------------------------------

  /** The chapter on the stage, kept in memory with its dealer. */
  const keepShown = useCallback((leaving: boolean) => {
    const c = live.current.chapter;
    if (!c || live.current.view.kind !== "prints") return;
    const d = dealer.current;
    // An open under way has already kept this chapter, with its dealer, and
    // let go of it; keeping it again now would keep it without one.
    if (!d && live.current.loading) return;
    let index = c.index;
    // Left from under the editor: a post may have moved the kept position
    // on past the print it was developed from (`advancePlace`), and the
    // room, which could not move meanwhile, must not move it back.
    if (leaving && !focused.current) {
      const kept = recallChapter(c.key);
      if (kept && kept.reader === d) index = kept.index;
    }
    keepChapter(c.key, { prints: c.prints, index, reader: d, more: d ? d.more : c.more, reach: c.reach });
  }, []);

  const savePlaceNow = useCallback(() => {
    const c = live.current.chapter;
    if (!c || live.current.view.kind !== "prints") return;
    savePlace({ mode: c.mode, year: c.year, month: c.month, index: c.index, prints: c.prints });
  }, []);

  const putAway = useCallback(() => {
    keepShown(false);
    savePlaceNow();
    flushPlace();
    flushHistory();
  }, [keepShown, savePlaceNow]);

  // --- showing -----------------------------------------------------------------

  /** Reads that wait for the first print: the year index, the whole day, the open year's months. */
  const afterFirstPrint = useCallback(() => {
    if (afterFirst.current || !visit) return;
    afterFirst.current = true;
    setTimeout(() => {
      if (!mounted.current) return;
      void loadYears();
      if (!visit.knownDay()) {
        askDay()
          .then((result) => {
            if (!mounted.current) return;
            // A deck restored from disk without its reach learns it now, and
            // takes back the day's prints from before the twenty it kept,
            // with the member left on the same print (§10.8): those are put
            // in ahead of the member, so the pager is told to keep its place.
            const key = chapterKey("on-this-day", null, 0);
            const c = live.current.chapter;
            if (c?.key === key && c.reach == null) {
              const index = pageAmong(result.prints, c.prints, c.index);
              commit({
                chapter:
                  index == null
                    ? { ...c, reach: result.reach }
                    : { ...c, prints: result.prints, index, reach: result.reach, rebase: c.rebase + 1 },
              });
            }
            // Kept already, as the member chose another chapter: the kept position is put right too.
            const kept = recallChapter(key);
            if (kept && kept.reach == null) {
              const index = pageAmong(result.prints, kept.prints, kept.index);
              if (index != null) keepChapter(key, { ...kept, prints: result.prints, index, reach: result.reach });
            }
          })
          .catch(() => undefined);
      }
      const c = live.current.chapter;
      if (c?.mode === "year" && c.year != null) void loadMonths(c.year);
    }, 0);
  }, [visit, loadYears, askDay, commit, loadMonths]);

  const show = useCallback(
    (c: Omit<Chapter, "generation" | "rebase" | "failed">, d: Dealer | null) => {
      if (dealer.current && dealer.current !== d) dealer.current.release();
      dealer.current = d;
      if (d) listen(d);
      // A roll kept from an earlier room is told the years by this one.
      if (d && c.mode === "surprise") visit?.adopt(d, live.current.years);
      pagerGeneration.current += 1;
      const more = c.more || (c.mode === "surprise" && waitingForYears(d));
      const chapter: Chapter = { ...c, more, failed: false, generation: pagerGeneration.current, rebase: 0 };
      commit({ chapter, view: { kind: "prints" }, where: { mode: c.mode, year: c.year, month: c.month }, loading: null });
      // The print a chapter opens on is shown without a settle, and counts as shown (MORE FROM leaves it out).
      const first = c.prints[c.index];
      if (first) visit?.record(first);
      savePlace({ mode: c.mode, year: c.year, month: c.month, index: c.index, prints: c.prints });
      afterFirstPrint();
    },
    [listen, commit, afterFirstPrint, waitingForYears, visit],
  );

  const showEmpty = useCallback(
    (why: EmptyWhy, where: Where | null) => {
      dealer.current?.release();
      dealer.current = null;
      commit({ view: { kind: "empty", why }, where, chapter: null, loading: null });
    },
    [commit],
  );

  /**
   * Something dealt for a chapter that is no longer the one being opened
   * is kept for when it is — unless that chapter has since been opened,
   * or kept, another way, whose position must stand.
   */
  const keepAside = useCallback(
    (key: ChapterKey, prints: Print[], d: Dealer | null, reach: DayReach | null) => {
      if (prints.length === 0 || live.current.chapter?.key === key || recallChapter(key)) {
        if (d) visit?.drop(d);
        return;
      }
      d?.release();
      keepChapter(key, { prints, index: 0, reader: d, more: d ? d.more : false, reach });
    },
    [visit],
  );

  // --- the shelf, let go of where the library no longer has it (§7.6) -----------

  const pruneShelf = useCallback(async () => {
    if (!visit || live.current.access !== "full") return;
    const c = live.current.chapter;
    const gone = await visit.goneFromShelf(c?.mode === "set-aside" ? { prints: c.prints, index: c.index } : null);
    if (gone.length === 0 || !mounted.current) return;
    pruneSetAside(gone);
    patch((s) => ({ missing: new Set([...s.missing, ...gone]) }));
  }, [visit, patch]);

  // --- opening a chapter --------------------------------------------------------

  /** The Set aside chapter, most recently set aside first; at its end page when that is where the member left it. */
  const openShelf = useCallback(
    (key: ChapterKey, where: Where, at: (shelf: Print[]) => number) => {
      const shelf = [...setAsidePrints()];
      if (shelf.length === 0) return showEmpty("shelf", where);
      show({ key, ...where, prints: shelf, index: Math.max(0, Math.min(at(shelf), shelf.length)), more: false, reach: null }, null);
      void pruneShelf();
    },
    [show, showEmpty, pruneShelf],
  );

  const open = useCallback(
    async (spec: OpenSpec) => {
      if (!visit) return;
      const ticket = ++opening.current;
      const still = () => ticket === opening.current && mounted.current;
      const key = chapterKey(spec.mode, spec.year, spec.month);
      const where: Where = { mode: spec.mode, year: spec.year, month: spec.month };
      if (live.current.view.kind === "prints") {
        keepShown(false);
        dealer.current?.release();
        dealer.current = null;
      }
      commit({ loading: { mode: spec.mode, year: spec.year, month: spec.month, since: Date.now(), jump: Boolean(spec.jump) } });

      // Back to a chapter already visited: the same prints, the same deal.
      const anew = spec.fresh || spec.pin || spec.shifted;
      if (!anew && spec.jump && recallChapter(key)) {
        // Ready at once, but a jump still fades: out first, then the chapter.
        await new Promise((r) => setTimeout(r, JUMP_HALF_MS));
        if (!still()) return;
      }
      const kept = anew ? null : recallChapter(key);
      if (kept) {
        if (spec.mode === "set-aside") {
          const id = kept.prints[kept.index]?.id;
          return openShelf(key, where, (shelf) => {
            const i = id ? shelf.findIndex((p) => p.id === id) : -1;
            return i >= 0 ? i : kept.index;
          });
        }
        const d = kept.reader instanceof Dealer ? kept.reader : null;
        const at = spec.startId || spec.startYear != null ? startIndex(kept.prints, spec) : kept.index;
        show({ key, ...where, prints: kept.prints, index: at, more: d ? d.more : kept.more, reach: kept.reach }, d);
        return;
      }

      try {
        if (spec.mode === "set-aside") return openShelf(key, where, (shelf) => startIndex(shelf, spec));

        if (spec.mode === "on-this-day") {
          const day = await askDay();
          if (!still()) return keepAside(key, day.prints, null, day.reach);
          if (day.prints.length === 0) return showEmpty("day", where);
          show({ key, ...where, prints: day.prints, index: startIndex(day.prints, spec), more: false, reach: day.reach }, null);
          return;
        }

        if (spec.mode === "surprise") {
          const first = await visit.oldest();
          if (!still()) return;
          if (first == null) return showEmpty(live.current.access === "limited" ? "selection" : "library", null);
          const s = visit.surprise(first, { exclude: spec.keep ? [spec.keep.id] : [] });
          const d = visit.surpriseDealer(key, surpriseReader(s));
          const cold = !d.hasYears;
          let prints = await s.next(BATCH.surprise);
          if (shortOfPrints(prints.length, cold) && !s.rollDone && (!s.exhausted || cold)) {
            // Nowhere yet to draw from, or only a cold start run dry: the year index, then again.
            const years = await loadYears();
            if (years) d.setYears(years);
            prints = appendNew(prints, await s.next(BATCH.surprise - prints.length));
          }
          const all = spec.keep ? [spec.keep, ...prints] : prints;
          if (!still()) return keepAside(key, all, d, null);
          const few = live.current.access === "limited" && s.exhausted && all.length < DEFAULT_DAY_MINIMUM;
          if (all.length === 0 || few) {
            visit.drop(d);
            return showEmpty(live.current.access === "limited" ? "few" : "exhausted", where);
          }
          show({ key, ...where, prints: all, index: 0, more: d.more, reach: null }, d);
          return;
        }

        // By year.
        const year = spec.year ?? new Date().getFullYear();
        const months = await visit.months(year);
        if (!still()) return;
        patch({ months: { year, counts: months } });
        const pin = spec.pin ?? spec.keep ?? null;
        const edit = visit.edit(year, months, { fromMonth: spec.month, pin, shifted: spec.shifted });
        const d = visit.editDealer(key, editReader(edit));
        let prints = await edit.next(BATCH.year);
        for (let i = 0; pin && i < PIN_SEARCH && !prints.some((p) => p.id === pin.id) && !edit.done; i++) {
          prints = appendNew(prints, await edit.next(BATCH.year));
        }
        if (!still()) return keepAside(key, prints, d, null);
        const at = startIndex(prints, pin ? { startId: pin.id } : spec);
        show({ key, ...where, year, prints, index: at, more: d.more, reach: null }, d);
      } catch {
        if (still()) showEmpty("failed", where);
      }
    },
    [visit, commit, patch, keepShown, openShelf, show, showEmpty, keepAside, askDay, loadYears],
  );

  /**
   * The first way in (§4.2): the day itself, and Surprise's cold start,
   * asked together. The rule decides as soon as the day answers.
   */
  const openDefault = useCallback(async () => {
    if (!visit) return;
    const ticket = ++opening.current;
    const still = () => ticket === opening.current && mounted.current;
    const now = Date.now();
    commit({ loading: { mode: null, year: null, month: 0, since: now, jump: false } });
    try {
      const first = await visit.oldest();
      if (!still()) return;
      if (first == null) return showEmpty(live.current.access === "limited" ? "selection" : "library", null);
      if (first > now - REDISCOVERY_AGE_DAYS * DAY_MS) return showEmpty("tooNew", null);

      const dayAsked = visit.askDayOnly(now);
      const surpriseKey = chapterKey("surprise", null, 0);
      const s = visit.surprise(first);
      const d = visit.surpriseDealer(surpriseKey, surpriseReader(s));
      const cold = !d.hasYears;
      const dealt = s.next(BATCH.surprise).catch(() => [] as Print[]);

      const day = await dayAsked;
      if (!still()) {
        void dealt.then((p) => keepAside(surpriseKey, p, d, null));
        return;
      }
      if (day) patch({ day: dayStateOf(day) });
      if (opensOnThisDay(day, dayFinished(), localDay(now))) {
        show({ key: chapterKey("on-this-day", null, 0), mode: "on-this-day", year: null, month: 0, prints: day!.prints, index: 0, more: false, reach: "day" }, null);
        // Surprise, already dealing, is kept for when Contents asks for it.
        void dealt.then((p) => keepAside(surpriseKey, p, d, null));
        return;
      }
      commit({ loading: { mode: "surprise", year: null, month: 0, since: now, jump: false } });
      let prints = await dealt;
      if (shortOfPrints(prints.length, cold) && !s.rollDone && (!s.exhausted || cold) && still()) {
        // The cold start found nothing: the year index, then again, before any verdict on the visit.
        const years = await loadYears();
        if (years) d.setYears(years);
        prints = appendNew(prints, await s.next(BATCH.surprise - prints.length));
      }
      if (!still()) return keepAside(surpriseKey, prints, d, null);
      const where: Where = { mode: "surprise", year: null, month: 0 };
      const few = live.current.access === "limited" && s.exhausted && prints.length < DEFAULT_DAY_MINIMUM;
      if (prints.length === 0 || few) {
        visit.drop(d);
        return showEmpty(live.current.access === "limited" ? "few" : "exhausted", where);
      }
      show({ key: surpriseKey, ...where, prints, index: 0, more: d.more, reach: null }, d);
    } catch {
      if (still()) showEmpty("failed", null);
    }
  }, [visit, commit, patch, showEmpty, show, keepAside, loadYears]);

  /** Back to where a visit within twelve hours left off, exactly, with no title card. */
  const restore = useCallback(
    (place: SavedPlace) => {
      if (!visit) return;
      const key = chapterKey(place.mode, place.year, place.month);
      const where: Where = { mode: place.mode, year: place.year, month: place.month };
      if (place.mode === "set-aside") return openShelf(key, where, (shelf) => placeIndex(shelf, place));
      const kept = recallChapter(key);
      const keptDealer = kept?.reader instanceof Dealer ? kept.reader : null;
      // The same run of the app: the chapter is still in memory, its dealer with it.
      if (kept && (keptDealer || place.mode === "on-this-day")) {
        const more = keptDealer ? keptDealer.more : kept.more;
        show({ key, ...where, prints: kept.prints, index: placeIndex(kept.prints, place), more, reach: kept.reach }, keptDealer);
        return;
      }
      const deck = place.deck;
      const index = placeIndex(deck, place);
      if (place.mode === "on-this-day") {
        show({ key, ...where, prints: deck, index, more: false, reach: null }, null);
        return;
      }
      const deckIds = deck.map((p) => p.id);
      if (place.mode === "surprise") {
        const reader = visit.oldest().then((first) => surpriseReader(visit.surprise(first, { exclude: deckIds, alreadyDealt: deck.length })));
        const d = visit.surpriseDealer(key, reader);
        show({ key, ...where, prints: deck, index, more: d.more, reach: null }, d);
        return;
      }
      const year = place.year ?? new Date(deck[0].takenAt).getFullYear();
      const last = deck[deck.length - 1];
      const reader = visit
        .months(year)
        .then((months) => editReader(visit.edit(year, months, { fromMonth: new Date(last.takenAt).getMonth(), exclude: deckIds })));
      const d = visit.editDealer(key, reader, (p) => p.takenAt > last.takenAt);
      show({ key, ...where, year, prints: deck, index, more: d.more, reach: null }, d);
    },
    [visit, openShelf, show],
  );

  /**
   * Into the room proper: the params given, or the place kept, or the
   * default rule. Once: the first-visit page's fade and iOS handing the
   * app back after its question can both come here. TRY AGAIN, and access
   * given from Settings, start it over on purpose.
   */
  const begin = useCallback(() => {
    asking.current = false;
    if (started.current) return;
    started.current = true;
    const mode = initial.mode ?? (initial.year != null ? "year" : null);
    if (mode) {
      void open({
        mode,
        year: mode === "year" ? initial.year ?? null : null,
        month: mode === "year" ? Math.max(0, Math.min(11, initial.month ?? 0)) : 0,
        startId: initial.start ?? null,
        startYear: mode === "on-this-day" ? initial.year ?? null : null,
        fresh: Boolean(initial.start),
      });
      return;
    }
    const place = readPlace();
    if (place) restore(place);
    else void openDefault();
  }, [initial, open, restore, openDefault]);

  // --- access ----------------------------------------------------------------

  /** Puts up the page access calls for; with access and the first visit passed, goes in. */
  const settleAccess = useCallback(
    (access: LibraryAccess) => {
      if (!mounted.current) return;
      commit({ access });
      if (access === "undetermined") return commit({ view: { kind: "firstVisit", access: "undetermined" } });
      if (access === "denied") return commit({ view: { kind: "denied" }, chapter: null, where: null });
      if (access === "unavailable") return commit({ view: { kind: "empty", why: "failed" }, chapter: null });
      if (!introSeen()) return commit({ view: { kind: "firstVisit", access: "granted" } });
      if (!started.current) begin();
    },
    [commit, begin],
  );

  const checkAccess = useCallback(async () => {
    const access = await readAccess();
    if (live.current.access === "denied" && isGranted(access)) {
      // Let in from Settings: the first-visit page was passed on the way to the door.
      markIntroSeen();
      started.current = false;
    }
    settleAccess(access);
  }, [settleAccess]);

  /**
   * The first-visit page's one word. CONTINUE asks iOS — the only place
   * the room asks — and ENTER is the word when access is already given.
   * True when the room may go in; the page then fades and the screen
   * calls `begin`.
   */
  const enter = useCallback(async (): Promise<boolean> => {
    // iOS's question takes the app away and back: that return is this
    // word's to settle, not the AppState check's, which would otherwise
    // turn CONTINUE into ENTER under the member's finger, or go in early.
    asking.current = true;
    const was = live.current.access;
    let access: LibraryAccess = was === "checking" ? await readAccess() : was;
    if (access === "undetermined") access = await requestAccess();
    if (!mounted.current) return false;
    if (!isGranted(access)) {
      asking.current = false;
      settleAccess(access);
      return false;
    }
    markIntroSeen();
    commit({ access });
    return true;
  }, [commit, settleAccess]);

  // --- moving through a chapter ---------------------------------------------

  /** The page the member has settled on. Under 2 ms: nothing is read, and only memory is written. */
  const settle = useCallback((index: number) => {
    const s = live.current;
    const c = s.chapter;
    if (!c || s.view.kind !== "prints" || s.loading) return;
    const target = Math.max(0, Math.min(index, c.prints.length));
    if (target === c.index) return;
    const settled = (from: Chapter, missing: ReadonlySet<string>, full: boolean): Chapter => {
      const dropped = dropOnSettle(
        from.prints,
        target,
        (p, i) => (from.mode === "set-aside" && !isSetAside(p.id)) || (full && i < target && missing.has(p.id)),
      );
      return { ...from, prints: dropped.prints, index: dropped.index, rebase: dropped.rebased ? from.rebase + 1 : from.rebase };
    };
    const next = settled(c, s.missing, s.access === "full");
    live.current = { ...s, chapter: next };
    // Applied to whatever the chapter is by then: a batch may have landed in between.
    setState((prev) =>
      prev.chapter?.key === c.key ? { ...prev, chapter: settled(prev.chapter, prev.missing, prev.access === "full") } : prev,
    );
    const print = next.prints[next.index];
    if (print) visit?.record(print);
    savePlace({ mode: next.mode, year: next.year, month: next.month, index: next.index, prints: next.prints });
    // The day seen to its end does not open the room again today.
    if (!print && !next.more && next.mode === "on-this-day") finishDay(localDay());
  }, [visit]);

  // Close to the end: deal on.
  const chapter = state.chapter;
  useEffect(() => {
    const d = dealer.current;
    if (!chapter || !d || !chapter.more || chapter.failed || d.reading || state.view.kind !== "prints") return;
    const kind = chapter.mode === "surprise" ? "surprise" : "year";
    if (chapter.index >= chapter.prints.length - AHEAD[kind]) void d.read(BATCH[kind]);
  }, [chapter, state.view.kind, state.years]);

  /** The trailing page's TRY AGAIN: deal on, or start the chapter again if its reader could not be built. */
  const readOn = useCallback(() => {
    const c = live.current.chapter;
    const d = dealer.current;
    if (!c) return;
    if (d?.reader) {
      commit({ chapter: { ...c, failed: false, more: true } });
      void d.read(c.mode === "surprise" ? BATCH.surprise : BATCH.year);
      return;
    }
    void open({ mode: c.mode, year: c.year, month: c.month, fresh: true, startId: c.prints[c.prints.length - 1]?.id ?? null });
  }, [commit, open]);

  /** The error page's TRY AGAIN: the year index rebuilt, and the way in tried again. */
  const retry = useCallback(() => {
    visit?.forgetAnswers();
    void loadYears(true);
    const w = live.current.where;
    if (w) {
      void open({ mode: w.mode, year: w.year, month: w.month, fresh: true });
    } else {
      started.current = false;
      void checkAccess();
    }
  }, [visit, loadYears, open, checkAccess]);

  // --- the ways on -------------------------------------------------------------

  /**
   * A chapter chosen in Contents or on a page; `month` only from the
   * month strip. False when it is the chapter already open, or the month
   * already in view, which the choice simply leaves as it is (`choiceOf`).
   */
  const choose = useCallback(
    (mode: DarkroomMode, year: number | null = null, month: number | null = null): boolean => {
      const s = live.current;
      const spec = choiceOf({ showing: s.view.kind === "prints", where: s.where, chapter: s.chapter }, mode, year, month);
      if (!spec) return false;
      void open(spec);
      return true;
    },
    [open],
  );

  /** The caption thread: this print's year, at its month, with the print pinned in and current. */
  const thread = useCallback(
    (print: Print) => {
      const d = new Date(print.takenAt);
      void open({ mode: "year", year: d.getFullYear(), month: d.getMonth(), pin: print, jump: true });
    },
    [open],
  );

  /** MORE FROM: a second edit of the year, between the first's picks, without what was shown. */
  const moreFrom = useCallback(() => {
    const c = live.current.chapter;
    if (c?.mode === "year" && c.year != null) void open({ mode: "year", year: c.year, month: 0, shifted: true, jump: true });
  }, [open]);

  /** FROM JANUARY: the year from its first print. A January chapter already kept is turned back to its start, not to where it was left. */
  const fromJanuary = useCallback(() => {
    const c = live.current.chapter;
    if (c?.mode !== "year" || c.year == null) return;
    const kept = recallChapter(chapterKey("year", c.year, 0));
    void open({ mode: "year", year: c.year, month: 0, jump: true, startId: kept?.prints[0]?.id ?? null });
  }, [open]);

  /** ANOTHER ROLL: the chapter carries on with a new roll, this visit's picks still excluded. */
  const anotherRoll = useCallback(() => {
    const c = live.current.chapter;
    const d = dealer.current;
    if (c?.mode !== "surprise") return;
    if (!d || !d.anotherRoll(Date.now() >>> 0)) {
      void open({ mode: "surprise", year: null, month: 0, fresh: true, jump: true });
      return;
    }
    commit({
      chapter: { ...c, more: true, failed: false },
      loading: { mode: "surprise", year: null, month: 0, since: Date.now(), jump: true },
    });
    void d.read(BATCH.surprise);
  }, [open, commit]);

  // --- images ------------------------------------------------------------------

  /** A print's full image has drawn. A print that had been gone is back. */
  const imageLoaded = useCallback(
    (id: string) => {
      const first = !loaded.current.has(id);
      loaded.current.add(id);
      if (live.current.missing.has(id)) {
        patch((s) => {
          const missing = new Set(s.missing);
          missing.delete(id);
          return { missing };
        });
      }
      const c = live.current.chapter;
      if (first && c?.prints[c.index]?.id === id) setLoadTick((t) => t + 1);
    },
    [patch],
  );

  /** Drawn before this visit: likely still in memory, and needing no dissolve. */
  const hasLoaded = useCallback((id: string) => loaded.current.has(id), []);

  /** Photos said the photograph is not there. Under full access a set-aside reference to it is let go. */
  const imageGone = useCallback(
    (id: string) => {
      if (live.current.missing.has(id)) return;
      patch((s) => ({ missing: new Set([...s.missing, id]) }));
      if (live.current.access === "full" && isSetAside(id)) pruneSetAside([id]);
    },
    [patch],
  );

  // Settled on long enough, with its image drawn: seen. Not on the shelf,
  // which the member browses on purpose.
  const currentId = chapter ? chapter.prints[chapter.index]?.id ?? null : null;
  const shelfChapter = chapter?.mode === "set-aside";
  useEffect(() => {
    if (!currentId || shelfChapter || !loaded.current.has(currentId) || !focused.current) return;
    const t = setTimeout(() => markSeen(currentId), SEEN_AFTER_MS);
    return () => clearTimeout(t);
  }, [currentId, shelfChapter, loadTick]);

  // --- focus and the app ---------------------------------------------------------

  /** The room lost focus — to the editor, the picker, or leaving: the place and history go to disk. */
  const blur = useCallback(() => {
    focused.current = false;
    putAway();
  }, [putAway]);

  const focus = useCallback(() => {
    focused.current = true;
    setLoadTick((t) => t + 1);
  }, []);

  useEffect(() => {
    const sub = AppState.addEventListener("change", (next) => {
      // Leaving active, not only for the background: flicked away from the
      // app switcher, the app is only ever inactive before iOS ends it, and
      // the place must survive that (decision 14). Nothing is written when
      // nothing has changed. Under the editor the room was put away as it
      // lost focus, and a post may have moved its kept position on since
      // (`advancePlace`): only what is in memory goes to disk then.
      if (next !== "active") {
        if (focused.current) putAway();
        else {
          flushPlace();
          flushHistory();
        }
      } else if (!asking.current) {
        const v = live.current.view.kind;
        if (v === "denied" || v === "firstVisit" || live.current.access === "checking") void checkAccess();
      }
    });
    return () => sub.remove();
  }, [putAway, checkAccess]);

  // --- the library changing underneath (§8.4, §9.5) -------------------------------

  const libraryChanged = useCallback(
    async (whole: boolean, deleted: readonly string[]) => {
      if (!visit) return;
      visit.libraryChanged(whole);
      const access = await readAccess();
      if (!mounted.current) return;
      const before = live.current;
      // A print that failed to draw may draw now: one shared again comes back.
      const missing = whole ? new Set<string>() : new Set([...before.missing, ...deleted]);
      commit({ access, missing, revision: before.revision + 1, years: whole ? null : before.years });
      if (!isGranted(access)) return settleAccess(access);
      const v = before.view;
      // The first chapter is still being dealt: it finishes with what it
      // has, rather than starting over on the default rule and dropping
      // the chapter asked for. New photographs never reshuffle (§9.5).
      if (v.kind === "checking" && before.loading) return;
      // A page that said there was nothing, or that the library would not
      // answer, looks again: photographs just shared, or arriving from
      // iCloud on a new phone, appear without leaving the room.
      if (v.kind === "empty" || v.kind === "checking") {
        const w = before.where;
        if (w && v.kind === "empty" && (v.why === "day" || v.why === "shelf" || v.why === "failed")) {
          void open({ mode: w.mode, year: w.year, month: w.month, fresh: true });
        } else if (started.current) void openDefault();
        else if (introSeen()) begin();
        return;
      }
      if (whole && v.kind === "prints" && before.chapter) {
        // The selection changed: the chapter is dealt again, keeping the
        // print in front of the member if it is still there to keep.
        const c = before.chapter;
        const print = c.prints[c.index] ?? null;
        void open({ mode: c.mode, year: c.year, month: c.month, fresh: true, keep: print, startId: print?.id ?? null });
      }
      // Counted again now if Contents has shown them; otherwise when it next opens.
      if (before.years != null) void loadYears(true);
    },
    [visit, commit, settleAccess, open, openDefault, begin, loadYears],
  );

  useEffect(() => {
    if (Platform.OS === "web" || !source) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let whole = false;
    const deleted = new Set<string>();
    let sub: { remove: () => void } | null = null;
    try {
      sub = MediaLibrary.addListener((event) => {
        if (!event.hasIncrementalChanges) whole = true;
        for (const a of event.deletedAssets ?? []) deleted.add(a.id);
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => {
          timer = null;
          const all = whole;
          const ids = [...deleted];
          whole = false;
          deleted.clear();
          void libraryChanged(all, ids);
        }, LIBRARY_SETTLE_MS);
      });
    } catch {
      sub = null;
    }
    return () => {
      if (timer) clearTimeout(timer);
      sub?.remove();
    };
  }, [source, libraryChanged]);

  // --- mount and unmount -----------------------------------------------------------

  useEffect(() => {
    mounted.current = true;
    if (source) void checkAccess();
    else commit({ access: "unavailable", view: { kind: "empty", why: "failed" } });
    return () => {
      // Whatever is still being opened keeps what it deals for next time;
      // the chapter on the stage is kept with its dealer, whose batch in
      // flight goes into the kept position rather than nowhere.
      opening.current += 1;
      keepShown(true);
      savePlaceNow();
      flushPlace();
      flushHistory();
      dealer.current?.release();
      dealer.current = null;
      mounted.current = false;
    };
    // Once, for the life of the room.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const ending = useMemo(() => (chapter && !chapter.more ? endingOf(chapter, dealer.current) : null), [chapter]);

  return {
    state,
    /** How the chapter on the stage ends, once nothing more will be dealt. */
    ending,
    enter,
    begin,
    checkAccess,
    choose,
    thread,
    moreFrom,
    fromJanuary,
    anotherRoll,
    settle,
    readOn,
    retry,
    loadYears,
    loadMonths,
    pruneShelf,
    imageLoaded,
    imageGone,
    hasLoaded,
    blur,
    focus,
  };
}

export type Darkroom = ReturnType<typeof useDarkroom>;
