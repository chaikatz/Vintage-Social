import { Platform, findNodeHandle } from "react-native";
import { requireOptionalNativeModule } from "expo-modules-core";
import type { VintagePagerModule } from "../../modules/vintage-pager";

/**
 * Tell the tab pager that a swipe takes one finger — see the native module
 * for why it has to be told, and why it has to be told before any pinch
 * begins. Called with the view the tabs are drawn in, once it is on screen.
 * Harmless to call again; a binary without the module, or a browser, is
 * left as it is.
 */
const native = Platform.OS === "ios" ? requireOptionalNativeModule<VintagePagerModule>("VintagePager") : null;

export async function keepPagerToOneFinger(view: unknown): Promise<boolean> {
  if (!native) return false;
  const tag = findNodeHandle(view as never);
  if (tag == null) return false;
  // The pager mounts with the tabs, but on a slow start its native view can
  // land a beat after ours is laid out; a few tries, briefly spaced.
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      if (await native.keepToOneFinger(tag)) return true;
    } catch {
      return false;
    }
    await new Promise((r) => setTimeout(r, 300 * (attempt + 1)));
  }
  return false;
}
