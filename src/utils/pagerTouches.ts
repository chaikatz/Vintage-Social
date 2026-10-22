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

/**
 * The same rule for one scroll view: the Darkroom's page turner, a
 * horizontal list whose prints zoom under a pinch. Called with the list
 * (or any scroll view) once it has mounted. A binary built before the
 * native side learned this, or without the module at all, is left as it is,
 * and the room carries on regardless.
 */
export async function keepScrollToOneFinger(scrollView: unknown): Promise<boolean> {
  const tell = native?.keepScrollToOneFinger?.bind(native);
  if (!tell) return false;
  const tag = scrollTag(scrollView);
  if (tag == null) return false;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      if (await tell(tag)) return true;
    } catch {
      return false;
    }
    await new Promise((r) => setTimeout(r, 300 * (attempt + 1)));
  }
  return false;
}

/** A list's own scroll view is the native view to find; a list says which it is. */
function scrollTag(scrollView: unknown): number | null {
  const list = scrollView as { getScrollableNode?: () => unknown } | null | undefined;
  if (list && typeof list.getScrollableNode === "function") {
    try {
      const node = list.getScrollableNode();
      if (typeof node === "number") return node;
      if (node != null) {
        const tag = findNodeHandle(node as never);
        if (tag != null) return tag;
      }
    } catch {
      // Fall through to the list itself.
    }
  }
  return scrollView == null ? null : findNodeHandle(scrollView as never);
}
