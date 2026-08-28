import React, { forwardRef, useImperativeHandle, useMemo } from "react";
import { Image, StyleProp, StyleSheet, View, ViewStyle } from "react-native";
import { cssFilterFor } from "./cssFilter";
import type { FilterSpec } from "./types";
import type { FilteredImageHandle } from "./FilteredImage";

interface Props {
  uri: string;
  filter: FilterSpec;
  style?: StyleProp<ViewStyle>;
  onReady?: () => void;
}

/**
 * Web fallback for the GL filter renderer (browser review builds only —
 * iOS keeps the GL pipeline and remains the source of truth).
 *
 * Preview: the FilterSpec is approximated with CSS filters plus fade /
 * tint / vignette overlay layers. Snapshot: the same approximation is
 * drawn into a canvas so the create flow still produces a "baked" image.
 */
export const FilteredImage = forwardRef<FilteredImageHandle, Props>(
  function FilteredImageWeb({ uri, filter, style, onReady }, ref) {
    const styles = useMemo(() => cssFilterFor(filter), [filter]);

    useImperativeHandle(ref, () => ({
      async snapshot() {
        const img = await loadImage(uri);
        const canvas = document.createElement("canvas");
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        const ctx = canvas.getContext("2d");
        if (!ctx) throw new Error("Canvas is unavailable in this browser");

        ctx.filter = styles.filter === "none" ? "" : styles.filter;
        ctx.drawImage(img, 0, 0);
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
          uri: canvas.toDataURL("image/jpeg", 0.9),
          width: canvas.width,
          height: canvas.height,
        };
      },
    }));

    return (
      <View style={[localStyles.wrap, style]}>
        <Image
          source={{ uri }}
          resizeMode="cover"
          onLoad={onReady}
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
