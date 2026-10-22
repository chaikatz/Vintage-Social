import { Asset } from "expo-asset";
import { DEMO_PREFIX } from "@/demo/photos";

/**
 * What the image view is given for a print. On a phone a print's address
 * is Photos' own `ph://` URL, which the image view asks Photos for at the
 * size it draws. In the browser demo it is `demo:<seed>`, one of the demo
 * world's bundled photographs, which the bundler hands back as a module
 * (a number on a phone, an object in the browser) — so it is resolved
 * here, in one place, and a print's address stays a plain string that can
 * be written down.
 */
export function printSource(uri: string | number): number | { uri: string } | null {
  if (typeof uri === "number") return uri;
  if (uri.startsWith(DEMO_PREFIX)) {
    const { PHOTOS } = require("@/demo/photoAssets") as { PHOTOS: Record<string, number> };
    return PHOTOS[uri.slice(DEMO_PREFIX.length)] ?? null;
  }
  return { uri };
}

/** A plain URL for a print, for the editor: a demo photograph's bundled file, or the address itself. */
export function printFileUri(uri: string | number): string | null {
  const source = printSource(uri);
  if (source == null) return null;
  if (typeof source === "number") return Asset.fromModule(source).uri;
  if (typeof source === "object" && typeof (source as { uri?: unknown }).uri === "string") return (source as { uri: string }).uri;
  return null;
}
