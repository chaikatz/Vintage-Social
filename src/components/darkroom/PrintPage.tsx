import React, { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Image } from "expo-image";
import { agoLine, fullDate, monthYear, sameCalendarDay } from "@/darkroom/labels";
import type { Print } from "@/darkroom/types";
import { printSource } from "@/darkroom/printSource";
import { room, roomType } from "./room";

/** Space either side of a print, and the height its two lines of words take. */
export const PRINT_GUTTER = 28;
export const CAPTION_HEIGHT = 64;

/** The largest box of the print's own shape that fits the page, above its words. */
export function fitPrint(print: Pick<Print, "width" | "height">, pageWidth: number, pageHeight: number) {
  const ratio = print.width > 0 && print.height > 0 ? print.width / print.height : 1;
  const maxW = Math.max(1, pageWidth - PRINT_GUTTER * 2);
  const maxH = Math.max(1, pageHeight - CAPTION_HEIGHT - 12);
  const w = Math.min(maxW, maxH * ratio);
  return { width: Math.round(w), height: Math.round(w / ratio) };
}

/**
 * One print on the bench: the photograph at its own proportions — never
 * cropped, never stretched — and beneath it, the way an archive files it,
 * the month and year in tracked capitals and, in the serif, how long ago.
 *
 * The image is asked of Photos at the size it is drawn, kept in memory
 * only (nothing from the camera roll is written to the app's disk cache),
 * and cancelled when the page scrolls out of the window.
 */
export function PrintPage({
  print,
  width,
  height,
  now,
  active,
  posted,
  reduceMotion,
  stage,
  onAccessibilityAction,
}: {
  print: Print;
  width: number;
  height: number;
  now: number;
  active: boolean;
  /** When it was posted from this phone, if it was. */
  posted: number | null;
  reduceMotion: boolean;
  /** While developing: what is happening, in place of the date line. */
  stage?: string | null;
  onAccessibilityAction?: (action: "increment" | "decrement") => void;
}) {
  const [missing, setMissing] = useState(false);
  const box = fitPrint(print, width, height);
  const onTheDay = sameCalendarDay(print.takenAt, now);
  const when = monthYear(print.takenAt);
  const ago = agoLine(print.takenAt, now, onTheDay);
  const label = missing
    ? "A photograph that is no longer in your library"
    : `Photograph, ${fullDate(print.takenAt)}. ${ago}.${posted ? " Already posted." : ""}`;

  return (
    <View style={[styles.page, { width, height }]}>
      <View
        style={[styles.frame, box]}
        accessible
        accessibilityRole="adjustable"
        accessibilityLabel={label}
        accessibilityHint="Swipe up or down for the next or previous photograph."
        accessibilityActions={[{ name: "increment" }, { name: "decrement" }]}
        onAccessibilityAction={(e) => {
          const name = e.nativeEvent.actionName;
          if (name === "increment" || name === "decrement") onAccessibilityAction?.(name);
        }}
      >
        {missing ? (
          <View style={styles.missing}>
            <Text style={styles.missingText}>No longer in your library.</Text>
          </View>
        ) : (
          <Image
            source={printSource(print.uri)}
            style={StyleSheet.absoluteFill}
            contentFit="cover"
            cachePolicy="memory"
            priority={active ? "high" : "normal"}
            recyclingKey={print.id}
            transition={reduceMotion ? 0 : { duration: 260, effect: "cross-dissolve" }}
            onError={() => setMissing(true)}
            accessibilityIgnoresInvertColors
          />
        )}
      </View>
      <View style={[styles.caption, { width: box.width }]} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
        <Text style={styles.when} maxFontSizeMultiplier={1.3}>
          {stage ?? when}
        </Text>
        <Text style={styles.ago} maxFontSizeMultiplier={1.4} numberOfLines={1}>
          {stage ? " " : posted ? `${ago} · already posted` : ago}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { alignItems: "center", justifyContent: "center" },
  frame: { backgroundColor: room.sunken, overflow: "hidden" },
  missing: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24, borderWidth: 1, borderColor: room.line },
  missingText: { fontFamily: roomType.serif, fontStyle: "italic", fontSize: 15, color: room.faint, textAlign: "center" },
  caption: { height: CAPTION_HEIGHT, paddingTop: 16, alignItems: "flex-start" },
  when: { fontFamily: roomType.mono, fontSize: 11, letterSpacing: 2.6, color: room.ink, textTransform: "uppercase" },
  ago: { fontFamily: roomType.serif, fontStyle: "italic", fontSize: 15, color: room.soft, marginTop: 6 },
});
