import React, { useCallback, useLayoutEffect, useMemo, useState } from "react";
import {
  Dimensions,
  FlatList,
  Keyboard,
  LayoutAnimation,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
  type KeyboardEvent,
  type ListRenderItemInfo,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Feather from "@expo/vector-icons/Feather";
import { colors, spacing, type } from "@/theme";
import { ERA_TITLE_MAX, type AddGroup } from "@/utils/eraEdits";
import type { PostRow } from "@/types/db";
import { PhotoTile } from "./PhotoGrid";
import { eraMeta, printLabel } from "./eraBook";
import {
  CREATE,
  NEW_ERA_HEAD,
  addConfirm,
  addHead,
  canCreate,
  chosenCount,
  gatherLines,
  keyboardLift,
  type EraSheetView,
  type GatherLine,
} from "./eraSheet";

/** Photographs across the sheet, and the gap between them. */
const ACROSS = 4;
const GAP = 4;

/**
 * The lines drawn as the sheet opens, a screenful and some, and how many
 * screens of them are kept drawn about the one in view.
 */
const FIRST_LINES = 12;
const SCREENS_DRAWN = 7;

const lineKey = (line: GatherLine) => line.key;
// A square's own tap is never reached (it is drawn under the checkbox), and is the same every time, so it never draws one again.
const noop = () => undefined;

/**
 * Photographs gathered into an era: added to one (ADD), or made into a
 * new one (NEW ERA, "New era…").
 *
 * Every photograph of the member's that can go, as squares, gathered by
 * where each is now: those in no era first, then each era by the name it
 * shows. A tap chooses one, or lets it go again, so several go at once;
 * one change, one save, for them all. A new era asks for its name first,
 * in a field of the sheet's own, so it is asked for the same way on every
 * phone. Nothing is done until the one button at the foot says so: Add,
 * with how many, or Create, once there is a name and a photograph.
 *
 * A list that draws only the lines near the screen (gatherLines), so a
 * member with hundreds of photographs opens it as quickly as one with a
 * few; and a square is drawn again only when it is chosen or let go, so
 * typing the name, or choosing another, leaves the rest as they are.
 */
export function EraGather({
  view,
  onAdd,
  onCreate,
  onClose,
}: {
  view: Extract<EraSheetView, { kind: "add" | "new" }>;
  onAdd: (photoIds: string[]) => void;
  onCreate: (name: string, photoIds: string[]) => void;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  const making = view.kind === "new";
  // The era ADD was for; none for a new one.
  const into = view.kind === "add" ? view.title : null;
  const [chosen, setChosen] = useState<readonly string[]>(view.kind === "new" ? view.chosen : []);
  const [name, setName] = useState("");

  // Only those still offered: one deleted, or moved here, while the sheet is up is let go.
  const offered = useMemo(() => new Set(view.groups.flatMap((g) => g.posts.map((p) => p.id))), [view.groups]);
  const picked = useMemo(() => chosen.filter((id) => offered.has(id)), [chosen, offered]);
  const pickedSet = useMemo(() => new Set(picked), [picked]);
  const toggle = useCallback(
    (id: string) => setChosen((now) => (now.includes(id) ? now.filter((x) => x !== id) : [...now, id])),
    [],
  );

  const ready = making ? canCreate(name, picked) : picked.length > 0;
  const label = making ? CREATE : addConfirm(picked.length);
  const confirm = () => {
    if (!ready) return;
    if (making) onCreate(name, picked);
    else onAdd(picked);
  };

  // The squares span the sheet between its margins; measured as laid out,
  // as a sheet on a large screen is narrower than the window.
  const { width: screen } = useWindowDimensions();
  const [wide, setWide] = useState(screen);
  const cell = Math.max(0, Math.floor((wide - spacing.lg * 2 - GAP * (ACROSS - 1)) / ACROSS));

  // On an iPhone the foot rises over the keyboard, by as far as it comes
  // up (keyboardLift), and sits just above it, the home indicator under
  // the keyboard then. Listened for as the sheet is laid out, before the
  // name field's autoFocus can bring the keyboard up. Android makes room
  // for the keyboard itself.
  const lift = useKeyboardLift();

  const lines = useMemo(() => gatherLines(view.groups, ACROSS), [view.groups]);
  const renderLine = useCallback(
    ({ item }: ListRenderItemInfo<GatherLine>) =>
      item.kind === "head" ? (
        <GatherHead group={item.group} />
      ) : (
        <View style={[styles.row, item.first && styles.rowFirst]}>
          {item.posts.map((post) => (
            <GatherTile key={post.id} post={post} on={pickedSet.has(post.id)} cell={cell} onToggle={toggle} />
          ))}
        </View>
      ),
    [pickedSet, cell, toggle],
  );

  const naming = making ? (
    <View style={styles.naming}>
      <Text style={styles.label}>Its name</Text>
      <TextInput
        value={name}
        onChangeText={setName}
        maxLength={ERA_TITLE_MAX}
        placeholder="A summer, a city, a person"
        placeholderTextColor={colors.inkFaint}
        style={styles.name}
        accessibilityLabel="The new era’s name"
        accessibilityHint={`Up to ${ERA_TITLE_MAX} characters.`}
        autoCapitalize="sentences"
        autoCorrect={false}
        autoFocus={view.kind === "new" && view.chosen.length > 0}
        returnKeyType="done"
        testID="era-name"
      />
      <View style={styles.nameRule} />
    </View>
  ) : null;

  return (
    <View style={[styles.root, { paddingBottom: lift }]}>
      <View style={styles.head}>
        <Text style={styles.eyebrow} accessibilityRole="header" numberOfLines={1}>
          {into == null ? NEW_ERA_HEAD : addHead(into)}
        </Text>
        <Pressable
          onPress={onClose}
          hitSlop={12}
          style={({ pressed }) => pressed && styles.pressed}
          accessibilityRole="button"
          accessibilityLabel="Cancel"
          accessibilityHint={making ? "Makes no new era." : "Adds nothing to this era."}
        >
          <Text style={styles.cancel}>Cancel</Text>
        </Pressable>
      </View>
      <View style={styles.rule} />

      <FlatList
        style={styles.root}
        data={lines}
        keyExtractor={lineKey}
        renderItem={renderLine}
        ListHeaderComponent={naming}
        ListEmptyComponent={
          <Text style={styles.none}>
            {making ? "There are no photographs of yours to choose from yet." : "Every photograph of yours is in this era already."}
          </Text>
        }
        keyboardShouldPersistTaps="handled"
        onLayout={(e) => setWide(e.nativeEvent.layout.width)}
        contentContainerStyle={{ paddingBottom: spacing.xl }}
        initialNumToRender={FIRST_LINES}
        windowSize={SCREENS_DRAWN}
      />

      <View style={[styles.foot, { paddingBottom: lift > 0 ? spacing.md : Math.max(insets.bottom, spacing.md) }]}>
        <Text style={styles.count} numberOfLines={1}>
          {chosenCount(picked.length)}
        </Text>
        <Pressable
          onPress={confirm}
          disabled={!ready}
          style={({ pressed }) => [styles.confirm, !ready && styles.confirmOff, pressed && ready && styles.pressed]}
          accessibilityRole="button"
          accessibilityLabel={label}
          accessibilityState={{ disabled: !ready }}
          accessibilityHint={
            making
              ? ready
                ? "Makes the era, with the photographs chosen."
                : "Give it a name, and choose a photograph."
              : ready
                ? `Adds them to ${into}.`
                : "Choose a photograph first."
          }
          testID="era-gather-confirm"
        >
          <Text style={styles.confirmText}>{label}</Text>
        </Pressable>
      </View>
    </View>
  );
}

/** Where a group's photographs are now: no era, or an era by the name it shows. */
const GatherHead = React.memo(function GatherHead({ group }: { group: AddGroup<PostRow> }) {
  return (
    <View style={styles.group}>
      <Text style={styles.groupTitle} accessibilityRole="header" numberOfLines={2}>
        {group.title}
      </Text>
      <Text style={styles.groupMeta}>
        {group.era ? eraMeta(group.era) : group.posts.length === 1 ? "1 photograph" : `${group.posts.length} photographs`}
      </Text>
    </View>
  );
});

/**
 * A photograph that can be chosen. Drawn again only when it is chosen or
 * let go, or the squares change size: `onToggle` is the same every time.
 */
const GatherTile = React.memo(function GatherTile({
  post,
  on,
  cell,
  onToggle,
}: {
  post: PostRow;
  on: boolean;
  cell: number;
  onToggle: (id: string) => void;
}) {
  // aria-checked as well, for the web, which reads no accessibilityState.
  return (
    <Pressable
      onPress={() => onToggle(post.id)}
      style={({ pressed }) => [{ width: cell, height: cell }, pressed && styles.pressed]}
      accessibilityRole="checkbox"
      accessibilityLabel={printLabel(post)}
      accessibilityState={{ checked: on }}
      aria-checked={on}
    >
      <View pointerEvents="none" style={on && styles.dimmed}>
        <PhotoTile post={post} size={cell} onPress={noop} />
      </View>
      {on ? <View pointerEvents="none" style={styles.frame} /> : null}
      <View pointerEvents="none" style={[styles.tick, on && styles.tickOn]}>
        {on ? <Feather name="check" size={11} color={colors.paper} /> : null}
      </View>
    </Pressable>
  );
});

/**
 * How far the keyboard is up over the sheet now, on iOS; nothing
 * elsewhere. Moves as the keyboard does, in its time, as
 * KeyboardAvoidingView moves a page.
 */
function useKeyboardLift(): number {
  const [lift, setLift] = useState(0);
  useLayoutEffect(() => {
    if (Platform.OS !== "ios") return;
    const move = (e: KeyboardEvent, to: number) => {
      if (e.duration > 0) {
        const duration = Math.max(e.duration, 10);
        LayoutAnimation.configureNext({ duration, update: { duration, type: e.easing } });
      }
      setLift(to);
    };
    const shown = Keyboard.addListener("keyboardWillShow", (e) =>
      move(e, keyboardLift(e.endCoordinates.screenY, Dimensions.get("window").height)),
    );
    const hidden = Keyboard.addListener("keyboardWillHide", (e) => move(e, 0));
    return () => {
      shown.remove();
      hidden.remove();
    };
  }, []);
  return lift;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.paper },
  head: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.md,
  },
  eyebrow: {
    flex: 1,
    fontFamily: type.mono,
    fontSize: 10,
    letterSpacing: 2.4,
    textTransform: "uppercase",
    color: colors.inkSoft,
  },
  cancel: {
    fontFamily: type.mono,
    fontSize: 10,
    letterSpacing: 2,
    textTransform: "uppercase",
    color: colors.accent,
  },
  rule: { height: 1, backgroundColor: colors.border, marginHorizontal: spacing.lg },
  pressed: { opacity: 0.6 },

  // The new era's name, written on the page like a chapter's.
  naming: { paddingHorizontal: spacing.lg, paddingTop: spacing.lg },
  label: {
    fontFamily: type.mono,
    fontSize: 9,
    letterSpacing: 1.8,
    textTransform: "uppercase",
    color: colors.inkSoft,
  },
  name: {
    marginTop: spacing.sm,
    paddingVertical: spacing.sm,
    fontFamily: type.serif,
    fontSize: 22,
    lineHeight: 28,
    letterSpacing: 0.4,
    color: colors.ink,
  },
  nameRule: { height: 1, backgroundColor: colors.borderStrong },

  none: { ...type.caption, paddingHorizontal: spacing.lg, paddingTop: spacing.xl, color: colors.inkSoft },

  // Where the photographs are now, each as a short chapter of squares, four to a row.
  group: { paddingHorizontal: spacing.lg, paddingTop: spacing.xl },
  groupTitle: { fontFamily: type.serif, fontSize: 17, lineHeight: 22, color: colors.ink },
  groupMeta: {
    marginTop: 3,
    fontFamily: type.mono,
    fontSize: 9,
    letterSpacing: 1.6,
    lineHeight: 13,
    textTransform: "uppercase",
    color: colors.inkSoft,
  },
  row: { flexDirection: "row", gap: GAP, paddingHorizontal: spacing.lg, marginTop: GAP },
  rowFirst: { marginTop: spacing.md },
  dimmed: { opacity: 0.72 },
  // A chosen square is framed in the accent, and ticked.
  frame: { position: "absolute", left: 0, top: 0, right: 0, bottom: 0, borderWidth: 2, borderColor: colors.accent },
  tick: {
    position: "absolute",
    right: 5,
    top: 5,
    width: 18,
    height: 18,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: colors.paper,
    backgroundColor: "rgba(0, 0, 0, 0.18)",
  },
  tickOn: { backgroundColor: colors.accent, borderColor: colors.accent },

  // The one button: Add, with how many, or Create.
  foot: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    backgroundColor: colors.paper,
  },
  count: {
    flex: 1,
    fontFamily: type.mono,
    fontSize: 10,
    letterSpacing: 1.8,
    textTransform: "uppercase",
    color: colors.inkSoft,
  },
  confirm: {
    minWidth: 104,
    paddingVertical: 10,
    paddingHorizontal: spacing.lg,
    borderRadius: 3,
    borderWidth: 1,
    alignItems: "center",
    backgroundColor: colors.shutter,
    borderColor: colors.shutter,
  },
  confirmOff: { opacity: 0.4 },
  confirmText: { fontSize: 14, fontWeight: "600", letterSpacing: 0.3, color: colors.onShutter },
});
