import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import type { NativeSyntheticEvent, TextInputSelectionChangeEventData } from "react-native";
import { keepPreviousData, useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { fetchFollowPage, searchProfiles, type FollowCursor } from "@/api/profiles";
import { useDebounced } from "@/hooks/useDebounced";
import {
  activeMention,
  insertMention,
  rankMentionSuggestions,
  type ActiveMention,
  type MentionCandidate,
} from "@/utils/mentions";

/**
 * A field that takes @names: a comment, a caption. It follows where the
 * caret is and whether the field is in use, says which name is being
 * written there, and puts the member chosen in its place.
 *
 * Wired to the field's onSelectionChange, onFocus and onBlur; the words
 * themselves stay where the screen keeps them, as they always were. The
 * caret is followed without drawing the screen again: the screen is
 * drawn again for it only when the name being written changes, never for
 * the caret moving through ordinary words (the editor is a heavy screen
 * to draw on every letter twice).
 */
export function useMentionField(value: string, setValue: (next: string) => void, max: number) {
  // Where the caret was last said to be. A letter typed is said before the
  // caret moves past it, so this can be a letter behind for a moment; it is
  // held to the words, and the selection event that follows puts it right.
  const caret = useRef(value.length);
  const [focused, setFocused] = useState(false);
  const [, redraw] = useReducer((n: number) => n + 1, 0);
  const mention = focused ? activeMention(value, caret.current) : null;

  // What the handlers read: the words and the name as last drawn.
  const latest = useRef({ value, focused, key: mentionKey(mention) });
  latest.current = { value, focused, key: mentionKey(mention) };

  const onSelectionChange = useCallback((e: NativeSyntheticEvent<TextInputSelectionChangeEventData>) => {
    caret.current = e.nativeEvent.selection.end;
    const { value: words, focused: inUse, key } = latest.current;
    if (mentionKey(inUse ? activeMention(words, caret.current) : null) !== key) redraw();
  }, []);
  // Left, the field keeps its names offered a moment longer: a tap on one
  // that takes the focus from the field first (as a click does on the web)
  // still lands on the chip, not on the row of reactions drawn in its place.
  const leaving = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onFocus = useCallback(() => {
    if (leaving.current) clearTimeout(leaving.current);
    leaving.current = null;
    setFocused(true);
  }, []);
  const onBlur = useCallback(() => {
    if (leaving.current) clearTimeout(leaving.current);
    leaving.current = setTimeout(() => {
      leaving.current = null;
      setFocused(false);
    }, LEAVE_AFTER_MS);
  }, []);
  useEffect(
    () => () => {
      if (leaving.current) clearTimeout(leaving.current);
    },
    [],
  );
  /** Where the caret is put after the screen changes the words itself (a reaction, a comment sent). */
  const setCaret = useCallback((at: number) => {
    caret.current = at;
  }, []);
  const caretAt = useCallback(() => caret.current, []);

  const pick = useCallback(
    (username: string) => {
      const words = latest.current.value;
      const writing = activeMention(words, caret.current);
      if (!writing) return;
      const next = insertMention(words, writing, username, max);
      if (!next) return;
      caret.current = next.caret;
      setValue(next.text);
    },
    [max, setValue],
  );

  return { mention, focused, onSelectionChange, onFocus, onBlur, setCaret, caretAt, pick };
}

/** How long the names stay offered after the field is left. */
const LEAVE_AFTER_MS = 400;

/** A name being written, as one value to compare: where it starts and what is typed of it. */
function mentionKey(mention: ActiveMention | null): string {
  return mention ? `${mention.start}:${mention.end}:${mention.query}` : "";
}

/** How long typing rests before a search is asked: the Search tab's beat, a little quicker. */
const SEARCH_AFTER_MS = 200;

/**
 * The members offered for a name being written (rankMentionSuggestions):
 * whom the writer follows, from the list Who was there already reads (the
 * newest fifty, kept for five minutes), then a search for anyone else
 * once two letters are typed, asked a beat after typing rests, through the
 * same search the Search tab uses. Nothing is read until a name is
 * started, and at most a handful are offered.
 */
export function useMentionSuggestions(mention: ActiveMention | null, myId: string): MentionCandidate[] {
  const open = mention !== null;
  const query = mention?.query ?? "";
  const following = useInfiniteQuery({
    queryKey: ["following-list", myId, "pages"],
    queryFn: ({ pageParam }) => fetchFollowPage("following", myId, pageParam),
    initialPageParam: null as FollowCursor | null,
    getNextPageParam: (last) => last.next,
    enabled: open && Boolean(myId),
    staleTime: 5 * 60_000,
  });
  const settled = useDebounced(query, SEARCH_AFTER_MS).trim();
  const found = useQuery({
    queryKey: ["search", settled],
    queryFn: () => searchProfiles(settled),
    enabled: open && settled.length >= 2,
    staleTime: 60_000,
    // The last answer stays while the next is asked; what no longer
    // matches what is typed is left out by the ranking.
    placeholderData: keepPreviousData,
  });
  const followed = following.data?.pages;
  const searched = open && settled.length >= 2 ? found.data : undefined;
  return useMemo(
    () => (open ? rankMentionSuggestions(query, (followed ?? []).flatMap((p) => p.members), searched ?? [], myId) : []),
    [open, query, followed, searched, myId],
  );
}
