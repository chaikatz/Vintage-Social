import React, { useEffect, useState } from "react";
import { StyleSheet, View } from "react-native";
import { RoomText, Rule } from "./Type";
import { LOOKING } from "./words";

/** "Looking through your library…" joins a card that has been waiting this long. */
export const SLOW_AFTER_MS = 1200;

/**
 * A chapter's title card: a word page, not a print. The way in in gold,
 * its name large in the serif — a year in old-style figures, as a book
 * sets one — and the rule. Shown only while a chapter is being dealt and
 * not ready within a quarter of a second (see `useStageFades`), and as
 * the trailing page when the member outruns the deal. After a second or
 * so of waiting it says what it is doing, once, politely.
 *
 * `since` is when the waiting began; the card counts from then, so a card
 * that appears at 250 ms still adds its line at 1.2 s.
 */
export function TitleCard({
  eyebrow,
  title,
  year,
  waiting,
  since,
}: {
  eyebrow: string;
  title: string;
  /** The title is a year: 64/72, old-style. */
  year: boolean;
  waiting: boolean;
  since?: number;
}) {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    if (!waiting) {
      setSlow(false);
      return;
    }
    const left = Math.max(0, (since ?? Date.now()) + SLOW_AFTER_MS - Date.now());
    const t = setTimeout(() => setSlow(true), left);
    return () => clearTimeout(t);
  }, [waiting, since]);

  return (
    <View style={styles.card}>
      <RoomText kind="eyebrow" tone="gold" maxFontSizeMultiplier={1.4} style={styles.center}>
        {eyebrow}
      </RoomText>
      <RoomText
        kind={year ? "cardYear" : "cardTitle"}
        accessibilityRole="header"
        maxFontSizeMultiplier={1.4}
        style={[styles.center, styles.title]}
      >
        {title}
      </RoomText>
      <Rule width={26} style={styles.rule} />
      {/* The line keeps its place while it is not yet said, so nothing moves when it is. */}
      <RoomText
        kind="slow"
        maxFontSizeMultiplier={1.4}
        accessibilityLiveRegion="polite"
        style={[styles.center, styles.slow, { opacity: slow ? 1 : 0 }]}
        accessibilityElementsHidden={!slow}
        importantForAccessibility={slow ? "auto" : "no-hide-descendants"}
      >
        {slow ? LOOKING : " "}
      </RoomText>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 32 },
  center: { textAlign: "center" },
  title: { marginTop: 12 },
  rule: { marginTop: 16 },
  slow: { marginTop: 18 },
});
