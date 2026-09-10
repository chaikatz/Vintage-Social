import { Platform } from "react-native";
import { requireOptionalNativeModule } from "expo-modules-core";
import { buildColorMatrix } from "./colorMatrix";
import type { FilterSpec } from "./types";
import type { BakeOptions, BakedVideo, VintageVideoModule } from "../../modules/vintage-video";

/**
 * Baking a filter into video, where the build can.
 *
 * The GL shader bakes photographs; it cannot touch a movie. The native
 * module in `modules/vintage-video` does the same job for video on iOS
 * with AVFoundation, frame by frame, using the same matrix and artifact
 * numbers, so a clip and a still wearing the same film match.
 *
 * It is loaded optionally on purpose. Android, the web review build and a
 * binary made without the module all report `false` from `canBakeVideo`,
 * and the compose screen falls back to what it did before: upload the
 * footage as recorded and apply the look at play time.
 */

/** Longest side of a baked clip. 1080p is plenty for a phone-width column
 * and keeps a six-second upload in the tens of megabytes, not hundreds. */
export const BAKED_VIDEO_MAX = 1920;

const native = Platform.OS === "ios" ? requireOptionalNativeModule<VintageVideoModule>("VintageVideo") : null;

export function canBakeVideo(): boolean {
  return native != null;
}

/** What the native side is asked for — the shader's uniforms, by name. */
export function bakeOptionsFor(filter: FilterSpec, maxDimension = BAKED_VIDEO_MAX): BakeOptions {
  return {
    matrix: buildColorMatrix(filter.adjustments, filter.monochrome),
    fade: filter.artifacts.fade,
    fadeColor: [...filter.artifacts.fadeColor],
    vignette: filter.artifacts.vignette,
    grain: filter.artifacts.grain,
    maxDimension,
  };
}

/**
 * Write a copy of the clip with the filter in its pixels. Throws where the
 * module is missing or the export fails; the caller decides whether that
 * is fatal (it is not — the unbaked path still works).
 */
export async function bakeVideo(uri: string, filter: FilterSpec): Promise<BakedVideo> {
  if (!native) throw new Error("Video baking is not available in this build");
  return native.bake(uri, bakeOptionsFor(filter));
}
