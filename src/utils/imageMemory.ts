import { AppState } from "react-native";
import { Image } from "expo-image";

/**
 * The photographs decoded and kept in memory, let go when the app goes to
 * the background.
 *
 * expo-image keeps every picture it has decoded in one memory cache for
 * the whole app (SDWebImage's, on iOS), with no limit of its own: over a
 * long session, the feed, the grids, a gallery or two and the Darkroom's
 * plates pile up there. iOS takes that memory back only when it warns the
 * app in front, and an app in the background that holds a lot of it is
 * among the first iOS ends to make room for another: the member came back
 * to a cold launch instead of the screen they left.
 *
 * So the cache is emptied as the app goes away. A picture on screen keeps
 * what it shows (the image view holds its own copy); any other comes back
 * from the disk cache, as a picture scrolled back to does. Only on a move
 * to the background: "inactive" is the app still on screen under Control
 * Center, the notification list or a system question. And once for each
 * time away: coming back, React Native reports "background" once more on
 * the way in (see src/utils/appReturn.ts), which is no new reason to.
 */
export function releaseImagesInBackground(
  appState: Pick<typeof AppState, "addEventListener"> = AppState,
  clear: () => Promise<unknown> = () => Image.clearMemoryCache(),
): () => void {
  let away = false;
  const sub = appState.addEventListener("change", (state) => {
    if (state !== "background") {
      away = false;
      return;
    }
    if (away) return;
    away = true;
    try {
      void clear().catch(() => undefined);
    } catch {
      // Nothing kept, or nothing to let go of it with.
    }
  });
  return () => sub.remove();
}
