import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, AppState, Platform, Pressable, StyleSheet, Text, View, type LayoutRectangle } from "react-native";
import { Image } from "expo-image";
import { useFocusEffect, useIsFocused } from "@react-navigation/native";
import { useRouter } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { Screen } from "@/components/Screen";
import { GateButton } from "@/components/gate/GateButton";
import { ruleWidth } from "@/components/gate/rule";
import { todaysPrint } from "@/components/onThisDayPrint";
import { colors, spacing, type } from "@/theme";
import { fetchUserPosts } from "@/api/posts";
import { useSession } from "@/providers/SessionProvider";
import { pickFromLibrary, takeForCompose, type PickedParams } from "@/utils/pickForCompose";
import { MAX_VIDEO_SECONDS } from "@/utils/validation";
import { darkroomAvailable } from "@/darkroom/source";
import { monthDay } from "@/darkroom/labels";
import { placeLine } from "@/darkroom/session";
import { useSetAside } from "@/darkroom/setAside";

/**
 * Where a post begins.
 *
 * One photograph per post. Short videos are allowed but live in the same
 * feed and grid as everything else — there is no separate video surface.
 *
 * There are two natural ways to begin, and the page is set so each is
 * plain at a glance. The Darkroom leads in type: the camera roll, one
 * print at a time, from further back than anyone scrolls. It is the
 * thing only VINTAGE does, so it has the largest line on the page, but it
 * is words on paper with nothing around them, and it never stands
 * between a member and the picture they came with. Under a rule is the
 * library, and the library has the page's one solid bar, low enough for
 * the thumb: one tap to the system picker, as it always was. The camera
 * and a short clip are quiet words beneath it, and the clip's limit is
 * a line under them. Then On this day, what the member posted on this
 * date in other years. Nothing here is a card, a plate or a dark block;
 * the Darkroom itself is the dark room.
 *
 * This tab never reads the photo library. It may be on screen, or
 * preloaded beside one, without the member having gone near the
 * Darkroom, so it cannot be the thing that asks iOS for the library or
 * looks through it. What it says about the Darkroom it reads from the
 * Darkroom's own small files on this phone. The one photograph it may
 * show is one the member has already posted, read from the server once
 * the tab is in front.
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
  // One date for the running head and On this day, turning over with the
  // clock; On this day waits for focus before asking the server for anything.
  const today = useToday();
  const focused = useIsFocused();

  return (
    <Screen padded={false} scroll>
      <View style={styles.body}>
        <View style={styles.head} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          <Text style={styles.headWord} maxFontSizeMultiplier={TYPE_CAP}>
            New post
          </Text>
          <Text style={styles.headWord} maxFontSizeMultiplier={TYPE_CAP}>
            {monthDay(today)}
          </Text>
        </View>

        {door ? (
          <>
            <DarkroomDoor held={held} />
            <View style={styles.rule} />
          </>
        ) : null}

        <View style={[styles.drawer, !door && styles.drawerFirst]}>
          <Text style={styles.eyebrow} accessibilityRole="header" maxFontSizeMultiplier={TYPE_CAP}>
            From your library
          </Text>
          {/* Under the door the library answers it; alone it says what the page is for. */}
          <Text style={styles.heading} maxFontSizeMultiplier={TYPE_CAP}>
            {door ? "Or the one you came with." : "Share a photograph."}
          </Text>
          <Text style={styles.sub} lineBreakStrategyIOS="push-out" maxFontSizeMultiplier={TYPE_CAP}>
            One picture at a time. You choose the film and the date stamp next.
          </Text>
          <GateButton
            title="Choose a photograph"
            variant="solid"
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
          <Text style={styles.waysNote} pointerEvents="none" lineBreakStrategyIOS="push-out" maxFontSizeMultiplier={TYPE_CAP}>
            Clips up to {MAX_VIDEO_SECONDS} seconds, in the same feed and grid.
          </Text>
        </View>

        <OnThisDay held={held} focused={focused} day={today} />

        <Text style={styles.note} lineBreakStrategyIOS="push-out" maxFontSizeMultiplier={TYPE_CAP}>
          Nothing here is ranked. A photograph is seen by the people who follow you, in the order it was posted.
        </Text>
      </View>
    </Screen>
  );
}

type Way = "photo" | "camera" | "video";

/** The page's type stops growing here, as the Darkroom's own word pages do. */
const TYPE_CAP = 2.4;
/** The bar's capitals stop growing here: one line from 375 pt up, two on the narrowest phones. */
const BAR_TYPE_CAP = 1.8;
/** GateButton's arrow is 18 wide, 16 in from the edge: the label keeps clear of it on both sides, so it stays centred. */
const BAR_INSET = 36;
/** ENTER's box: 4 above the letters, then the rule 7 below them, 1 high, then 4 more. */
const ENTER_PAD = 4;
const ENTER_RULE_GAP = 7;
/** SET ASIDE stands this far to the right of ENTER, on the same line of letters. */
const SET_ASIDE_GAP = 28;
const TOUCH = 44;
/** The print on the On this day line: a small 4 × 5, the shape the feed gives a portrait. */
const PRINT_WIDTH = 44;
const PRINT_HEIGHT = 55;

/**
 * The door to the Darkroom, in type only.
 *
 * The eyebrow, the line, the sentence and ENTER are one button. When the
 * member left the room within the last twelve hours the sentence becomes
 * where they were — "You left off in August 2018." — read from the place
 * the room keeps on disk, which knows the month without asking the
 * library. When anything is set aside, SET ASIDE stands on ENTER's line
 * and opens the shelf. It is a button of its own beside the door rather
 * than inside it, so VoiceOver can reach both; it is laid over the door's
 * last line, where ENTER's letters are measured to be.
 */
function DarkroomDoor({ held }: { held: boolean }) {
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

  // Where ENTER's box sits inside the door, and where the door sits inside
  // this block. SET ASIDE is placed only once both are known, so it never
  // draws a frame in the wrong place.
  const [enter, setEnter] = useState<LayoutRectangle | null>(null);
  const [doorAt, setDoorAt] = useState<{ x: number; y: number } | null>(null);
  let setAsideAt: { left: number; top: number } | null = null;
  if (enter && doorAt) {
    // The 44 pt target is centred on ENTER's letters, so the two words
    // share a line whatever the text size.
    const letters = Math.max(0, enter.height - ENTER_PAD * 2 - ENTER_RULE_GAP - 1);
    const target = Math.max(TOUCH, letters);
    setAsideAt = {
      left: doorAt.x + enter.x + enter.width + SET_ASIDE_GAP,
      top: doorAt.y + enter.y + ENTER_PAD - (target - letters) / 2,
    };
  }
  const n = shelf.length;

  return (
    <View style={styles.door}>
      <Pressable
        onLayout={(e) => setDoorAt({ x: e.nativeEvent.layout.x, y: e.nativeEvent.layout.y })}
        onPress={() => router.push("/darkroom")}
        disabled={held}
        style={({ pressed }) => pressed && styles.pressed}
        accessibilityRole="button"
        accessibilityLabel="The Darkroom"
        accessibilityHint="Your photographs, one at a time, from further back."
      >
        <Text style={styles.doorEyebrow} maxFontSizeMultiplier={TYPE_CAP}>
          The Darkroom
        </Text>
        {/* Two lines on every phone, broken after "photos" rather than leaving "new." alone. */}
        <Text style={styles.doorTitle} lineBreakStrategyIOS="push-out" maxFontSizeMultiplier={TYPE_CAP}>
          Your best photos aren’t new.
        </Text>
        <Text style={styles.doorLine} maxFontSizeMultiplier={TYPE_CAP}>
          {returnLine ?? "From further back than you’d think to look."}
        </Text>
        <View style={styles.enter} onLayout={(e) => setEnter(e.nativeEvent.layout)}>
          <Text style={styles.enterWord} maxFontSizeMultiplier={TYPE_CAP}>
            Enter
          </Text>
          <View style={[styles.enterRule, { width: ruleWidth("Enter") }]} />
        </View>
      </Pressable>
      {n > 0 && setAsideAt ? (
        <Pressable
          onPress={() => router.push({ pathname: "/darkroom", params: { mode: "set-aside" } })}
          disabled={held}
          style={({ pressed }) => [styles.setAside, setAsideAt, pressed && styles.pressed]}
          accessibilityRole="button"
          accessibilityLabel={`Set aside, ${n} ${n === 1 ? "photograph" : "photographs"}`}
          accessibilityHint="Opens the photographs you set aside."
        >
          {/* Never held to one line: it carries no rule, so it keeps its tracking whole and cannot be cut to "SET ASID…". */}
          <Text style={styles.setAsideWord} maxFontSizeMultiplier={TYPE_CAP}>
            Set aside
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

/**
 * One of the quieter ways in, as a line of capitals: the camera, a short
 * clip. While it is the one opening, a small spinner stands where its
 * letters were, in a box the same size, so nothing beside it moves.
 */
function QuietWay({
  label,
  hint,
  busy,
  held,
  onPress,
}: {
  label: string;
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
      accessibilityLabel={label}
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
 * On this day, as a line of type. When the member posted a photograph on
 * this date in an earlier year, the line becomes that memory's sentence
 * and the photograph stands at its end as one small print. It is read
 * from the posts the profile and On this day already share, only once
 * the tab is in front; on a day with no memory nothing more is drawn.
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
  const line = print?.headline ?? "What you posted on this date in other years";

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
            On this day
          </Text>
          <Text style={styles.dayLine} lineBreakStrategyIOS="push-out" maxFontSizeMultiplier={TYPE_CAP}>
            {line}
          </Text>
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
      <View style={styles.hairline} />
    </View>
  );
}

/**
 * Today, from its first moment, local time: the one date the running head
 * and On this day both read, so they never disagree. It turns over at
 * midnight, and is read again each time the app comes back to the front,
 * since a phone put away overnight holds its timers until then.
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
  body: { paddingHorizontal: spacing.lg },
  pressed: { opacity: 0.6 },
  hidden: { opacity: 0 },

  // The running head, as a book carries one: what the page is, and the day.
  // At the largest sizes on the narrowest phones the day goes under it.
  head: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
    columnGap: spacing.lg,
    rowGap: spacing.xs,
    marginTop: spacing.lg,
  },
  headWord: { fontFamily: type.mono, fontSize: 10, letterSpacing: 2.4, ...caps, color: colors.inkFaint },

  door: { paddingTop: spacing.xxl + spacing.sm, paddingBottom: spacing.xl + spacing.xs },
  // The only accent on the page: burnt sienna on paper, gold on the dark print.
  doorEyebrow: { fontFamily: type.mono, fontSize: 10, letterSpacing: 2.4, ...caps, color: colors.accent },
  doorTitle: {
    fontFamily: type.serif,
    fontSize: 32,
    lineHeight: 39,
    letterSpacing: 0.2,
    color: colors.ink,
    marginTop: spacing.md,
    maxWidth: 330,
  },
  // The room's own voice, the serif's italic, for the default and the return line alike.
  doorLine: {
    fontFamily: type.serif,
    fontStyle: "italic",
    fontSize: 15,
    lineHeight: 22,
    color: colors.inkSoft,
    marginTop: spacing.sm,
  },
  enter: { alignSelf: "flex-start", marginTop: spacing.lg + spacing.xs, paddingVertical: ENTER_PAD },
  enterWord: { fontFamily: type.mono, fontSize: 12, letterSpacing: 3, marginRight: -3, ...caps, color: colors.ink },
  enterRule: { height: 1, backgroundColor: colors.ink, opacity: 0.8, marginTop: ENTER_RULE_GAP, alignSelf: "center" },
  setAside: { position: "absolute", minHeight: TOUCH, justifyContent: "center" },
  // Its trailing tracking is kept (no negative margin): the box is as wide as its letters.
  setAsideWord: { fontFamily: type.mono, fontSize: 10.5, letterSpacing: 2.2, ...caps, color: colors.inkSoft },

  rule: { height: 1, backgroundColor: colors.borderStrong },
  hairline: { height: 1, backgroundColor: colors.border },

  drawer: { paddingTop: spacing.xl + spacing.xs },
  drawerFirst: { paddingTop: spacing.xxl + spacing.sm },
  eyebrow: { fontFamily: type.mono, fontSize: 10, letterSpacing: 2.4, ...caps, color: colors.inkFaint },
  heading: { ...type.title, lineHeight: 29, marginTop: spacing.sm + 2 },
  sub: { ...type.caption, lineHeight: 19, marginTop: spacing.xs },
  bar: {
    height: undefined,
    minHeight: 52,
    paddingVertical: spacing.md,
    paddingHorizontal: BAR_INSET,
    marginTop: spacing.lg + spacing.xs,
  },
  // SHORT VIDEO goes under CAMERA rather than off the page at the largest sizes.
  ways: { flexDirection: "row", flexWrap: "wrap", columnGap: spacing.xl + spacing.xs, rowGap: spacing.xs, marginTop: spacing.xs },
  way: { minHeight: TOUCH, justifyContent: "center" },
  wayWord: { fontFamily: type.mono, fontSize: 10.5, letterSpacing: 2.2, ...caps, color: colors.inkSoft },
  // Drawn up under the words it glosses, into the empty foot of their touch boxes, and never takes their taps.
  waysNote: { fontSize: 12, lineHeight: 17, color: colors.inkFaint, marginTop: -spacing.sm },

  daySection: { marginTop: spacing.lg },
  day: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.lg,
    minHeight: PRINT_HEIGHT + (spacing.md + 2) * 2,
    paddingVertical: spacing.md + 2,
  },
  dayText: { flex: 1 },
  dayTitle: { fontFamily: type.serif, fontSize: 17, lineHeight: 22, color: colors.ink },
  dayLine: { fontSize: 12, lineHeight: 17, color: colors.inkFaint, marginTop: 3 },
  print: { width: PRINT_WIDTH, height: PRINT_HEIGHT, backgroundColor: colors.paperSunken },

  note: {
    ...type.caption,
    fontSize: 12,
    lineHeight: 18,
    color: colors.inkFaint,
    marginTop: spacing.xl,
    paddingBottom: spacing.xl,
  },
});
