import { useCallback, useEffect, useRef, useState } from "react";
import { Animated, Easing } from "react-native";
import {
  connection,
  developFromCloud,
  developLocal,
  discardDeveloped,
  progressIsMeasured,
  type ComposeParams,
  type DevelopResult,
} from "@/darkroom/develop";
import { markSeen } from "@/darkroom/history";
import type { Print } from "@/darkroom/types";
import { haptics } from "./haptics";
import type { DevelopState } from "./words";

/** Past this, a develop says DEVELOPING… rather than just drawing its rule. */
export const SLOW_DEVELOP_MS = 400;
/** A measured download's rule follows each step over this. */
const PROGRESS_STEP_MS = 120;

const IDLE: DevelopState = { kind: "idle" };

/**
 * Develop, as the room sees it (§6.2, §6.3): from a tap on DEVELOP to the
 * editor, by way of the phone and, only when the member says so, iCloud.
 *
 * One develop at a time. A ref, not state, guards it, so a second tap in
 * the same frame does nothing; the same guard keeps the picker from
 * opening the editor twice (`claim`). The tap is the one place the room
 * gives a firm haptic. Each develop runs under its own AbortController,
 * kept in a ref: STOP aborts it, and so does the room losing focus or
 * unmounting — so a develop that outlives the room settles as cancelled
 * there and then, and never pushes the editor over whatever the member
 * went to instead. A copy that arrives after that is deleted by
 * `develop.ts`.
 *
 * Every outcome is a state, printed in the caption and DEVELOP positions;
 * there are no alerts and no failure haptics. Back from the editor
 * without posting, the developed copy is deleted and the room is as it
 * was.
 */
export function useDevelop(opts: {
  reduceMotion: boolean;
  /** The Set aside chapter is browsed on purpose: nothing is marked seen there. */
  shelfChapter: boolean;
  online: boolean;
  onCompose: (params: ComposeParams) => void;
}) {
  const [at, setAt] = useState<{ id: string | null; state: DevelopState }>({ id: null, state: IDLE });
  const [composing, setComposing] = useState(false);
  const guard = useRef(false);
  const controller = useRef<AbortController | null>(null);
  const developed = useRef<string | null>(null);
  const slowTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mounted = useRef(true);
  const focused = useRef(true);
  const progress = useRef(new Animated.Value(0)).current;
  const options = useRef(opts);
  options.current = opts;

  const set = useCallback((id: string | null, state: DevelopState) => {
    if (mounted.current) setAt({ id, state });
  }, []);

  const clearSlow = () => {
    if (slowTimer.current) clearTimeout(slowTimer.current);
    slowTimer.current = null;
  };

  /** What a develop came to. */
  const conclude = useCallback(
    async (print: Print, result: DevelopResult) => {
      if (!mounted.current) {
        if (result.status === "ok") discardDeveloped(result.params.uri);
        return;
      }
      switch (result.status) {
        case "ok":
          if (!focused.current) {
            // The room is no longer in front: the editor is not pushed over whatever is.
            discardDeveloped(result.params.uri);
            guard.current = false;
            set(null, IDLE);
            return;
          }
          developed.current = result.params.uri;
          setComposing(true);
          options.current.onCompose(result.params);
          return;
        case "inCloud": {
          const network = await connection();
          guard.current = false;
          set(print.id, network === "offline" ? { kind: "offline" } : { kind: "inCloud", network });
          return;
        }
        case "cancelled":
          guard.current = false;
          set(null, IDLE);
          return;
        default:
          guard.current = false;
          set(print.id, { kind: result.status });
      }
    },
    [set],
  );

  /** DEVELOP, or TRY AGAIN after a read that failed: from the phone only. */
  const develop = useCallback(
    async (print: Print) => {
      if (guard.current) return;
      guard.current = true;
      haptics.develop();
      if (!options.current.shelfChapter) markSeen(print.id);
      const reduce = options.current.reduceMotion;
      set(print.id, { kind: "working", slow: reduce });
      clearSlow();
      if (!reduce) {
        slowTimer.current = setTimeout(() => {
          setAt((a) => (a.id === print.id && a.state.kind === "working" ? { id: print.id, state: { kind: "working", slow: true } } : a));
        }, SLOW_DEVELOP_MS);
      }
      const c = new AbortController();
      controller.current = c;
      const result = await developLocal(print, { signal: c.signal });
      clearSlow();
      if (controller.current === c) controller.current = null;
      await conclude(print, result);
    },
    [set, conclude],
  );

  /** DOWNLOAD AND DEVELOP, or TRY AGAIN after iCloud did not send it. */
  const download = useCallback(
    async (print: Print) => {
      if (guard.current) return;
      guard.current = true;
      const measured = progressIsMeasured();
      progress.setValue(0);
      set(print.id, { kind: "downloading", progress: measured ? 0 : null });
      const c = new AbortController();
      controller.current = c;
      const result = await developFromCloud(print, {
        signal: c.signal,
        onProgress: (fraction) => {
          Animated.timing(progress, {
            toValue: fraction,
            duration: options.current.reduceMotion ? 0 : PROGRESS_STEP_MS,
            easing: Easing.linear,
            useNativeDriver: true,
          }).start();
        },
      });
      if (controller.current === c) controller.current = null;
      await conclude(print, result);
    },
    [progress, set, conclude],
  );

  /** STOP: the download is abandoned at once, and the print is as it was. */
  const stop = useCallback(() => {
    controller.current?.abort();
  }, []);

  /** NOT NOW: back to the print, in place. */
  const notNow = useCallback(() => {
    if (!guard.current) set(null, IDLE);
  }, [set]);

  /** A page turn clears whatever state the last print was in. */
  const clear = useCallback(() => {
    if (!guard.current) setAt((a) => (a.state.kind === "idle" ? a : { id: null, state: IDLE }));
  }, []);

  /** The picker shares the guard, so the editor is never opened twice. */
  const claim = useCallback((): boolean => {
    if (guard.current) return false;
    guard.current = true;
    return true;
  }, []);
  const unclaim = useCallback(() => {
    if (!developed.current && !controller.current) guard.current = false;
  }, []);

  /** The room is in front again — back from the editor, or from the picker. */
  const returned = useCallback(() => {
    focused.current = true;
    if (controller.current) return;
    discardDeveloped(developed.current);
    developed.current = null;
    guard.current = false;
    setComposing(false);
    set(null, IDLE);
  }, [set]);

  /** The room has lost focus: a develop still under way is abandoned. */
  const left = useCallback(() => {
    focused.current = false;
    controller.current?.abort();
  }, []);

  // Offline when it last looked: offered again once the phone is back online.
  const offlineId = at.state.kind === "offline" ? at.id : null;
  useEffect(() => {
    if (!offlineId || !opts.online) return;
    let live = true;
    connection()
      .then((network) => {
        if (!live || network === "offline") return;
        setAt((a) => (a.id === offlineId && a.state.kind === "offline" ? { id: offlineId, state: { kind: "inCloud", network } } : a));
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [offlineId, opts.online]);

  useEffect(
    () => () => {
      mounted.current = false;
      clearSlow();
      controller.current?.abort();
      // The room is going: a copy handed to the editor is not the room's to keep.
      discardDeveloped(developed.current);
      developed.current = null;
    },
    [],
  );

  const kind = at.state.kind;
  return {
    /** The state of the print `id`; every other print is idle. */
    stateFor: (id: string | null | undefined): DevelopState => (id != null && at.id === id ? at.state : IDLE),
    /** Which print the state belongs to. */
    id: at.id,
    /** Reading or downloading: pages do not turn, and STOP is the way out. */
    busy: kind === "working" || kind === "downloading",
    /** The editor is on top with this develop. */
    composing,
    /** The rule under DEVELOP is drawn out. */
    drawing: kind === "working" || composing,
    /** The print the easel blades are closed over. */
    bladesFor: kind === "working" || kind === "downloading" || composing ? at.id : null,
    progress: kind === "downloading" ? { fraction: at.state.kind === "downloading" && at.state.progress != null ? progress : null } : null,
    develop,
    download,
    stop,
    notNow,
    clear,
    claim,
    unclaim,
    returned,
    left,
  };
}
