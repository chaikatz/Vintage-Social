import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { Image } from "expo-image";
import { colors, dark, light, type } from "@/theme";
import { dateStampText } from "@/utils/time";
import { exportLabelText, exportLayout, printRatio, type ExportFormat, type ExportPaper } from "@/utils/exportLayout";
import type { PostWithAuthor } from "@/types/db";

interface Props {
  post: PostWithAuthor;
  /** What is shown in the frame: the photograph, or a film's poster. */
  source: string | number | null;
  format: ExportFormat;
  paper: ExportPaper;
  /** The card's width in points; everything else follows from it. */
  width: number;
  /** The author's membership number, when known. Never invented. */
  memberNo?: number | null;
  /** The picture has drawn; a capture will not be blank. */
  onReady?: () => void;
}

/** The two papers a print can be struck on, as plain strings for the capture. */
export function exportPalette(paper: ExportPaper) {
  const p = paper === "darkroom" ? dark : light;
  return { paper: p.paper, well: p.paperSunken, ink: p.ink, inkSoft: p.inkSoft, inkFaint: p.inkFaint, rule: p.borderStrong };
}

/**
 * A photograph as a print: paper, margin, and the label.
 *
 * Rendered from `exportLayout` so the preview on screen, the still that
 * is captured, and the film the native side brands are the same object
 * at three sizes. Nothing here is dynamic colour: a print is one paper.
 * The label says where, when and whose — and says nothing where there is
 * nothing to say.
 */
export function ExportCard({ post, source, format, paper, width, memberNo, onReady }: Props) {
  const ratio = printRatio(post.width, post.height);
  const words = exportLabelText(post, memberNo);
  const L = exportLayout(ratio, format, width, { placeLines: words.placeLines });
  const c = exportPalette(paper);
  const date = post.taken_at ?? post.created_at;

  return (
    <View style={{ width: L.width, height: L.height, backgroundColor: c.paper }} collapsable={false}>
      <View style={[styles.abs, rect(L.photo), { backgroundColor: c.well, overflow: "hidden" }]}>
        {source ? (
          <Image
            source={source}
            style={{ width: L.photo.width, height: L.photo.height }}
            contentFit="cover"
            cachePolicy="memory-disk"
            priority="high"
            onLoad={onReady}
          />
        ) : null}
      </View>
      {post.show_date_stamp ? (
        <Text
          style={[
            styles.abs,
            rect(L.stamp),
            styles.stamp,
            { fontSize: L.stamp.size, lineHeight: L.stamp.height, textShadowRadius: L.stamp.size * 0.4 },
          ]}
          numberOfLines={1}
        >
          {dateStampText(date)}
        </Text>
      ) : null}

      <View style={[styles.abs, rect(L.rule), { backgroundColor: c.rule }]} />
      <Text
        style={[
          styles.abs,
          rect(L.wordmark),
          {
            fontFamily: type.serif,
            fontSize: L.wordmark.size,
            lineHeight: L.wordmark.height,
            letterSpacing: L.wordmark.spacing,
            color: c.ink,
          },
        ]}
        numberOfLines={1}
      >
        VINTAGE
      </Text>
      <Text
        style={[
          styles.abs,
          rect(L.tagline),
          {
            fontFamily: type.serif,
            fontStyle: "italic",
            fontSize: L.tagline.size,
            lineHeight: L.tagline.height,
            letterSpacing: L.tagline.spacing,
            color: c.inkFaint,
          },
        ]}
        numberOfLines={1}
      >
        {TAGLINE}
      </Text>
      {words.place ? (
        <Text
          style={[
            styles.abs,
            rect(L.place),
            styles.right,
            {
              fontFamily: type.mono,
              fontSize: L.place.size,
              lineHeight: L.place.height / words.placeLines,
              letterSpacing: L.place.spacing,
              color: c.inkSoft,
            },
          ]}
          numberOfLines={words.placeLines}
        >
          {words.place}
        </Text>
      ) : null}
      <Text
        style={[
          styles.abs,
          rect(L.byline),
          styles.right,
          {
            fontFamily: type.mono,
            fontSize: L.byline.size,
            lineHeight: L.byline.height,
            letterSpacing: L.byline.spacing,
            color: c.inkSoft,
          },
        ]}
        numberOfLines={1}
      >
        {words.date}
      </Text>
      <Text
        style={[
          styles.abs,
          rect(L.credit),
          styles.right,
          {
            fontFamily: type.mono,
            fontSize: L.credit.size,
            lineHeight: L.credit.height,
            letterSpacing: L.credit.spacing,
            color: c.inkFaint,
          },
        ]}
        numberOfLines={1}
      >
        {words.credit}
      </Text>
      {/* A faint shadow around the icon, so it reads as an app icon rather than a square of paper. */}
      <View style={[styles.abs, rect(L.icon), styles.iconShadow, { borderRadius: iconRadius(L.icon.width), shadowRadius: L.icon.width * 0.14 }]}>
        <Image
          source={EXPORT_ICON}
          style={[StyleSheet.absoluteFill, { borderRadius: iconRadius(L.icon.width) }]}
          contentFit="cover"
          cachePolicy="memory-disk"
        />
      </View>
    </View>
  );
}

/** The words under the wordmark on every print. */
export const TAGLINE = "Members only";

/** The app icon, as the card carries it. Shared with the film branding, which loads the same file. */
export const EXPORT_ICON = require("../../assets/icon.png");

/** iOS rounds its icons at about 22% of their side. */
export function iconRadius(size: number): number {
  return Math.round(size * 0.22 * 100) / 100;
}

function rect(r: { x: number; y: number; width: number; height: number }) {
  return { left: r.x, top: r.y, width: r.width, height: r.height };
}

const styles = StyleSheet.create({
  iconShadow: { shadowColor: "#000", shadowOpacity: 0.22, shadowOffset: { width: 0, height: 1 }, elevation: 3 },
  abs: { position: "absolute" },
  right: { textAlign: "right" },
  stamp: {
    fontFamily: type.mono,
    fontWeight: "700",
    textAlign: "right",
    color: colors.stamp,
    textShadowColor: colors.stampGlow,
    textShadowOffset: { width: 0, height: 0 },
    opacity: 0.92,
  },
});
