import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppState, InteractionManager } from "react-native";
import { chooseMorePhotographs, openPhotoSettings, readAccess, requestAccess, type LibraryAccess } from "@/darkroom/access";
import { gated } from "@/darkroom/discovery";
import { developedAt } from "@/darkroom/history";
import { darkroomAvailable, darkroomSource } from "@/darkroom/source";
import type { LibrarySource, Print } from "@/darkroom/types";
import { onReturnFromBackground } from "@/utils/appReturn";
import { watchLibrary } from "@/utils/library";
import type { RollPhase } from "./panels";
import {
  afterPosting,
  firstRange,
  keepSelection,
  mergeNewest,
  mergeOlder,
  newerArrived,
  nextRange,
  RELEASE_AFTER_BLUR_MS,
  ROLL_CAP,
  ROLL_FIRST,
  ROLL_MIN_VISIBLE,
  ROLL_PAGE,
  shouldRefresh,
  visibleOf,
  type Release,
  type RollEnd,
} from "./roll";

/**
 * The Post tab's roll: the member's own photographs, newest first, read
 * on this phone a bounded page at a time, and the one selected.
 *
 * Nothing happens until the tab is in front. The pager mounts it beside
 * Search and Activity before the member has gone near it, so until it is
 * first focused it asks nothing — not even what access it has — and
 * draws no photograph. Once in front, after the tab's own animation, it
 * reads the access iOS already gave (which never asks), and with full or
 * limited access the newest page: 60 photographs, through the Memory
 * Room's own gate, which keeps no more than two questions outstanding.
 * Each page after that is one more bounded question, a stretch of time
 * older than the last photograph read, as the member scrolls toward the
 * end; 1,200 at most, after which the roll hands on to the room.
 *
 * Asking for access is only ever done from a tap on the tab's own
 * explanation, SHOW MY PHOTOGRAPHS (`ask`). It keeps no listener on the
 * library: only after SHARE MORE, while the tab is in front, does it
 * listen for the selection to change, and it stops when the tab is left.
 *
 * What it draws it lets go of (`release`) in two steps. Ten seconds
 * after the tab is left, and at once when the app goes to the
 * background, every photograph out of sight goes ("unseen"): the screen
 * says which rows stay — those on it, and one either side — with the
 * mount when it is in view, so whenever the tab is seen again, swiped
 * back to or come back to from the editor or the Home screen, it is just
 * as it was. On a memory warning while the tab is not in front, all of
 * them go ("all"), as they are before it is first in front; in front,
 * the selected photograph's full image goes (`heroReleased`) until the
 * next selection, its proof staying. In front again, everything comes
 * back. Each photograph let go is taken off the screen with its view, so
 * its picture goes with it. What it read about them — identifiers,
 * sizes, dates — is kept.
 *
 * The selection is kept across visits for five minutes, the app's time in
 * the background counted as time away; a photograph newer than the
 * newest shown (one just taken, or just shared) is selected as it
 * arrives; and once the selected photograph has been posted, the
 * selection moves to the newest not yet posted.
 */
export interface Roll {
  phase: RollPhase;
  access: LibraryAccess | null;
  /** What the roll shows, newest first. */
  prints: Print[];
  selected: Print | null;
  end: RollEnd;
  loadingMore: boolean;
  /** SHOW MY PHOTOGRAPHS is waiting on iOS. */
  asking: boolean;
  /** What of the tab's camera-roll images is let go. */
  release: Release;
  /** The selected photograph's full image is let go; its proof stays. */
  heroReleased: boolean;
  /** The selection, and when it was made, for the second tap. */
  selection(): { id: string; at: number } | null;
  select(id: string): void;
  selectNewest(): void;
  ask(): void;
  shareMore(): void;
  openSettings(): void;
  retry(): void;
  loadMore(): void;
  refresh(): void;
}

/** A failed further page is not asked again for this long, so a list at its end does not ask on every frame. */
const MORE_PAUSE_MS = 5_000;
/** The first read goes on to no more than this many pages before it shows what it has. */
const FIRST_PAGES = 3;
/** A further read goes on, while a page brings nothing to show (screenshots only), to no more than this many pages. */
const MORE_PAGES = 4;
/** Reading the whole roll again from the top, after SHARE MORE, goes on to no more than this many pages: past the cap. */
const ALL_PAGES = Math.ceil(ROLL_CAP / ROLL_PAGE) + 1;

const allowedAccess = (a: LibraryAccess | null) => a === "full" || a === "limited";

export function useRoll(focused: boolean): Roll {
  const available = darkroomAvailable();
  const source = useMemo<LibrarySource | null>(() => {
    const s = available ? darkroomSource() : null;
    return s ? gated(s) : null;
  }, [available]);

  const [phase, setPhaseState] = useState<RollPhase>(available ? "waiting" : "unavailable");
  const [access, setAccessState] = useState<LibraryAccess | null>(null);
  const [prints, setPrints] = useState<Print[]>([]);
  const [end, setEnd] = useState<RollEnd>("more");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [asking, setAsking] = useState(false);
  // Nothing is drawn before the tab is first in front.
  const [release, setRelease] = useState<Release>("all");
  const [heroReleased, setHeroReleased] = useState(false);

  const mounted = useRef(true);
  const focusedRef = useRef(focused);
  const phaseRef = useRef(phase);
  const accessRef = useRef<LibraryAccess | null>(null);
  /** Everything read, newest first, screenshots and all: where the next page is read on from. */
  const read = useRef<Print[]>([]);
  const shown = useRef<Print[]>([]);
  const endRef = useRef<RollEnd>("more");
  const lastReadAt = useRef<number | null>(null);
  /** The library was heard to change, or the app came back, while the tab was not in front. */
  const heard = useRef(false);
  /** Each first read or refresh supersedes any read before it. */
  const generation = useRef(0);
  const reading = useRef(false);
  const readingMore = useRef(false);
  const moreFailedAt = useRef(0);
  const asked = useRef(false);
  const selection = useRef<{ id: string; at: number } | null>(null);
  const leftAt = useRef<number | null>(null);
  const releaseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const watching = useRef<(() => void) | null>(null);

  const setPhase = useCallback((p: RollPhase) => {
    phaseRef.current = p;
    setPhaseState(p);
  }, []);

  const setAccess = useCallback((a: LibraryAccess) => {
    accessRef.current = a;
    setAccessState(a);
  }, []);

  const choose = useCallback((id: string | null) => {
    selection.current = id ? { id, at: selection.current?.id === id ? selection.current.at : Date.now() } : null;
    setSelectedId(id);
  }, []);

  /**
   * What was read, shown: screenshots left out under full access, 1,200 at
   * most, the selection kept while it is there. A read from the top
   * (`fromTop`) that brings a photograph newer than the newest shown
   * selects it.
   */
  const apply = useCallback(
    (next: Print[], nextEnd: RollEnd, fromTop: boolean) => {
      const before = shown.current[0];
      read.current = next;
      let visible = visibleOf(next, accessRef.current);
      let e = nextEnd;
      if (visible.length >= ROLL_CAP) {
        visible = visible.slice(0, ROLL_CAP);
        e = "capped";
      }
      shown.current = visible;
      endRef.current = e;
      setPrints(visible);
      setEnd(e);
      if (fromTop && newerArrived(before, visible[0])) {
        choose(visible[0].id);
        return;
      }
      const sel = selection.current;
      choose(keepSelection(sel ? { id: sel.id, at: Date.now() } : null, visible, Date.now()));
    },
    [choose],
  );

  /**
   * Back in front after `away` (when the tab was left, or the app went to
   * the background): a selection left more than five minutes ago gives
   * way to the newest, and one that has since been posted to the newest
   * not yet posted.
   */
  const settle = useCallback(
    (away: number | null) => {
      const sel = selection.current;
      if (!sel) return;
      if (away != null) {
        const kept = keepSelection({ id: sel.id, at: away }, shown.current, Date.now());
        if (kept !== sel.id) {
          choose(kept);
          return;
        }
      }
      let moved: string | null | undefined;
      try {
        moved = afterPosting(sel, shown.current, developedAt);
      } catch {
        moved = undefined;
      }
      if (moved !== undefined) choose(moved);
    },
    [choose],
  );

  const clear = useCallback(() => {
    // Whatever was being read is now for a roll that is gone.
    generation.current += 1;
    reading.current = false;
    read.current = [];
    shown.current = [];
    endRef.current = "more";
    lastReadAt.current = null;
    setPrints([]);
    setEnd("more");
    choose(null);
  }, [choose]);

  /** The newest page, and up to two more while fewer than 24 can be shown. */
  const readFirst = useCallback(async () => {
    if (!source) return;
    const mine = ++generation.current;
    reading.current = true;
    if (phaseRef.current !== "ready") setPhase("loading");
    try {
      let page = await source.page({ range: firstRange(Date.now()), first: ROLL_FIRST, order: "desc" });
      if (mine !== generation.current || !mounted.current) return;
      let next = mergeNewest([], page);
      let more = page.hasNextPage;
      let stepPast = false;
      for (let pages = 1; more && pages < FIRST_PAGES && visibleOf(next, accessRef.current).length < ROLL_MIN_VISIBLE; pages++) {
        // Left between pages: what is read is shown, and the rest waits for the end of the roll.
        if (!focusedRef.current) break;
        const range = nextRange(next, stepPast);
        if (!range) break;
        page = await source.page({ range, first: ROLL_PAGE, order: "desc" });
        if (mine !== generation.current || !mounted.current) return;
        const merged = mergeOlder(next, page.prints);
        next = merged.prints;
        more = page.hasNextPage;
        stepPast = merged.added === 0;
      }
      lastReadAt.current = Date.now();
      heard.current = false;
      apply(next, more ? "more" : "done", true);
      setPhase("ready");
    } catch {
      // A library that would not answer is never shown as an empty one.
      if (mine === generation.current && mounted.current && phaseRef.current !== "ready") setPhase("failed");
    } finally {
      if (mine === generation.current) reading.current = false;
    }
  }, [apply, setPhase, source]);

  /** The newest page read again, over the newest stretch of the roll; the older photographs are kept. */
  const readNewest = useCallback(async () => {
    if (!source) return;
    if (phaseRef.current !== "ready") return readFirst();
    const mine = ++generation.current;
    reading.current = true;
    try {
      const page = await source.page({ range: firstRange(Date.now()), first: ROLL_FIRST, order: "desc" });
      if (mine !== generation.current || !mounted.current) return;
      lastReadAt.current = Date.now();
      heard.current = false;
      apply(mergeNewest(read.current, page), page.hasNextPage ? (endRef.current === "capped" ? "more" : endRef.current) : "done", true);
    } catch {
      // The roll on screen stays as it was.
    } finally {
      if (mine === generation.current) reading.current = false;
    }
  }, [apply, readFirst, source]);

  /**
   * As far as the roll was read, read again from the top, a bounded page
   * at a time: after SHARE MORE, which can share photographs from
   * anywhere in it, older ones included, and take others away.
   */
  const readAll = useCallback(async () => {
    if (!source) return;
    if (phaseRef.current !== "ready") return readFirst();
    const mine = ++generation.current;
    reading.current = true;
    const extent = read.current.length;
    try {
      let page = await source.page({ range: firstRange(Date.now()), first: ROLL_PAGE, order: "desc" });
      if (mine !== generation.current || !mounted.current) return;
      let next = mergeNewest([], page);
      let more = page.hasNextPage;
      let stepPast = false;
      for (let pages = 1; more && pages < ALL_PAGES && next.length < extent && focusedRef.current; pages++) {
        const range = nextRange(next, stepPast);
        if (!range) break;
        page = await source.page({ range, first: ROLL_PAGE, order: "desc" });
        if (mine !== generation.current || !mounted.current) return;
        const merged = mergeOlder(next, page.prints);
        next = merged.prints;
        more = page.hasNextPage;
        stepPast = merged.added === 0;
      }
      lastReadAt.current = Date.now();
      heard.current = false;
      apply(next, more ? "more" : "done", true);
    } catch {
      // The roll on screen stays as it was.
    } finally {
      if (mine === generation.current) reading.current = false;
    }
  }, [apply, readFirst, source]);

  /**
   * In front: what access there is now, which never asks; the first page
   * when the library may be read and has not been, or has changed hands;
   * otherwise the newest page again only when it is a minute old, or
   * `force` (back from the background, the tab tapped again); `deep` reads
   * the whole roll again (the selection shared with VINTAGE has changed).
   */
  const front = useCallback(
    async (force: boolean, deep = false) => {
      if (!source || !focusedRef.current) return;
      const before = accessRef.current;
      const now = await readAccess();
      if (!mounted.current || !focusedRef.current) return;
      setAccess(now);
      if (!allowedAccess(now)) {
        if (allowedAccess(before)) clear();
        setPhase(now === "undetermined" ? "undetermined" : now === "denied" ? "denied" : "unavailable");
        return;
      }
      if (before !== now || phaseRef.current !== "ready") {
        if (before !== now) clear();
        if (!reading.current || before !== now) await readFirst();
        return;
      }
      if (deep) await readAll();
      else if (force || shouldRefresh(lastReadAt.current, Date.now(), heard.current)) await readNewest();
    },
    [clear, readAll, readFirst, readNewest, setAccess, setPhase, source],
  );

  // In front, and left.
  useEffect(() => {
    focusedRef.current = focused;
    if (!focused) {
      leftAt.current = Date.now();
      watching.current?.();
      watching.current = null;
      if (releaseTimer.current) clearTimeout(releaseTimer.current);
      releaseTimer.current = setTimeout(() => setRelease((r) => (r === "none" ? "unseen" : r)), RELEASE_AFTER_BLUR_MS);
      return;
    }
    if (releaseTimer.current) clearTimeout(releaseTimer.current);
    releaseTimer.current = null;
    setRelease("none");
    setHeroReleased(false);
    settle(leftAt.current);
    leftAt.current = null;
    if (!source) return;
    const task = InteractionManager.runAfterInteractions(() => {
      void front(false);
    });
    return () => task.cancel();
  }, [focused, front, settle, source]);

  // The app's own comings and goings.
  useEffect(() => {
    mounted.current = true;
    const change = AppState.addEventListener("change", (state) => {
      if (state === "background") {
        // Time in the background is time away, for the selection as for a blur.
        if (focusedRef.current && leftAt.current == null) leftAt.current = Date.now();
        setRelease((r) => (r === "none" ? "unseen" : r));
      } else if (state === "active" && focusedRef.current) {
        setRelease("none");
        if (leftAt.current != null) {
          settle(leftAt.current);
          leftAt.current = null;
        }
      }
    });
    let warning: { remove: () => void } | null = null;
    try {
      warning = AppState.addEventListener("memoryWarning", () => {
        if (focusedRef.current) setHeroReleased(true);
        else setRelease("all");
      });
    } catch {
      warning = null;
    }
    // Access may have changed in Settings while the app was away.
    const back = onReturnFromBackground(() => {
      if (!focusedRef.current) {
        heard.current = true;
        return;
      }
      InteractionManager.runAfterInteractions(() => {
        void front(true);
      });
    });
    return () => {
      mounted.current = false;
      change.remove();
      warning?.remove();
      back();
      watching.current?.();
      watching.current = null;
      if (releaseTimer.current) clearTimeout(releaseTimer.current);
    };
  }, [front, settle]);

  const select = useCallback(
    (id: string) => {
      choose(id);
      setHeroReleased(false);
    },
    [choose],
  );

  const selectNewest = useCallback(() => {
    const newest = shown.current[0];
    if (newest) select(newest.id);
  }, [select]);

  const ask = useCallback(() => {
    if (asked.current || !source) return;
    asked.current = true;
    setAsking(true);
    void (async () => {
      try {
        const now = await requestAccess();
        if (!mounted.current) return;
        setAccess(now);
        if (allowedAccess(now)) {
          clear();
          await readFirst();
        } else {
          setPhase(now === "undetermined" ? "undetermined" : now === "denied" ? "denied" : "unavailable");
        }
      } finally {
        asked.current = false;
        if (mounted.current) setAsking(false);
      }
    })();
  }, [clear, readFirst, setAccess, setPhase, source]);

  const shareMore = useCallback(() => {
    void (async () => {
      await chooseMorePhotographs();
      if (!mounted.current || !focusedRef.current || watching.current) return;
      // iOS's sheet says nothing when the member is done; the library's change does.
      watching.current = watchLibrary(() => {
        if (!focusedRef.current) return;
        heard.current = true;
        void front(true, true);
      }, 2000);
    })();
  }, [front]);

  const retry = useCallback(() => {
    clear();
    void front(false);
  }, [clear, front]);

  const loadMore = useCallback(() => {
    if (!source || !focusedRef.current || phaseRef.current !== "ready" || endRef.current !== "more") return;
    if (reading.current || readingMore.current || Date.now() - moreFailedAt.current < MORE_PAUSE_MS) return;
    readingMore.current = true;
    setLoadingMore(true);
    const mine = generation.current;
    void (async () => {
      try {
        let next = read.current;
        let more = true;
        let stepPast = false;
        const before = visibleOf(next, accessRef.current).length;
        for (let pages = 0; more && pages < MORE_PAGES && focusedRef.current; pages++) {
          const range = nextRange(next, stepPast);
          if (!range) {
            more = false;
            break;
          }
          const page = await source.page({ range, first: ROLL_PAGE, order: "desc" });
          if (mine !== generation.current || !mounted.current) return;
          const merged = mergeOlder(next, page.prints);
          next = merged.prints;
          more = page.hasNextPage;
          // Nothing new: every photograph of that millisecond is read; step past it.
          stepPast = merged.added === 0;
          if (visibleOf(next, accessRef.current).length > before) break;
        }
        if (mine !== generation.current || !mounted.current) return;
        apply(next, more ? "more" : "done", false);
      } catch {
        moreFailedAt.current = Date.now();
      } finally {
        readingMore.current = false;
        if (mounted.current) setLoadingMore(false);
      }
    })();
  }, [apply, source]);

  const refresh = useCallback(() => {
    void front(true);
  }, [front]);

  const selected = useMemo(() => prints.find((p) => p.id === selectedId) ?? null, [prints, selectedId]);
  const current = useCallback(() => selection.current, []);
  const openSettings = useCallback(() => openPhotoSettings(), []);

  return {
    phase,
    access,
    prints,
    selected,
    end,
    loadingMore,
    asking,
    release,
    heroReleased,
    selection: current,
    select,
    selectNewest,
    ask,
    shareMore,
    openSettings,
    retry,
    loadMore,
    refresh,
  };
}
