import React, { useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View, type AccessibilityActionEvent } from "react-native";
import { Image } from "expo-image";
import Feather from "@expo/vector-icons/Feather";
import { printSource } from "@/darkroom/printSource";
import type { Print } from "@/darkroom/types";
import { cellLabel, GAP, type RollRow as Row } from "@/post/roll";
import { colors, type } from "@/theme";

/**
 * The roll, four to a row, edge to edge, two points between: each cell
 * the member's own photograph, drawn straight off the phone at the
 * cell's size and kept by the cell alone (never in the shared image
 * cache, never on disk). The one selected wears the grease-pencil box the
 * Memory Room's glide strip draws, in the accent, with a hairline of
 * paper inside it so it reads on any photograph. On the iPhone the roll
 * begins with the camera, in the camera's own dark.
 *
 * A row is drawn again only when something in it changes: the selection
 * moving in or out of it, a cell opening, the tab letting its pictures go.
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
}: {
  row: Row;
  size: number;
  /** The selected photograph, when it is in this row. */
  selectedId: string | null;
  /** The photograph opening, when it is in this row. */
  busyId: string | null;
  cameraBusy: boolean;
  released: boolean;
  held: boolean;
  /** The wells stand quieter while the roll waits on the member. */
  dim: boolean;
  reduceMotion: boolean;
  onCell: (print: Print) => void;
  onPost: (print: Print) => void;
  onCamera?: () => void;
}) {
  return (
    <View style={styles.row}>
      {row.items.map((item) =>
        item.kind === "camera" ? (
          <CameraTile key={item.key} size={size} busy={cameraBusy} held={held} onPress={onCamera} />
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
      <Image
        source={released ? null : printSource(print.uri)}
        style={StyleSheet.absoluteFill}
        contentFit="cover"
        cachePolicy="none"
        allowDownscaling={false}
        priority="normal"
        recyclingKey={print.id}
        transition={transition}
        accessibilityIgnoresInvertColors
      />
      {selected ? (
        <View style={styles.box} pointerEvents="none">
          <View style={styles.boxInner} />
        </View>
      ) : null}
      {busy ? (
        <View style={styles.scrim} pointerEvents="none">
          <ActivityIndicator color={colors.onCamera} />
        </View>
      ) : null}
    </Pressable>
  );
});

/** The camera, first in the roll on the iPhone: its mark and its word, light on the camera's dark. */
export function CameraTile({ size, busy, held, onPress }: { size: number; busy: boolean; held: boolean; onPress?: () => void }) {
  return (
    <Pressable
      testID="post-camera"
      onPress={onPress}
      disabled={held || !onPress}
      style={({ pressed }) => [styles.camera, { width: size, height: size }, pressed && styles.pressed]}
      accessibilityRole="button"
      accessibilityLabel="Camera"
      accessibilityHint="Take one now"
      accessibilityState={{ busy, disabled: held }}
    >
      {busy ? (
        <ActivityIndicator color={colors.onCamera} />
      ) : (
        <>
          <Feather name="camera" size={22} color={colors.onCamera} />
          <Text style={styles.cameraWord} maxFontSizeMultiplier={BAR_TYPE_CAP}>
            Camera
          </Text>
        </>
      )}
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
  // The grease pencil: the accent, and a hairline of paper inside it, so it reads on any photograph.
  box: { ...StyleSheet.absoluteFillObject, borderWidth: 2.5, borderColor: colors.accent },
  boxInner: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, borderWidth: 1, borderColor: colors.paper, opacity: 0.55 },
  scrim: { ...StyleSheet.absoluteFillObject, alignItems: "center", justifyContent: "center", backgroundColor: SCRIM },
  camera: { backgroundColor: colors.cameraTile, alignItems: "center", justifyContent: "center", gap: 7 },
  cameraWord: { fontFamily: type.mono, fontSize: 9.5, letterSpacing: 1.8, textTransform: "uppercase", color: colors.onCamera },
  well: { backgroundColor: colors.paperSunken },
  wellDim: { opacity: 0.7 },
});
