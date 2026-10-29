import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, AppState, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { Image } from "expo-image";
import { useFocusEffect, useIsFocused } from "@react-navigation/native";
import { useRouter } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { Screen } from "@/components/Screen";
import { GateButton } from "@/components/gate/GateButton";
import { todaysPrint } from "@/components/onThisDayPrint";
import { colors, spacing, type } from "@/theme";
import { fetchUserPosts } from "@/api/posts";
import { useSession } from "@/providers/SessionProvider";
import { pickFromLibrary, takeForCompose, type PickedParams } from "@/utils/pickForCompose";
import { MAX_VIDEO_SECONDS } from "@/utils/validation";
import { darkroomAvailable } from "@/darkroom/source";
import { countLabel } from "@/darkroom/labels";
import { placeLine } from "@/darkroom/session";
import { useSetAside } from "@/darkroom/setAside";

/**
 * Where a post begins.
 *
 * One photograph per post. Short videos are allowed but live in the same
 * feed and grid as everything else — there is no separate video surface.
 *
 * The page's one serif line says what it is for. Under it are the two
 * ways in, each set the same way so it can be found at a glance: a small
 * mono eyebrow that names it, one short line that says when to take it,
 * and one bar. The two bars are the same size to the thumb and do not
 * look alike. The Memory Room comes first, since it is the thing only
 * VINTAGE does, and its bar is the invitation card's dark brown, ruled
 * and lettered in gold. The library's is the house's ruled bar in ink
 * (solid where it is the page's only bar), one tap to the system picker
 * as it always was; the camera and a short clip are quiet words under it,
 * with the clip's limit beneath them. Then On this day, one line at the
 * foot.
 *
 * This tab never reads the photo library. It may be on screen, or
 * preloaded beside one, without the member having gone near the Memory
 * Room, so it cannot be the thing that asks iOS for the library or looks
 * through it. What it says about the room it reads from the room's own
 * small files on this phone. The one photograph it may show is one the
 * member has already posted, read from the server once the tab is in
 * front.
 */
export default function Create() {
  const router = useRouter();
  // Reading the capture date and decoding the photograph take a moment,
  // and a button only goes quiet once React has rendered: two taps in the
  // same frame both got through and opened the editor twice. The ref is
  // checked and set in the tap itself, before anything awaits. `busy` is
  // for the eye only: it says which way in is opening, so only that one
  // shows it, and the others rest until it is done.
  const opening = useRef(false);
  const [busy, setBusy] = useState<Way | null>(null);

  const openWith = async (way: Way, get: () => Promise<PickedParams | null>) => {
    if (opening.current) return;
    opening.current = true;
    setBusy(way);
    try {
      const params = await get();
      if (params) router.push({ pathname: "/compose", params });
    } finally {
      opening.current = false;
      setBusy(null);
    }
  };

  const native = Platform.OS !== "web";
  const door = darkroomAvailable();
  const held = busy !== null;
  // On this day's date turns over with the clock, and it waits for focus
  // before asking the server for anything.
  const today = useToday();
  const focused = useIsFocused();

  return (
    <Screen padded={false} scroll>
      <View style={styles.body}>
        <Text style={styles.title} lineBreakStrategyIOS="push-out" maxFontSizeMultiplier={TITLE_CAP}>
          Share a photograph.
        </Text>

        {/* Without the room (Android) the library is the page, and the line above still says it. */}
        {door ? <MemoryRoomDoor held={held} /> : null}

        <View style={styles.section}>
          <Text style={styles.eyebrow} accessibilityRole="header" maxFontSizeMultiplier={TYPE_CAP}>
            From your library
          </Text>
          <Text style={styles.line} lineBreakStrategyIOS="push-out" maxFontSizeMultiplier={TYPE_CAP}>
            The one you have in mind.
          </Text>
          {/* Ruled beside the room's bar, so the two are told apart; alone it is the page's one bar, and solid. */}
          <GateButton
            title="Choose a photograph"
            variant={door ? "outline" : "solid"}
            onPress={() => openWith("photo", () => pickFromLibrary("photo"))}
            loading={busy === "photo"}
            disabled={held}
            accessibilityHint="Opens your photo library. Nothing is shared until you post."
            maxFontSizeMultiplier={BAR_TYPE_CAP}
            style={styles.bar}
          />
          <View style={styles.ways}>
            {native ? (
              <QuietWay
                label="Camera"
                hint="Take one now"
                busy={busy === "camera"}
                held={held}
                onPress={() => openWith("camera", takeForCompose)}
              />
            ) : null}
            <QuietWay
              label="Short video"
              hint={`Up to ${MAX_VIDEO_SECONDS} seconds, same feed, same grid`}
              busy={busy === "video"}
              held={held}
              onPress={() => openWith("video", () => pickFromLibrary("video"))}
            />
          </View>
          {/* On the page as well as in the hint: off iOS no trimmer holds a clip to the limit. */}
          {/* A View, not the Text, refuses the taps: Android's Text ignores pointerEvents. */}
          <View style={styles.waysNote} pointerEvents="none">
            <Text style={styles.waysNoteText} lineBreakStrategyIOS="push-out" maxFontSizeMultiplier={TYPE_CAP}>
              Clips up to {MAX_VIDEO_SECONDS} seconds.
            </Text>
          </View>
        </View>

        <OnThisDay held={held} focused={focused} day={today} />
      </View>
    </Screen>
  );
}

type Way = "photo" | "camera" | "video";

/** The page's type stops growing here, as the Memory Room's own word pages do. */
const TYPE_CAP = 2.4;
/** The serif line stops growing sooner: here "photograph." still fits on one line of a 320 pt phone, so it is never broken in two. */
const TITLE_CAP = 1.8;
/** The bars' capitals stop growing here. At the largest sizes a label takes two lines, and its bar grows to hold them. */
const BAR_TYPE_CAP = 1.8;
/** GateButton's arrow is 18 wide, 16 in from the edge: the label keeps clear of it on both sides, so it stays centred. */
const BAR_INSET = 36;
const TOUCH = 44;
/** The print on the On this day line: a small 4 × 5, the shape the feed gives a portrait. */
const PRINT_WIDTH = 44;
const PRINT_HEIGHT = 55;

/**
 * The way into the Memory Room: its name, one line, and its bar.
 *
 * When the member left the room within the last twelve hours the line
 * becomes where they were — "You left off in August 2018." — read from
 * the place the room keeps on disk, which knows the month without asking
 * the library. When anything is set aside, SET ASIDE stands under the
 * bar, as the camera and the clip stand under the library's, and opens
 * the shelf.
 */
function MemoryRoomDoor({ held }: { held: boolean }) {
  const router = useRouter();
  const shelf = useSetAside();
  const [returnLine, setReturnLine] = useState<string | null>(null);
  useFocusEffect(
    useCallback(() => {
      try {
        setReturnLine(placeLine());
      } catch {
        setReturnLine(null);
      }
    }, []),
  );
  const n = shelf.length;

  return (
    <View style={styles.section}>
      <Text style={[styles.eyebrow, styles.roomEyebrow]} accessibilityRole="header" maxFontSizeMultiplier={TYPE_CAP}>
        The Memory Room
      </Text>
      <Text style={styles.line} lineBreakStrategyIOS="push-out" maxFontSizeMultiplier={TYPE_CAP}>
        {returnLine ?? "Rediscover something worth sharing."}
      </Text>
      <GateButton
        title="Enter the Memory Room"
        variant="card"
        onPress={() => router.push("/darkroom")}
        disabled={held}
        accessibilityHint="Opens your photographs, one at a time, from further back."
        maxFontSizeMultiplier={BAR_TYPE_CAP}
        style={styles.bar}
      />
      {n > 0 ? (
        <View style={[styles.ways, styles.shelf]}>
          {/* Counted as the room's Contents counts it. */}
          <QuietWay
            label={`Set aside · ${countLabel(n)}`}
            spoken={`Set aside, ${n} ${n === 1 ? "photograph" : "photographs"}`}
            hint="Opens the photographs you set aside."
            busy={false}
            held={held}
            onPress={() => router.push({ pathname: "/darkroom", params: { mode: "set-aside" } })}
          />
        </View>
      ) : null}
    </View>
  );
}

/**
 * One of the quieter ways in, as a line of capitals: the camera, a short
 * clip, the shelf of prints set aside. While it is the one opening, a
 * small spinner stands where its letters were, in a box the same size,
 * so nothing beside it moves. Its letters are never held to one line: a
 * word in tracked capitals cut short reads as "SET ASID…".
 */
function QuietWay({
  label,
  spoken,
  hint,
  busy,
  held,
  onPress,
}: {
  label: string;
  /** What VoiceOver says, where it says more than the word. */
  spoken?: string;
  hint: string;
  busy: boolean;
  held: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={held}
      hitSlop={{ left: 8, right: 8 }}
      style={({ pressed }) => [styles.way, pressed && styles.pressed]}
      accessibilityRole="button"
      accessibilityLabel={spoken ?? label}
      accessibilityHint={hint}
      accessibilityState={{ busy, disabled: held }}
    >
      <Text style={[styles.wayWord, busy && styles.hidden]} maxFontSizeMultiplier={TYPE_CAP}>
        {label}
      </Text>
      {busy ? <ActivityIndicator size="small" color={colors.inkSoft} style={StyleSheet.absoluteFill} /> : null}
    </Pressable>
  );
}

/**
 * On this day, as one line at the foot of the page. When the member
 * posted a photograph on this date in an earlier year, that memory's
 * sentence goes under it and the photograph stands at its end as one
 * small print. It is read from the posts the profile and On this day
 * already share, only once the tab is in front; on a day with no memory
 * nothing more is drawn.
 */
function OnThisDay({ held, focused, day }: { held: boolean; focused: boolean; day: number }) {
  const router = useRouter();
  const { session } = useSession();
  const userId = session?.user?.id ?? "";
  const posts = useQuery({
    queryKey: ["user-posts", userId],
    queryFn: () => fetchUserPosts(userId),
    enabled: Boolean(userId) && focused,
    // A memory changes once a day, and a new post reaches this cache on its own.
    staleTime: 10 * 60_000,
  });
  const print = useMemo(() => todaysPrint(posts.data, new Date(day)), [posts.data, day]);

  return (
    <View style={styles.daySection}>
      <View style={styles.hairline} />
      <Pressable
        onPress={() => router.push("/memories")}
        disabled={held}
        style={({ pressed }) => [styles.day, pressed && styles.pressed]}
        accessibilityRole="button"
        accessibilityLabel={print ? `On this day. ${print.headline}` : "On this day"}
        accessibilityHint="Opens what you posted on this date in other years."
      >
        <View style={styles.dayText}>
          <Text style={styles.dayTitle} maxFontSizeMultiplier={TYPE_CAP}>
            On this day →
          </Text>
          {print ? (
            <Text style={styles.dayLine} lineBreakStrategyIOS="push-out" maxFontSizeMultiplier={TYPE_CAP}>
              {print.headline}
            </Text>
          ) : null}
        </View>
        {print?.source != null ? (
          <Image
            source={print.source}
            style={[styles.print, print.filter ? ({ filter: print.filter } as object) : null]}
            contentFit="cover"
            transition={200}
            recyclingKey={print.id}
            accessibilityIgnoresInvertColors
          />
        ) : null}
      </Pressable>
    </View>
  );
}

/**
 * Today, from its first moment, local time: the date On this day reads.
 * It turns over at midnight, and is read again each time the app comes
 * back to the front, since a phone put away overnight holds its timers
 * until then.
 */
function useToday(): number {
  const [today, setToday] = useState(() => startOfDay(Date.now()));
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    // A timer that wakes a moment early sets the same day and waits again.
    const turn = () => {
      const now = Date.now();
      setToday(startOfDay(now));
      clearTimeout(timer);
      timer = setTimeout(turn, tomorrow(now) - now);
    };
    turn();
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") turn();
    });
    return () => {
      clearTimeout(timer);
      sub.remove();
    };
  }, []);
  return today;
}

function startOfDay(ms: number): number {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/** The first moment of the next day, local time, however long a day the clocks make it. */
function tomorrow(ms: number): number {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime();
}

const caps = { textTransform: "uppercase" as const };

const styles = StyleSheet.create({
  body: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xl },
  pressed: { opacity: 0.6 },
  hidden: { opacity: 0 },

  // The page's one serif line, under the screen's title.
  title: { fontFamily: type.serif, fontSize: 28, lineHeight: 34, letterSpacing: 0.2, color: colors.ink, marginTop: spacing.xl },

  section: { marginTop: spacing.xxl + spacing.sm },
  eyebrow: { fontFamily: type.mono, fontSize: 10, letterSpacing: 2.4, ...caps, color: colors.inkFaint },
  // The room's name, in the page's one accent: burnt sienna on paper, gold on the dark print.
  roomEyebrow: { color: colors.accent },
  line: { fontSize: 15, lineHeight: 21, color: colors.inkSoft, marginTop: spacing.sm },
  bar: {
    height: undefined,
    minHeight: 52,
    paddingVertical: spacing.md,
    paddingHorizontal: BAR_INSET,
    marginTop: spacing.lg,
  },
  // SHORT VIDEO goes under CAMERA rather than off the page at the largest sizes.
  ways: { flexDirection: "row", flexWrap: "wrap", columnGap: spacing.xl + spacing.xs, rowGap: spacing.xs, marginTop: spacing.xs },
  // The library is drawn up into the empty foot of SET ASIDE's touch box,
  // so the two ways in sit about as far apart with the shelf as without it.
  shelf: { marginBottom: -spacing.md },
  way: { minHeight: TOUCH, justifyContent: "center" },
  // Its trailing tracking is kept (no negative margin): the box is as wide as its letters.
  wayWord: { fontFamily: type.mono, fontSize: 10.5, letterSpacing: 2.2, ...caps, color: colors.inkSoft },
  // Drawn up under the words it glosses, into the empty foot of their touch boxes, and never takes their taps.
  waysNote: { marginTop: -spacing.sm },
  waysNoteText: { fontSize: 12, lineHeight: 17, color: colors.inkFaint },

  hairline: { height: 1, backgroundColor: colors.border },
  daySection: { marginTop: spacing.xl + spacing.xs },
  day: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.lg,
    minHeight: TOUCH + spacing.sm * 2,
    paddingVertical: spacing.md,
  },
  dayText: { flex: 1 },
  dayTitle: { fontFamily: type.mono, fontSize: 10.5, letterSpacing: 2.2, ...caps, color: colors.inkSoft },
  dayLine: { fontSize: 12, lineHeight: 17, color: colors.inkFaint, marginTop: spacing.xs },
  print: { width: PRINT_WIDTH, height: PRINT_HEIGHT, backgroundColor: colors.paperSunken },
});
