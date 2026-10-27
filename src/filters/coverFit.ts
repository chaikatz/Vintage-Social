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
 * The same cover fit as a rectangle of the photograph's own pixels: the
 * part of the picture a frame of this shape shows.
 *
 * The bake needs it twice. Its size is the most detail the published
 * picture can carry, so the bake is never drawn larger than it and never
 * upscaled. And the browser draws the bake with `drawImage`, which takes
 * a source rectangle rather than texture coordinates.
 */
export function coverCropPx(
  imageWidth: number,
  imageHeight: number,
  frameWidth: number,
  frameHeight: number,
): { x: number; y: number; width: number; height: number } {
  const { scale, offset } = coverUV(imageWidth, imageHeight, frameWidth, frameHeight);
  return {
    x: offset[0] * imageWidth,
    y: offset[1] * imageHeight,
    width: scale[0] * imageWidth,
    height: scale[1] * imageHeight,
  };
}
