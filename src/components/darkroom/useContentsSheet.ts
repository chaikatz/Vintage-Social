import { useCallback, useEffect, useRef, useState } from "react";
import { Platform } from "react-native";
import { takePrunedNote } from "@/darkroom/setAside";
import type { Where } from "./chapter";
import { prunedNote } from "./words";

/**
 * The Contents sheet's comings and goings (§3.10).
 *
 * Opening it asks for what it shows that may have changed: the year
 * index (counted again only when it is no longer fresh), the open year's
 * months, and — under full access — whether every print on the shelf is
 * still in the library, so it can say once if some are not.
 *
 * Every choice closes it first. A choice that pushes a screen or opens a
 * picker is held until the sheet has gone (`dismissed`, iOS's onDismiss),
 * because a screen pushed under an open sheet would be hidden behind it.
 * Elsewhere the sheet has gone at once.
 */
export function useContentsSheet(room: {
  where: Where | null;
  loadYears: () => Promise<unknown>;
  loadMonths: (year: number) => Promise<unknown>;
  pruneShelf: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [toMonths, setToMonths] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const after = useRef<(() => void) | null>(null);
  const mounted = useRef(true);
  useEffect(
    () => () => {
      mounted.current = false;
    },
    [],
  );

  /** Open the sheet; `months` opens it at the open year's month strip (the caption thread in a year). */
  const show = (months = false) => {
    setToMonths(months);
    setNote(prunedNote(takePrunedNote()));
    setOpen(true);
    void room.loadYears();
    if (room.where?.mode === "year" && room.where.year != null) void room.loadMonths(room.where.year);
    void room.pruneShelf().then(() => {
      const n = takePrunedNote();
      if (n > 0 && mounted.current) setNote(prunedNote(n));
    });
  };

  const dismissed = useCallback(() => {
    const act = after.current;
    after.current = null;
    act?.();
  }, []);

  /** Close the sheet, and then, once it has gone, do `then`. */
  const close = (then?: () => void) => {
    after.current = then ?? null;
    setOpen(false);
    if (Platform.OS !== "ios") setTimeout(dismissed, 0);
  };

  return { open, toMonths, note, show, close, dismissed };
}
