import React, { useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View, type AccessibilityActionEvent } from "react-native";
import { Image } from "expo-image";
import Feather from "@expo/vector-icons/Feather";
import { printSource } from "@/darkroom/printSource";
import type { Print } from "@/darkroom/types";
import { CAMERA_LINE, CAMERA_MARK, cellLabel, GAP, SELECTED_BORDER, type RollRow as Row } from "@/post/roll";
import { colors, type } from "@/theme";

/**
 * The roll, four to a row, edge to edge, two points between, as the
 * owner's mock has it: each cell the member's own photograph, drawn
 * straight off the phone at the cell's size and kept by the cell alone
 * (never in the shared image cache, never on disk). The one selected
 * wears a rust border three points wide, the accent, drawn inside the
 * cell so nothing shifts. On the iPhone the roll begins with the camera:
 * the paper, ruled in the strong line, with the camera's small mark in
 * ink. Under a limited selection the tile after it is SHARE MORE, in the
 * same paper, the way to let VINTAGE see more.
 *
 * A row is drawn again only when something in it changes: the selection
 * moving in or out of it, a cell opening, the tab letting its pictures go.
 * A cell let go (`released`) takes its photograph's view off the screen,
 * and the picture with it, leaving the sunken paper; it comes back when
 * the tab is in front again.
 */

const BAR_TYPE_CAP = 1.8;
/** library-picker's scrim over a photograph that is opening. */
const SCRIM = "rgba(28, 25, 21, 0.45)";
/** A cell's photograph fades in this fast; not at all under Reduce Motion. */
const CELL_FADE_MS = 60;

export const RollRow = React.memo(function RollRow({
  row,
  size,
  selectedId,
  busyId,
  cameraBusy,
  released,
  held,
  dim,
  reduceMotion,
  onCell,
  onPost,
  onCamera,
  onShareMore,
}: {
  row: Row;
  size: number;
  /** The selected photograph, when it is in this row. */
  selectedId: string | null;
  /** The photograph opening, when it is in this row. */
  busyId: string | null;
  cameraBusy: boolean;
  /** This row's photographs are let go: it is out of sight while the tab is not in front. */
  released: boolean;
  held: boolean;
  /** The wells stand quieter while the roll waits on the member. */
  dim: boolean;
  reduceMotion: boolean;
  onCell: (print: Print) => void;
  onPost: (print: Print) => void;
  onCamera?: () => void;
  onShareMore?: () => void;
}) {
  return (
    <View style={styles.row}>
      {row.items.map((item) =>
        item.kind === "camera" ? (
          <CameraTile key={item.key} size={size} busy={cameraBusy} held={held} onPress={onCamera} />
        ) : item.kind === "more" ? (
          <ShareMoreTile key={item.key} size={size} held={held} onPress={onShareMore} />
        ) : item.kind === "well" ? (
          <Well key={item.key} size={size} dim={dim} />
        ) : (
          <RollCell
            key={item.key}
            print={item.print}
            size={size}
            selected={item.print.id === selectedId}
            busy={item.print.id === busyId}
            released={released}
            held={held}
            reduceMotion={reduceMotion}
            onPress={onCell}
            onOpen={onPost}
          />
        ),
      )}
    </View>
  );
});

export const RollCell = React.memo(function RollCell({
  print,
  size,
  selected,
  busy,
  released,
  held,
  reduceMotion,
  onPress,
  onOpen,
}: {
  print: Print;
  size: number;
  selected: boolean;
  busy: boolean;
  released: boolean;
  held: boolean;
  reduceMotion: boolean;
  onPress: (print: Print) => void;
  onOpen: (print: Print) => void;
}) {
  const [transition] = useState(() => (reduceMotion ? 0 : CELL_FADE_MS));
  const act = (e: AccessibilityActionEvent) => {
    if (e.nativeEvent.actionName === "post") onOpen(print);
    else onPress(print);
  };
  return (
    <Pressable
      testID="post-cell"
      onPress={() => onPress(print)}
      disabled={held}
      style={({ pressed }) => [styles.cell, { width: size, height: size }, pressed && styles.pressed]}
      accessibilityRole="button"
      accessibilityLabel={cellLabel(print)}
      accessibilityHint={selected ? "Opens it in the editor." : "Selects it."}
      accessibilityState={{ selected, busy, disabled: held }}
      aria-selected={selected}
      accessibilityActions={[{ name: "activate" }, { name: "post", label: "Post" }]}
      onAccessibilityAction={act}
    >
      {released ? null : (
        <Image
          source={printSource(print.uri)}
          style={StyleSheet.absoluteFill}
          contentFit="cover"
          cachePolicy="none"
          allowDownscaling={false}
          priority="normal"
          recyclingKey={print.id}
          transition={transition}
          accessibilityIgnoresInvertColors
        />
      )}
      {selected ? <View testID="post-cell-box" style={styles.box} pointerEvents="none" /> : null}
      {busy ? (
        <View style={styles.scrim} pointerEvents="none">
          <ActivityIndicator color={colors.onCamera} />
        </View>
      ) : null}
    </Pressable>
  );
});

/** The camera, first in the roll on the iPhone: the paper, ruled in the strong line, and its small mark in ink. */
export function CameraTile({ size, busy, held, onPress }: { size: number; busy: boolean; held: boolean; onPress?: () => void }) {
  return (
    <Pressable
      testID="post-camera"
      onPress={onPress}
      disabled={held || !onPress}
      style={({ pressed }) => [styles.tile, { width: size, height: size }, pressed && styles.pressed]}
      accessibilityRole="button"
      accessibilityLabel="Camera"
      accessibilityHint="Take one now"
      accessibilityState={{ busy, disabled: held }}
    >
      {busy ? <ActivityIndicator color={colors.ink} /> : <Feather name="camera" size={CAMERA_MARK} color={colors.ink} />}
    </Pressable>
  );
}

/** Under a limited selection, after the camera: the way to let VINTAGE see more, in the camera tile's paper. */
export function ShareMoreTile({ size, held, onPress }: { size: number; held: boolean; onPress?: () => void }) {
  return (
    <Pressable
      testID="post-share-more"
      onPress={onPress}
      disabled={held || !onPress}
      style={({ pressed }) => [styles.tile, styles.more, { width: size, height: size }, pressed && styles.pressed]}
      accessibilityRole="button"
      accessibilityLabel="Share more"
      accessibilityHint="VINTAGE sees only the photographs you chose. Opens iOS’s list of them."
      accessibilityState={{ disabled: held }}
    >
      <Feather name="plus" size={CAMERA_MARK} color={colors.ink} />
      <Text style={styles.moreWord} maxFontSizeMultiplier={BAR_TYPE_CAP}>
        Share more
      </Text>
    </Pressable>
  );
}

/** Where a photograph will be: the sunken paper, and nothing for VoiceOver. */
export function Well({ size, dim }: { size: number; dim: boolean }) {
  return (
    <View
      style={[styles.well, { width: size, height: size }, dim && styles.wellDim]}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    />
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", gap: GAP, marginBottom: GAP },
  cell: { backgroundColor: colors.paperSunken, overflow: "hidden" },
  pressed: { opacity: 0.6 },
  // The mock's rust border, inside the cell.
  box: { ...StyleSheet.absoluteFillObject, borderWidth: SELECTED_BORDER, borderColor: colors.accent },
  scrim: { ...StyleSheet.absoluteFillObject, alignItems: "center", justifyContent: "center", backgroundColor: SCRIM },
  tile: {
    backgroundColor: colors.paper,
    borderWidth: CAMERA_LINE,
    borderColor: colors.borderStrong,
    alignItems: "center",
    justifyContent: "center",
  },
  more: { gap: 8 },
  moreWord: { fontFamily: type.mono, fontSize: 9, letterSpacing: 1.8, textTransform: "uppercase", color: colors.ink, textAlign: "center" },
  well: { backgroundColor: colors.paperSunken },
  wellDim: { opacity: 0.7 },
});
