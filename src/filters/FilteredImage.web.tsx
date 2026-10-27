import React, { forwardRef, useImperativeHandle, useMemo, useRef } from "react";
import { Image, LayoutChangeEvent, StyleProp, StyleSheet, View, ViewStyle } from "react-native";
import { BAKE_MAX_SIDE, BAKE_QUALITY, BAKE_TIMEOUT_MS, bakeOutputSize } from "./bakeSize";
import { coverCropPx } from "./coverFit";
import { cssFilterFor } from "./cssFilter";
import { withTimeout } from "./renderGate";
import type { FilterSpec } from "./types";
import type { BakeOptions, BakeResult, FilteredImageHandle } from "./FilteredImage";

interface Props {
  uri: string;
  /** Accepted for parity with the GL renderer; the browser covers the frame on its own. */
  width?: number | null;
  height?: number | null;
  filter: FilterSpec;
  style?: StyleProp<ViewStyle>;
  onReady?: () => void;
  onError?: (error: Error) => void;
}

/**
 * Web fallback for the GL filter renderer (browser review builds only —
 * iOS keeps the GL pipeline and remains the source of truth).
 *
 * Preview: the FilterSpec is approximated with CSS filters plus fade /
 * tint / vignette overlay layers. Bake: the same approximation is drawn
 * into a canvas, the way the GL renderer bakes: the preview's crop of the
 * photograph, at most `maxSide` on its long side, so the create flow
 * produces the same shape of "baked" image on both.
 */
export const FilteredImage = forwardRef<FilteredImageHandle, Props>(
  function FilteredImageWeb({ uri, filter, style, onReady, onError }, ref) {
    const styles = useMemo(() => cssFilterFor(filter), [filter]);
    // The frame as laid out, for its shape: the bake is cropped to it as
    // the preview is.
    const frameRef = useRef<{ width: number; height: number } | null>(null);

    useImperativeHandle(ref, () => {
      const bake = (opts: BakeOptions = {}) =>
        bakeOnCanvas(uri, filter, styles, frameRef.current, opts);
      return { bake, snapshot: () => bake({}) };
    });

    const onLayout = (e: LayoutChangeEvent) => {
      const { width, height } = e.nativeEvent.layout;
      frameRef.current = { width, height };
    };

    return (
      <View style={[localStyles.wrap, style]} onLayout={onLayout}>
        <Image
          source={{ uri }}
          resizeMode="cover"
          onLoad={onReady}
          onError={() => onError?.(new Error("Could not load the image in the browser"))}
          style={[StyleSheet.absoluteFill, { filter: styles.filter } as object]}
        />
        {styles.fadeOverlay ? (
          <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: styles.fadeOverlay }]} />
        ) : null}
        {styles.tintOverlay ? (
          <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: styles.tintOverlay }]} />
        ) : null}
        {styles.vignetteBoxShadow ? (
          <View
            pointerEvents="none"
            style={[StyleSheet.absoluteFill, { boxShadow: styles.vignetteBoxShadow } as object]}
          />
        ) : null}
      </View>
    );
  },
);

async function bakeOnCanvas(
  uri: string,
  filter: FilterSpec,
  styles: ReturnType<typeof cssFilterFor>,
  frame: { width: number; height: number } | null,
  opts: BakeOptions,
): Promise<BakeResult> {
  const img = await withTimeout(
    loadImage(uri),
    opts.timeoutMs ?? BAKE_TIMEOUT_MS,
    "The image was not ready in time",
  );
  const sourceWidth = img.naturalWidth;
  const sourceHeight = img.naturalHeight;
  // Scale 1: a canvas is read out pixel for pixel, with none of the
  // point-size rounding expo-gl's snapshot does on iOS.
  const size = bakeOutputSize({
    sourceWidth,
    sourceHeight,
    frameWidth: frame?.width ?? 0,
    frameHeight: frame?.height ?? 0,
    maxSide: opts.maxSide ?? BAKE_MAX_SIDE,
    scale: 1,
  });
  if (!size) throw new Error("The image has no size to bake at");

  const canvas = document.createElement("canvas");
  canvas.width = size.width;
  canvas.height = size.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas is unavailable in this browser");

  // The part of the photograph the frame shows, as `resizeMode="cover"`
  // shows it: centred, trimmed, never stretched.
  const crop = coverCropPx(sourceWidth, sourceHeight, size.width, size.height);
  ctx.imageSmoothingQuality = "high";
  ctx.filter = styles.filter === "none" ? "" : styles.filter;
  ctx.drawImage(img, crop.x, crop.y, crop.width, crop.height, 0, 0, size.width, size.height);
  ctx.filter = "";

  if (styles.fadeOverlay) {
    ctx.fillStyle = styles.fadeOverlay;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  if (styles.tintOverlay) {
    ctx.fillStyle = styles.tintOverlay;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  if (filter.artifacts.vignette > 0) {
    const { width, height } = canvas;
    const gradient = ctx.createRadialGradient(
      width / 2, height / 2, Math.min(width, height) * 0.45,
      width / 2, height / 2, Math.max(width, height) * 0.75,
    );
    gradient.addColorStop(0, "rgba(20,15,10,0)");
    gradient.addColorStop(1, `rgba(20,15,10,${filter.artifacts.vignette * 0.5})`);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);
  }

  return {
    uri: canvas.toDataURL("image/jpeg", opts.quality ?? BAKE_QUALITY),
    width: canvas.width,
    height: canvas.height,
  };
}

function loadImage(uri: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new window.Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Could not load the image in the browser"));
    img.src = uri;
  });
}

const localStyles = StyleSheet.create({
  wrap: { overflow: "hidden", backgroundColor: "transparent" },
});
