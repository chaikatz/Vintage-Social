import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppState, InteractionManager } from "react-native";
import { chooseMorePhotographs, openPhotoSettings, readAccess, requestAccess, type LibraryAccess } from "@/darkroom/access";
import { gated } from "@/darkroom/discovery";
import { darkroomAvailable, darkroomSource } from "@/darkroom/source";
import type { LibrarySource, Print } from "@/darkroom/types";
import { onReturnFromBackground } from "@/utils/appReturn";
import { watchLibrary } from "@/utils/library";
import type { RollPhase } from "./panels";
import {
  firstRange,
  keepSelection,
  mergeNewest,
  mergeOlder,
  nextRange,
  RELEASE_AFTER_BLUR_MS,
  ROLL_CAP,
  ROLL_FIRST,
  ROLL_MIN_VISIBLE,
  ROLL_PAGE,
  shouldRefresh,
  visibleOf,
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
 * Every photograph it draws is let go ten seconds after the tab is left
 * (`released`), and at once when the app goes to the background; the
 * selected photograph's full image goes on a memory warning
 * (`heroReleased`) until the next selection. What it read about them —
 * identifiers, sizes, dates — is kept.
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
  /** Every camera-roll image on the tab is let go. */
  released: boolean;
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
  const [released, setReleased] = useState(true);
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

  /** What was read, shown: screenshots left out under full access, 1,200 at most, the selection kept while it is there. */
  const apply = useCallback(
    (next: Print[], nextEnd: RollEnd) => {
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
      const sel = selection.current;
      choose(keepSelection(sel ? { id: sel.id, at: Date.now() } : null, visible, Date.now()));
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
      apply(next, more ? "more" : "done");
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
      apply(mergeNewest(read.current, page), page.hasNextPage ? (endRef.current === "capped" ? "more" : endRef.current) : "done");
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
   * `force` (back from the background, the tab tapped again).
   */
  const front = useCallback(
    async (force: boolean) => {
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
      if (force || shouldRefresh(lastReadAt.current, Date.now(), heard.current)) await readNewest();
    },
    [clear, readFirst, readNewest, setAccess, setPhase, source],
  );

  // In front, and left.
  useEffect(() => {
    focusedRef.current = focused;
    if (!focused) {
      leftAt.current = Date.now();
      watching.current?.();
      watching.current = null;
      if (releaseTimer.current) clearTimeout(releaseTimer.current);
      releaseTimer.current = setTimeout(() => setReleased(true), RELEASE_AFTER_BLUR_MS);
      return;
    }
    if (releaseTimer.current) clearTimeout(releaseTimer.current);
    releaseTimer.current = null;
    setReleased(false);
    setHeroReleased(false);
    // A selection left more than five minutes ago gives way to the newest.
    if (leftAt.current != null && selection.current) {
      choose(keepSelection({ id: selection.current.id, at: leftAt.current }, shown.current, Date.now()));
    }
    leftAt.current = null;
    if (!source) return;
    const task = InteractionManager.runAfterInteractions(() => {
      void front(false);
    });
    return () => task.cancel();
  }, [choose, focused, front, source]);

  // The app's own comings and goings.
  useEffect(() => {
    mounted.current = true;
    const change = AppState.addEventListener("change", (state) => {
      if (state === "background") setReleased(true);
      else if (state === "active" && focusedRef.current) setReleased(false);
    });
    let warning: { remove: () => void } | null = null;
    try {
      warning = AppState.addEventListener("memoryWarning", () => setHeroReleased(true));
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
  }, [front]);

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
        void front(true);
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
        apply(next, more ? "more" : "done");
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
    released,
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
