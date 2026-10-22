import React, { useState } from "react";
import { Animated, Pressable, StyleSheet, Text, View } from "react-native";
import { Image } from "expo-image";
import type { Print } from "@/darkroom/types";
import { printSource } from "@/darkroom/printSource";
import { room, roomType, untrack } from "./room";

/** Space either side of a print, the room its caption takes, and the gap between. */
export const PRINT_GUTTER = 16;
export const CAPTION_HEIGHT = 62;
const CAPTION_GAP = 14;

/** The largest box of the print's own shape that fits the page above its caption. */
export function fitPrint(print: Pick<Print, "width" | "height">, pageWidth: number, pageHeight: number) {
  const ratio = print.width > 0 && print.height > 0 ? print.width / print.height : 1;
  const maxW = Math.max(1, pageWidth - PRINT_GUTTER * 2);
  const maxH = Math.max(1, pageHeight - CAPTION_HEIGHT - CAPTION_GAP - 16);
  const w = Math.min(maxW, maxH * ratio);
  return { width: Math.round(w), height: Math.round(w / ratio) };
}

/**
 * One print: the photograph at its own proportions — contained, never
 * cropped, never stretched; a rediscovered photograph is shown as it was
 * taken — with its caption hanging beneath, flush with the print's own
 * edges, the way an archive labels a plate. The date in tracked gold
 * capitals, SET ASIDE on the same line at the right, and in the serif
 * italic, how long ago.
 *
 * The frame is sized from the library's numbers before any pixels arrive,
 * so nothing moves when they do. The image is asked of Photos at the size
 * it is drawn, kept in memory only — nothing from the camera roll is
 * written to the app's disk cache — and cancelled when the page leaves
 * the window.
 */
export function PrintPage({
  print,
  width,
  height,
  label,
  line,
  active,
  isSetAside,
  onSetAside,
  onTap,
  chrome,
  reduceMotion,
  stage,
  accessibilityLabel,
  accessibilityActions,
  onAccessibilityAction,
}: {
  print: Print;
  width: number;
  height: number;
  label: string;
  line: string;
  active: boolean;
  isSetAside: boolean;
  onSetAside: () => void;
  onTap: () => void;
  /** The caption fades with the rest of the room's words. */
  chrome: Animated.Value;
  reduceMotion: boolean;
  /** While developing: what is happening, in place of the caption. */
  stage?: string | null;
  accessibilityLabel: string;
  accessibilityActions: { name: string; label?: string }[];
  onAccessibilityAction: (name: string) => void;
}) {
  const [missing, setMissing] = useState(false);
  const box = fitPrint(print, width, height);
  // The plate and its caption, set as one group, a little above the true
  // centre — the optical centre of a page.
  const group = box.height + CAPTION_GAP + CAPTION_HEIGHT;
  const top = Math.max(8, (height - group) / 2 - 12);

  return (
    <View style={{ width, height }}>
      <View
        style={{ position: "absolute", top, left: (width - box.width) / 2, width: box.width }}
        accessible
        accessibilityRole="adjustable"
        accessibilityLabel={missing ? "A photograph that is no longer in your library" : accessibilityLabel}
        accessibilityHint="Swipe up or down for the next or the previous photograph."
        accessibilityActions={accessibilityActions}
        onAccessibilityAction={(e) => onAccessibilityAction(e.nativeEvent.actionName)}
      >
        <Pressable onPress={onTap} style={[styles.frame, { height: box.height }]} accessible={false}>
          {missing ? (
            <View style={styles.missing}>
              <Text style={[styles.missingLabel, untrack(2.2)]}>No longer in your library</Text>
              <Text style={styles.missingLine}>It may have been deleted.</Text>
            </View>
          ) : (
            <Image
              source={printSource(print.uri)}
              style={StyleSheet.absoluteFill}
              contentFit="cover"
              cachePolicy="memory"
              priority={active ? "high" : "low"}
              recyclingKey={print.id}
              transition={reduceMotion ? 0 : { duration: 320, effect: "cross-dissolve", timing: "ease-out" }}
              onError={() => setMissing(true)}
              accessibilityIgnoresInvertColors
            />
          )}
        </Pressable>
        <Animated.View style={[styles.caption, { opacity: chrome }]} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
          <View style={styles.captionRow}>
            <Text style={[styles.label, untrack(2.2)]} numberOfLines={1} maxFontSizeMultiplier={1.5}>
              {stage ?? label}
            </Text>
            {stage || missing ? null : (
              <Pressable onPress={onSetAside} hitSlop={{ top: 14, bottom: 14, left: 14, right: 8 }} style={styles.aside}>
                {isSetAside ? <View style={styles.dot} /> : null}
                <Text style={[styles.asideText, untrack(2.2), isSetAside && styles.asideOn]} maxFontSizeMultiplier={1.5}>
                  {isSetAside ? "Set aside" : "Set aside"}
                </Text>
              </Pressable>
            )}
          </View>
          <Text style={styles.line} numberOfLines={1} maxFontSizeMultiplier={2}>
            {stage ? " " : line}
          </Text>
        </Animated.View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {
    width: "100%",
    backgroundColor: room.sunken,
    overflow: "hidden",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: room.line,
  },
  missing: { flex: 1, alignItems: "center", justifyContent: "center", padding: 20, gap: 8 },
  missingLabel: { fontFamily: roomType.mono, fontSize: 10, color: room.faint, textTransform: "uppercase", textAlign: "center" },
  missingLine: { fontFamily: roomType.serif, fontStyle: "italic", fontSize: 13, color: room.faint },
  caption: { height: CAPTION_HEIGHT, paddingTop: CAPTION_GAP },
  captionRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", minHeight: 16 },
  label: { flexShrink: 1, fontFamily: roomType.mono, fontSize: 11, color: room.gold, textTransform: "uppercase" },
  aside: { flexDirection: "row", alignItems: "center", marginLeft: 12 },
  dot: { width: 5, height: 5, borderRadius: 2.5, backgroundColor: room.gold, marginRight: 6 },
  asideText: { fontFamily: roomType.mono, fontSize: 10, color: room.faint, textTransform: "uppercase" },
  asideOn: { color: room.ink },
  line: { fontFamily: roomType.serif, fontStyle: "italic", fontSize: 15, lineHeight: 20, color: room.soft, marginTop: 6 },
});
