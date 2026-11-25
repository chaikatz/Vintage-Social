import { useEffect, useMemo } from "react";
import { AppState } from "react-native";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { TodaysPrint } from "@/components/onThisDayPrint";
import type { LibraryAccess } from "@/darkroom/access";
import { inBackground } from "@/darkroom/discovery";
import { darkroomSource } from "@/darkroom/source";
import { dayDoorFace, readDayDoor, type DayDoorFace } from "./dayDoor";
import { tabSettled } from "./settle";

/**
 * The On this day door's face, read once a day.
 *
 * The library's part is read only once the roll is up, after the tab's
 * own animation, in the back line of the Memory Room's gate, so it never
 * holds up a photograph the member is about to see; and only while the
 * tab is in front with access already given. It is kept in memory for
 * the day (the key is today's date and the access), never on disk: the
 * app keeps no copy of its queries, and signing out clears them. A
 * reading that fails reads as no count at all, never as none.
 *
 * Leaving the tab, or the app going to the background, stops a reading
 * under way: its next question is not asked, and the reading starts again
 * the next time the tab is in front. A stopped reading is never taken for
 * an answer.
 *
 * Without the library's count, the face is the member's own post from
 * this date in an earlier year (`memory`, read by the tab from the posts
 * the profile shares), and without that, the leaf of a calendar.
 */
export function useDayDoor(p: {
  focused: boolean;
  access: LibraryAccess | null;
  ready: boolean;
  /** Today's first moment, local time. */
  today: number;
  memory: TodaysPrint | null;
}): DayDoorFace {
  const allowed = p.access === "full" || p.access === "limited";
  const source = useMemo(() => {
    const s = darkroomSource();
    return s ? inBackground(s) : null;
  }, []);
  const day = new Date(p.today);
  const dayKey = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, "0")}-${String(day.getDate()).padStart(2, "0")}`;
  const client = useQueryClient();
  // Left, or sent to the background: the reading under way stops at its next question.
  useEffect(() => {
    if (!p.focused) void client.cancelQueries({ queryKey: ["post-on-this-day"] });
  }, [client, p.focused]);
  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "background") void client.cancelQueries({ queryKey: ["post-on-this-day"] });
    });
    return () => sub.remove();
  }, [client]);
  const library = useQuery({
    queryKey: ["post-on-this-day", dayKey, p.access],
    queryFn: async ({ signal }) => {
      // After the tab's own slide (src/post/settle.ts); a reading stopped meanwhile asks nothing.
      await tabSettled(signal);
      if (!source) throw new Error("No library here.");
      return readDayDoor(source, new Date(p.today), signal);
    },
    enabled: Boolean(source) && p.focused && allowed && p.ready,
    staleTime: Infinity,
    gcTime: 24 * 3_600_000,
    retry: false,
  });
  const read = allowed ? (library.data ?? (library.isError ? ("failed" as const) : null)) : null;
  return useMemo(
    () => dayDoorFace({ library: read, memory: p.memory, today: new Date(p.today) }),
    [read, p.memory, p.today],
  );
}
