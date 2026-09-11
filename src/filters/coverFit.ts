/**
 * The "cover" fit, in texture coordinates.
 *
 * A photograph is cropped to its frame the way a print is trimmed to a
 * mount — never stretched to fit it. The GL renderer draws one quad the
 * size of the frame and samples the texture through these: the fraction
 * of the picture the frame shows, and where that fraction starts.
 */
/**
 * How much of the texture the frame shows, and from where: the "cover"
 * fit. A picture wider than the frame shows its full height and a centred
 * band of its width; a taller one the reverse.
 */
export function coverUV(
  imageWidth: number | null | undefined,
  imageHeight: number | null | undefined,
  frameWidth: number,
  frameHeight: number,
): { scale: [number, number]; offset: [number, number] } {
  if (!imageWidth || !imageHeight || !frameWidth || !frameHeight) {
    return { scale: [1, 1], offset: [0, 0] };
  }
  const image = imageWidth / imageHeight;
  const frame = frameWidth / frameHeight;
  if (image > frame) {
    const sx = frame / image;
    return { scale: [sx, 1], offset: [(1 - sx) / 2, 0] };
  }
  const sy = image / frame;
  return { scale: [1, sy], offset: [0, (1 - sy) / 2] };
}

/**
 * GPU renderer for VINTAGE filters. Used at full size in the create flow
 * (live preview + publish-time bake) and at thumbnail size in the filter
 * tray. Not used in feeds — feeds show the baked JPEG.
 */
