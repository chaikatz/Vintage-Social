import React from "react";
import { StyleSheet, View } from "react-native";
import Svg, { Defs, RadialGradient, Rect, Stop } from "react-native-svg";
import type { FilterSpec } from "@/filters";

/**
 * A VINTAGE filter, applied live on iOS and Android.
 *
 * The obvious way to do this would be the `filter` style prop, and that is
 * what the web build uses. It does not work here: React Native implements
 * only `brightness` and `opacity` of `filter` on iOS — `saturate`,
 * `contrast`, `sepia` and `grayscale` are parsed and then silently dropped
 * (see RCTViewComponentView.mm). So a video came out looking untouched no
 * matter which filter was chosen.
 *
 * What iOS does support is `mixBlendMode`, which maps onto CoreAnimation's
 * compositing filters — including the separable `saturation` mode. So the
 * look is rebuilt out of blended layers instead:
 *
 *   saturation  a grey plate blended in `saturation` mode drains colour;
 *               a vivid plate pushes it up
 *   tone        the warm or cool cast, in `softLight` so it colours the
 *               midtones without flattening the ends
 *   fade        the paper colour in `screen`, lifting the blacks the way
 *               an aged print does
 *   vignette    a real radial gradient, drawn in SVG
 *
 * Contrast has no honest equivalent in a blend layer and is left to the
 * platforms that can do it — the GL bake for photographs, CSS on web.
 * Grain is omitted here as it is on web.
 *
 * Photographs published through the app are baked at compose time and never
 * reach this. Video does, on every play: burning a filter into footage
 * needs a transcode VINTAGE doesn't do yet.
 */
export function FilterOverlay({ filter }: { filter: FilterSpec }) {
  const { saturation, temperature, tint } = filter.adjustments;
  const { fade, fadeColor, vignette } = filter.artifacts;

  const layers: React.ReactNode[] = [];

  // 1. Saturation. A fully grey plate has no saturation of its own, so
  //    blending it in `saturation` mode takes the picture's away.
  const drain = filter.monochrome ? 1 : Math.min(1, Math.max(0, 1 - saturation));
  if (drain > 0.001) {
    layers.push(
      <View
        key="saturation"
        pointerEvents="none"
        style={[StyleSheet.absoluteFill, styles.grey, { opacity: drain }]}
      />,
    );
  } else if (!filter.monochrome && saturation > 1) {
    layers.push(
      <View
        key="saturation-boost"
        pointerEvents="none"
        style={[
          StyleSheet.absoluteFill,
          styles.vivid,
          { opacity: Math.min(0.6, (saturation - 1) * 1.2) },
        ]}
      />,
    );
  }

  // 2. Tone. Warm and cool are the two ends of `temperature`; `tint` swings
  //    green against magenta. Both ride in one plate.
  const toneStrength = Math.min(0.7, Math.abs(temperature) * 0.62 + Math.abs(tint) * 0.4);
  if (!filter.monochrome && toneStrength > 0.01) {
    layers.push(
      <View
        key="tone"
        pointerEvents="none"
        style={[
          StyleSheet.absoluteFill,
          styles.tone,
          { backgroundColor: toneColor(temperature, tint), opacity: toneStrength },
        ]}
      />,
    );
  }

  // 3. Fade — the paper the blacks drift toward.
  if (fade > 0.01) {
    layers.push(
      <View
        key="fade"
        pointerEvents="none"
        style={[
          StyleSheet.absoluteFill,
          styles.fade,
          { backgroundColor: rgb(fadeColor), opacity: fade * 0.62 },
        ]}
      />,
    );
  }

  // 4. Vignette — a genuine radial falloff rather than an inset shadow.
  if (vignette > 0.01) {
    layers.push(
      <Svg
        key="vignette"
        width="100%"
        height="100%"
        pointerEvents="none"
        style={StyleSheet.absoluteFill}
      >
        <Defs>
          <RadialGradient id="v" cx="50%" cy="50%" r="75%">
            <Stop offset="0.45" stopColor="#140F0A" stopOpacity={0} />
            <Stop offset="1" stopColor="#140F0A" stopOpacity={vignette * 0.55} />
          </RadialGradient>
        </Defs>
        <Rect x="0" y="0" width="100%" height="100%" fill="url(#v)" />
      </Svg>,
    );
  }

  return <>{layers}</>;
}

/** The cast a filter's temperature and tint add up to. */
function toneColor(temperature: number, tint: number): string {
  // Warm pushes red and drops blue; cool does the reverse. Tint swings the
  // green channel. Everything is measured out from neutral grey so a
  // softLight blend leaves the picture alone when a filter is neutral.
  const r = 128 + temperature * 92 - tint * 26;
  const g = 128 + tint * 74 + temperature * 12;
  const b = 128 - temperature * 96 - tint * 30;
  return `rgb(${clamp(r)}, ${clamp(g)}, ${clamp(b)})`;
}

const clamp = (n: number) => Math.max(0, Math.min(255, Math.round(n)));

const rgb = (c: readonly [number, number, number]) =>
  `rgb(${clamp(c[0] * 255)}, ${clamp(c[1] * 255)}, ${clamp(c[2] * 255)})`;

const styles = StyleSheet.create({
  grey: { backgroundColor: "#808080", mixBlendMode: "saturation" },
  vivid: { backgroundColor: "#FF2D00", mixBlendMode: "saturation" },
  tone: { mixBlendMode: "soft-light" },
  fade: { mixBlendMode: "screen" },
});
